import {selectAsset} from './select_asset.mjs';
import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';
const {browser,close}=await launchTestBrowser('chromium');
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length>0);
  await selectAsset(page,'Spines/painting/301619402_spine');
  await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/painting/301619402_spine');
  await page.evaluate(()=>{const stage=window.mteStudio,group=stage.groups[0];Object.assign(group,{x:2,y:1,scale:.85,rotation:19,flipX:true});stage.evaluate(0);stage.fit();});
  const initial=await page.evaluate(()=>{
    const stage=window.mteStudio,group=stage.groups[0],root=group.controllers[0];
    window.interactionEvents=[];stage.addEventListener('interaction-change',event=>window.interactionEvents.push(event.detail));
    return {primary:root.primary?.instance.name,layers:root.layers.map(layer=>layer.instance.name),bindings:root.bindings.size,hits:root.hotspots.map(hit=>({name:hit.name,m:root.matrix(hit),hit:root.hitAt(root.matrix(hit)[4],root.matrix(hit)[5])?.name}))};
  });console.log({primary:initial.primary,layers:initial.layers,bindings:initial.bindings});
  assert.equal(initial.bindings,39);
  async function click(name){
    const position=await page.evaluate(name=>{
      const stage=window.mteStudio,root=stage.groups[0].controllers[0],hit=root.hotspots.find(hit=>hit.name===name),m=root.matrix(hit),rect=stage.canvas.getBoundingClientRect(),width=Math.max(stage.camera.width,stage.camera.height*rect.width/rect.height),height=width*rect.height/rect.width;
      return {x:rect.left+((m[4]-stage.camera.x)/width+.5)*rect.width,y:rect.top+(.5-(m[5]-stage.camera.y)/height)*rect.height,actual:root.hitAt(m[4],m[5])?.name};
    },name);
    assert.equal(position.actual,name);assert.ok(position.x>260&&position.x<1140&&position.y>70&&position.y<1000,`Region outside viewport: ${name}`);
    await page.mouse.click(position.x,position.y);
  }
  await click('HitArea_anim_anim2');
  await page.waitForFunction(()=>window.mteStudio.groups[0].controllers[0].value.animation==='anim_anim2');
  assert.equal(await page.evaluate(()=>window.mteStudio.groups[0].controllers[0].value.playing),true);
  assert.equal(await page.evaluate(()=>window.mteStudio.groups[0].layers.every(layer=>layer.state.getCurrent(0).animation.name==='anim_anim2')),true);
  await page.waitForFunction(()=>[...window.mteAudio.effects].some(effect=>effect.currentTime>.05));
  const locked=await page.evaluate(()=>{const root=window.mteStudio.groups[0].controllers[0];return root.click(root.hotspots.find(hit=>hit.name==='HitArea_anim_anim2'));});assert.equal(locked.accepted,false);
  await page.waitForFunction(()=>!window.mteStudio.groups[0].controllers[0].value.playing,null,{timeout:15000});
  const state=await page.evaluate(()=>({idle:window.mteStudio.groups[0].controllers[0].primary.state.getCurrent(0).animation.name,events:window.interactionEvents}));console.log(state);
  assert.equal(state.idle,'animation2');
  await page.waitForTimeout(400);
  await click('HitArea_anim_heiban');
  await page.waitForFunction(()=>window.mteStudio.groups[0].controllers[0].value.animation==='anim_dati');
  await page.waitForFunction(()=>!window.mteStudio.groups[0].controllers[0].value.playing,null,{timeout:15000});
  assert.equal(await page.evaluate(()=>window.mteStudio.groups[0].controllers[0].primary.state.getCurrent(0).animation.name),'animation_1dati');
  const graph=await page.evaluate(async()=>{
    const stage=window.mteStudio,group=stage.groups[0],root=group.controllers[0];
    stage.paused=true;window.mteAudio.stopEffects();
    for(const layer of root.layers){layer.state.clearTracks();layer.skeleton.setToSetupPose();}
    root.reset();root.play('animation',0,true);stage.suppressEvents=true;stage.evaluate(0);stage.suppressEvents=false;
    const presentations=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries;
    const queue=[stage.snapshot()],seen=new Set(['animation']),covered=new Set(),edges=[],failures=[],sourceGaps=[];
    async function restore(scene){await stage.restore(scene,presentations,entries);for(let i=0;i<15;i++)stage.evaluate(1/30);}
    while(queue.length){
      const scene=queue.shift();await restore(scene);
      const current=root.primary.state.getCurrent(0).animation.name;
      const candidates=root.hotspots.filter(hit=>{const m=root.matrix(hit);return m&&Math.abs(m[5])<30&&root.hitAt(m[4],m[5])?.id===hit.id;});
      for(const hit of candidates){
        await restore(scene);const result=root.click(hit);if(!result.accepted){failures.push({state:current,hit:hit.name,reason:result.reason});continue;}
        covered.add(hit.name);
        for(let i=0;i<600&&root.value.playing;i++)stage.evaluate(1/30);
        if(root.value.playing){failures.push({state:current,hit:hit.name,reason:'Interaction remained locked'});continue;}
        for(let i=0;i<15;i++)stage.evaluate(1/30);
        const target=root.primary.state.getCurrent(0).animation.name;edges.push({state:current,hit:hit.name,target});
        if(!seen.has(target)&&hit.event===100){seen.add(target);queue.push(stage.snapshot());}
        if(hit.event===5){
          const second=root.click(hit);if(!second.accepted){
            const missing=`${hit.animation}_02`,present=entries.some(entry=>entry.bundle===group.presentation.id&&entry.animations.some(animation=>animation.name===missing));
            if(!present&&second.reason===`Animation unavailable: ${missing}`){sourceGaps.push({state:target,hit:hit.name,animation:missing});const retry=root.click(hit);if(!retry.accepted)failures.push({state:target,hit:hit.name,reason:'Missing variant blocked later clicks'});for(let i=0;i<600&&root.value.playing;i++)stage.evaluate(1/30);}
            else failures.push({state:target,hit:hit.name,reason:second.reason});continue;
          }
          for(let i=0;i<600&&root.value.playing;i++)stage.evaluate(1/30);
          if(root.value.playing)failures.push({state:target,hit:hit.name,reason:'Second variant remained locked'});
        }
      }
    }
    return {states:[...seen],covered:[...covered],unreached:root.hotspots.filter(hit=>!covered.has(hit.name)).map(hit=>hit.name),failures,sourceGaps,edges};
  });
  console.log({states:graph.states.length,covered:graph.covered.length,transitions:graph.edges.length,unreached:graph.unreached,sourceGaps:graph.sourceGaps});
  assert.deepEqual(graph.failures,[]);assert.equal(graph.covered.length,38);
  assert.deepEqual(graph.unreached,['HitArea_ykq']);assert.ok(graph.sourceGaps.length>0&&graph.sourceGaps.every(gap=>gap.animation==='caidan_jqr_02'));
  const roundTrip=await page.evaluate(async()=>{
    const stage=window.mteStudio,root=stage.groups[0].controllers[0];
    root.reset();for(const layer of root.layers){layer.state.clearTracks();layer.skeleton.setToSetupPose();}root.play('animation',0,true);stage.suppressEvents=true;stage.evaluate(0);stage.suppressEvents=false;
    root.click(root.hotspots.find(hit=>hit.name==='HitArea_anim_anim2'));for(let i=0;i<30;i++)stage.evaluate(1/30);
    const saved=stage.snapshot(),before=root.snapshot();let sounds=0;const listener=()=>sounds++;stage.addEventListener('sound-request',listener);
    const catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,runtime=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries;
    await stage.restore(saved,catalog,runtime);stage.removeEventListener('sound-request',listener);
    return {before,after:root.snapshot(),sounds,playing:root.value.playing};
  });assert.deepEqual(roundTrip.after,roundTrip.before);assert.equal(roundTrip.sounds,0);assert.equal(roundTrip.playing,true);
  assert.deepEqual(errors,[]);
  console.log('Real interaction checks passed: moving hotspots, coordinated tracks and event transitions');
}finally{await close();}
