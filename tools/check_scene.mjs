import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';
const engine=process.argv[2]||'chromium',{browser,close}=await launchTestBrowser(engine);
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length>0);
  const wrongTypes=await page.evaluate(async()=>{
    const {Stage}=await import('/src/engine/stage.js'),catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries,canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const stage=new Stage(canvas,{manual:true});
    try{
      await stage.add(catalog.find(row=>row.id==='Spines/painting/301600901_spine'),entries);stage.paused=true;const original=stage.snapshot(),results=[];
      for(const state of [{kind:'skill-display',ended:false},{kind:'skill-words',schema:1,count:2,clock:0,step:0,nextUpdate:0,playing:false},{kind:'bone-drag',schema:1,writing:false,pointer:null,motion:{schema:1,current:{x:0,y:0},from:{x:0,y:0},dragging:false,returning:false,elapsed:0}}]){
        const changed=structuredClone(original);changed.objects[0].x=999;changed.objects[0].interactions[0].state=state;let reason='';try{await stage.restore(changed,catalog,entries);}catch(error){reason=error.message;}
        results.push({kind:state.kind,reason,unchanged:JSON.stringify(stage.snapshot())===JSON.stringify(original)});
      }
      return results;
    }finally{stage.dispose();}
  });
  for(const result of wrongTypes){assert.match(result.reason,/interaction type does not match asset/,result.kind);assert.equal(result.unchanged,true,result.kind);}
  await page.getByRole('button',{name:'Studio',exact:true}).click();
  await page.getByRole('button',{name:'Duplicate',exact:true}).click();
  await page.waitForFunction(()=>window.mteStudio.groups.length===2&&!window.mteEditor.busy);
  await page.getByLabel('X',{exact:true}).fill('3');await page.getByLabel('X',{exact:true}).press('Tab');
  assert.equal(await page.evaluate(()=>window.mteEditor.selected().x),3);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await page.waitForFunction(()=>!window.mteEditor.busy&&window.mteEditor.selected().x===1);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await page.waitForFunction(()=>!window.mteEditor.busy&&window.mteEditor.selected().x===3);
  const image=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const ctx=canvas.getContext('2d');ctx.fillStyle='#6699aa';ctx.fillRect(0,0,32,32);return canvas.toDataURL().split(',')[1];});
  await page.locator('#background-file').setInputFiles({name:'background.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await page.waitForFunction(()=>window.mteStudio.groups.length===3&&!window.mteEditor.busy);
  await page.locator('#scene-name').fill('Scene round trip');await page.locator('#scene-name').press('Tab');
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export scene',exact:true}).click();
  const stream=await (await download).createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);const saved=JSON.parse(Buffer.concat(chunks).toString());
  assert.equal(saved.objects.length,3);assert.equal(saved.objects[0].kind,'image');assert.equal(saved.paused,true);
  const before=await page.evaluate(()=>window.mteEditor.snapshot());
  const broken=structuredClone(saved);broken.objects[1].x=999;broken.objects[2].layers[0].tracks[0].name='Missing animation';
  await page.locator('#scene-file').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(broken))});
  await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Import failed'));
  assert.deepEqual(await page.evaluate(()=>window.mteEditor.snapshot()),before);
  await page.getByRole('button',{name:'Remove',exact:true}).first().click();
  await page.locator('#scene-file').setInputFiles({name:'saved.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
  await page.waitForFunction(()=>window.mteStudio.groups.length===3&&!window.mteEditor.busy);
  assert.deepEqual(await page.evaluate(()=>window.mteEditor.snapshot()),saved);
  await page.getByRole('button',{name:'Save locally',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#saved-scenes').options.length===2);
  await page.waitForTimeout(800);await page.reload();await page.waitForFunction(()=>window.mteStudio?.groups.length===3&&!window.mteEditor.busy);
  assert.deepEqual(await page.evaluate(()=>window.mteEditor.snapshot()),saved);
  await page.screenshot({path:'private/browser-scene.png'});
  await page.setViewportSize({width:600,height:900});
  await page.getByRole('button',{name:'Controls',exact:true}).click();
  assert.equal(await page.locator('.inspector').isVisible(),true);
  await page.getByRole('button',{name:'Controls',exact:true}).click();
  assert.equal(await page.locator('.inspector').isVisible(),false);
  assert.deepEqual(errors,[]);console.log(engine+': Scene checks passed: edit, undo/redo, image, import failure, controller type preflight, round trip and reload');
}finally{await close();}
