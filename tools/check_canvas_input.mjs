import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';
const engine=process.argv[2]||'chromium',{browser,close}=await launchTestBrowser(engine);
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length&&!window.mteEditor.busy);
  await page.evaluate(()=>{window.gestureClicks=0;window.mteStudio.addEventListener('interaction-invoked',()=>window.gestureClicks++);window.mteStudio.paused=true;});
  const box=await page.locator('#stage').boundingBox(),point={x:box.x+box.width*.7,y:box.y+box.height*.4};
  const camera=()=>page.evaluate(()=>({...window.mteStudio.camera}));
  const original=await camera();await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+70,point.y+30,{steps:5});await page.mouse.up();
  assert.notEqual((await camera()).x,original.x);assert.equal(await page.evaluate(()=>window.gestureClicks),0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await page.waitForFunction(()=>!window.mteEditor.busy);assert.deepEqual(await camera(),original);
  const world=()=>page.evaluate(p=>window.mteStudio.screenToWorld(p.x,p.y),point),anchor=await world();
  await page.mouse.move(point.x,point.y);await page.mouse.wheel(0,-250);await page.waitForTimeout(200);const zoomed=await camera(),after=await world();
  assert.ok(zoomed.width<original.width);assert.ok(Math.abs(anchor.x-after.x)<1e-6);assert.ok(Math.abs(anchor.y-after.y)<1e-6);
  await page.locator('#stage').focus();await page.keyboard.press('ArrowRight');assert.notEqual((await camera()).x,zoomed.x);
  await page.getByRole('button',{name:'Studio',exact:true}).click();
  const hit=await page.evaluate(()=>{const s=window.mteStudio,r=s.canvas.getBoundingClientRect();for(let y=r.top+10;y<r.bottom;y+=20)for(let x=r.left+10;x<r.right;x+=20)if(s.hitTest(x,y))return {x,y};});assert.ok(hit,'Real character has an editable hit area');
  const beforeDrag=await page.evaluate(()=>{const g=window.mteStudio.groups[0];return {x:g.x,y:g.y};});
  await page.mouse.move(hit.x,hit.y);await page.mouse.down();await page.mouse.move(hit.x+40,hit.y+20,{steps:4});await page.mouse.up();
  assert.notEqual(await page.evaluate(()=>window.mteStudio.groups[0].x),beforeDrag.x);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await page.waitForFunction(()=>!window.mteEditor.busy);
  assert.deepEqual(await page.evaluate(()=>{const g=window.mteStudio.groups[0];return {x:g.x,y:g.y};}),beforeDrag);
  const object=await page.evaluate(()=>{const g=window.mteStudio.groups[0];return {x:g.x,y:g.y};});
  await page.mouse.move(point.x,point.y);await page.keyboard.down('Space');await page.mouse.down();await page.mouse.move(point.x+60,point.y,{steps:4});await page.mouse.up();await page.keyboard.up('Space');
  assert.deepEqual(await page.evaluate(()=>{const g=window.mteStudio.groups[0];return {x:g.x,y:g.y};}),object);
  if(engine==='chromium'){
  const session=await page.context().newCDPSession(page),beforePinch=await camera(),cx=box.x+box.width*.5,cy=box.y+box.height*.5;
  const touch=(type,d)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:cx-d,y:cy,id:1},{x:cx+d,y:cy,id:2}]});
  await touch('touchStart',50);await touch('touchMove',100);await touch('touchEnd',0);assert.ok((await camera()).width<beforePinch.width);
  }
  await page.getByRole('button',{name:'Export',exact:true}).click();const frozen=await camera();await page.mouse.move(point.x,point.y);await page.mouse.wheel(0,250);await page.waitForTimeout(200);assert.deepEqual(await camera(),frozen);
  const shapes=[];
  for(const bundle of ['Spines/painting/301600901_spine','Spines/painting/301619402_spine']){
    await page.evaluate(async bundle=>{
      const {Stage}=await import('/src/engine/stage.js'),{createCanvasInput}=await import('/src/canvas-input.js');
      const catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries;
      const canvas=document.createElement('canvas');canvas.width=480;canvas.height=320;canvas.style.cssText='position:fixed;left:0;top:0;width:480px;height:320px;z-index:10000';document.body.append(canvas);
      const stage=new Stage(canvas,{manual:true}),group=await stage.add(catalog.find(row=>row.id===bundle),entries),root=group.controllers[0];
      for(let i=0;i<3600&&(root.value.playing||root.primary?.state.getCurrent(0)?.animation.name==='start');i++)stage.evaluate(1/120);
      const input=createCanvasInput(stage,{busy:false,before:()=>true,changed(){},choose(){}},{getView:()=> 'gallery',onInteraction:result=>window.physicalHit.result=result});
      window.physicalHit={stage,group,root,input,initial:stage.snapshot(),catalog,entries};
    },bundle);
    try{
      for(const pose of [{rotation:0,scale:1,flipX:false,flipY:false},{rotation:37,scale:.6,flipX:true,flipY:false},{rotation:-53,scale:1.6,flipX:true,flipY:true}]){
        const target=await page.evaluate(async pose=>{
          const {point,colliderContains}=await import('/src/engine/geometry.js'),test=window.physicalHit,{stage,group,root}=test;
          await stage.restore(test.initial,test.catalog,test.entries);Object.assign(group,pose,{x:2,y:-3});stage.paused=false;stage.evaluate(0);test.result=null;
          const priority=hit=>2*Number(hit.colliders.some(c=>c.type==='PolygonCollider2D'))+Number(root.transformBindings.has(hit.transform));
          const hits=[...root.hotspots].sort((a,b)=>priority(b)-priority(a));
          for(const hit of hits){
            if(!hit.event||hit.enabled===0||hit.enabled===false||!group.isActiveTransform(hit.transform))continue;
            for(const collider of hit.colliders){
              const data=collider.data,vertices=data.m_Points?.m_Paths?.flat(),offset=data.m_Offset||{x:0,y:0};
              const minX=vertices?Math.min(...vertices.map(p=>p.x)):-data.m_Size.x/2,maxX=vertices?Math.max(...vertices.map(p=>p.x)):data.m_Size.x/2,minY=vertices?Math.min(...vertices.map(p=>p.y)):-data.m_Size.y/2,maxY=vertices?Math.max(...vertices.map(p=>p.y)):data.m_Size.y/2;
              for(let y=1;y<10;y++)for(let x=1;x<10;x++){
                const local={x:offset.x+minX+(maxX-minX)*x/10,y:offset.y+minY+(maxY-minY)*y/10};if(!colliderContains(collider,local.x,local.y))continue;
                const matrix=root.matrix(hit);if(!matrix)continue;const world=point(matrix,local.x,local.y);if(root.hitAt(world.x,world.y)?.id!==hit.id)continue;
                stage.camera={x:world.x-.4,y:world.y+.2,width:8,height:8};stage.draw();const rect=stage.canvas.getBoundingClientRect(),width=Math.max(8,8*rect.width/rect.height),height=width*rect.height/rect.width;
                return {x:rect.left+(world.x-stage.camera.x+width/2)/width*rect.width,y:rect.top+(stage.camera.y+height/2-world.y)/height*rect.height,hit:hit.id,shape:collider.type,boneBound:root.transformBindings.has(hit.transform)};
              }
            }
          }
        },pose);
        assert.ok(target,`No exposed interaction region in ${bundle}`);if(bundle.includes('301619402'))assert.equal(target.boneBound,true,'Source bone-bound region was not exercised');await page.mouse.click(target.x,target.y);
        const result=await page.evaluate(()=>window.physicalHit.result);assert.equal(result?.hit,target.hit);assert.ok(result.accepted||result.unavailable,result.reason);shapes.push(target.shape);
        await page.evaluate(async pose=>{const test=window.physicalHit,camera={...test.stage.camera};await test.stage.restore(test.initial,test.catalog,test.entries);Object.assign(test.group,pose,{x:2,y:-3});test.stage.paused=false;test.stage.evaluate(0);test.stage.camera=camera;test.stage.draw();test.result=null;},pose);
        await page.touchscreen.tap(target.x,target.y);const touched=await page.evaluate(()=>window.physicalHit.result);assert.equal(touched?.hit,target.hit);assert.ok(touched.accepted||touched.unavailable,touched.reason);
      }
    }finally{await page.evaluate(()=>{const {stage,input}=window.physicalHit;input.dispose();stage.dispose();stage.canvas.remove();delete window.physicalHit;});}
  }
  assert.ok(shapes.includes('PolygonCollider2D'),'Source polygon was not exercised');assert.ok(shapes.includes('BoxCollider2D'),'Source box was not exercised');
  assert.deepEqual(errors,[]);console.log(engine+': Canvas checks passed: pan/undo, anchored zoom, keyboard, object drag/undo, Space pan, Export lock and twelve real transformed box/polygon mouse/touch clicks'+(engine==='chromium'?' plus native touch pinch':''));
}finally{await close();}
