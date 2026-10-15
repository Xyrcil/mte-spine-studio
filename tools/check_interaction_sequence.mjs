import {selectAsset} from './select_asset.mjs';
import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';

const engine=process.argv[2]||'chromium',{browser,close}=await launchTestBrowser(engine);
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length>0);
  await selectAsset(page,'Spines/painting/301619402_spine');
  await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/painting/301619402_spine');
  const result=await page.evaluate(async()=>{
    const {InteractionRecorder,InteractionPlayer}=await import('/src/engine/interaction-sequence.js');
    const stage=window.mteStudio;stage.paused=true;window.mteAudio.stop();window.mteAudio.stopEffects();
    const presentations=(await fetch('/assets/presentations.json').then(response=>response.json())).presentations;
    const entries=(await fetch('/assets/runtime-index.json').then(response=>response.json())).entries;
    const group=stage.groups[0],root=group.controllers[0];root.reset();
    for(const layer of root.layers){layer.state.clearTracks();layer.skeleton.setToSetupPose();}
    root.play('animation',0,true);stage.evaluate(0);
    const recorder=new InteractionRecorder(stage);recorder.start();
    const invoke=name=>{const hit=root.hotspots.find(hit=>hit.name===name);return stage.triggerInteraction(group.id,root.source.id,hit.id);};
    const first=invoke('HitArea_anim_anim2');
    for(let i=0;i<1200&&root.value.playing;i++)stage.evaluate(1/120);
    stage.evaluate(.2);const second=invoke('HitArea_anim_heiban');
    for(let i=0;i<1200&&root.value.playing;i++)stage.evaluate(1/120);
    stage.evaluate(.3);const sequence=recorder.stop();recorder.dispose();
    const states=[];let invoked=0;stage.addEventListener('interaction-invoked',()=>invoked++);
    for(let run=0;run<2;run++){
      await stage.restore(sequence.initial,presentations,entries);
      const player=new InteractionPlayer(stage,sequence);stage.sequencePlayer=player;
      stage.evaluate(0);for(let i=0;i<10000&&!player.finished;i++)stage.evaluate(run===0?1/30:1/60);
      if(!player.finished)throw new Error('Sequence did not finish');
      states.push(stage.groups[0].controllers[0].snapshot());stage.sequencePlayer=null;
    }
    return {first,second,actions:sequence.actions,duration:sequence.duration,states,invoked};
  });
  assert.equal(result.first.accepted,true);assert.equal(result.second.accepted,true);assert.equal(result.actions.length,2);
  assert.equal(result.actions[0].at,0);assert.ok(result.actions[1].at>0);assert.ok(result.duration>result.actions[1].at);
  // Compare gameplay state; clock rounding may differ at sub-nanosecond scale.
  for(const state of result.states)state.clock=Math.round(state.clock*1e8)/1e8;
  assert.deepEqual(result.states[0],result.states[1]);assert.equal(result.invoked,0);assert.deepEqual(errors,[]);
  console.log('Real sequence checks passed: two state-changing interactions, time-zero action, frame-rate-independent replay');
  const unavailable=await page.evaluate(async()=>{
    const {comparePngReference}=await import('/tools/png_reference.mjs');
    const {Stage}=await import('/src/engine/stage.js'),{InteractionRecorder,InteractionPlayer,validateSequence}=await import('/src/engine/interaction-sequence.js'),{validateInteraction}=await import('/src/engine/interaction.js'),{exportMedia}=await import('/src/engine/export.js');
    const catalog=(await fetch('/assets/presentations.json').then(response=>response.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(response=>response.json())).entries,canvas=document.createElement('canvas');canvas.width=320;canvas.height=192;
    const stage=new Stage(canvas,{manual:true});stage.paused=true;
    try{
      const presentation=catalog.find(row=>row.id==='Spines/painting/301602201_spine'),group=await stage.add(presentation,entries.filter(row=>row.bundle===presentation.id)),root=group.controllers[0];
      const settle=()=>{for(let i=0;i<3600&&(root.value.playing||root.primary.state.getCurrent(0)?.animation.name==='start');i++)stage.evaluate(1/120);if(root.value.playing)throw new Error('Interaction did not finish');};settle();
      const recorder=new InteractionRecorder(stage);recorder.start();const results=[];
      for(const name of ['wanou_down','caidai_down']){const hit=root.hotspots.find(hit=>hit.name===name);for(let repeat=0;repeat<3;repeat++){results.push(stage.triggerInteraction(group.id,root.source.id,hit.id));settle();for(let step=0;step<12;step++)stage.evaluate(1/120);}}
      const sequence=validateSequence(JSON.parse(JSON.stringify(recorder.stop())));recorder.dispose();const final=root.snapshot();stage.draw();const pixels=new Uint8Array(320*192*4);stage.gl.readPixels(0,0,320,192,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,pixels);
      await stage.restore(sequence.initial,catalog,entries);const player=new InteractionPlayer(stage,sequence);player.advance(sequence.duration,delta=>stage.evaluateFrame(delta));if(!player.finished)throw new Error('Replay did not finish');stage.draw();const replayed=new Uint8Array(pixels.length);stage.gl.readPixels(0,0,320,192,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,replayed);let replayError=0;for(let index=0;index<pixels.length;index++)replayError=Math.max(replayError,Math.abs(pixels[index]-replayed[index]));
      const replayState=stage.groups[0].controllers[0].snapshot();for(const value of [final,replayState])value.clock=Math.round(value.clock*1e8)/1e8;if(JSON.stringify(validateInteraction(final))!==JSON.stringify(validateInteraction(replayState)))throw new Error('Missing-variant replay changed controller state');
      const scene=stage.snapshot();scene.sequence=sequence;
      const request={scene,catalog,entries,imageAssets:stage.imageAssets,sourceAspect:320/192,settings:{format:'png',width:320,height:192,fps:30,start:sequence.duration,end:sequence.duration+.1,speed:1,loops:1,loopMode:'repeat',background:stage.background,fit:'contain',crop:{x:0,y:0,width:1,height:1},useSequence:true}};
      const output=await exportMedia(request),exportError=await comparePngReference({...request,sourceTime:sequence.duration},output.blob);
      return {results:results.map(row=>({accepted:row.accepted,unavailable:row.unavailable===true,animation:row.animation})),actions:sequence.actions.length,missing:sequence.actions.filter(row=>row.unavailable).length,replayError,exportError};
    }finally{stage.dispose();}
  });assert.deepEqual(unavailable.results.map(row=>row.accepted),[true,false,true,true,false,true]);assert.equal(unavailable.actions,6);assert.equal(unavailable.missing,2);assert.ok(unavailable.replayError<=1);assert.ok(unavailable.exportError<=1);assert.deepEqual(errors,[]);console.log(engine+': real missing variants retain recovery, recorded state changes, JSON replay and PNG pixels',unavailable);
  await selectAsset(page,'Spines/painting/301602201_spine');await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/painting/301602201_spine'&&!window.mteEditor.busy);
  await page.evaluate(()=>window.mteHost.resume());
  await page.waitForFunction(()=>{const root=window.mteStudio.groups[0].controllers[0];return !root.value.playing&&root.primary.state.getCurrent(0)?.animation.name!=='start';});
  const clickVariant=async()=>{
    const position=await page.evaluate(()=>{
      const stage=window.mteStudio,root=stage.groups[0].controllers[0],hit=root.hotspots.find(hit=>hit.name==='wanou_down'),matrix=root.matrix(hit),rect=stage.canvas.getBoundingClientRect(),width=Math.max(stage.camera.width,stage.camera.height*rect.width/rect.height),height=width*rect.height/rect.width;
      for(const collider of hit.colliders){const size=collider.data.m_Size,offset=collider.data.m_Offset||{x:0,y:0};if(!size)continue;for(let y=0;y<=20;y++)for(let x=0;x<=20;x++){const local={x:offset.x+(x/20-.5)*size.x*.9,y:offset.y+(y/20-.5)*size.y*.9},world={x:matrix[0]*local.x+matrix[2]*local.y+matrix[4],y:matrix[1]*local.x+matrix[3]*local.y+matrix[5]};if(root.hitAt(world.x,world.y)?.id!==hit.id)continue;const point={x:rect.left+((world.x-stage.camera.x)/width+.5)*rect.width,y:rect.top+(.5-(world.y-stage.camera.y)/height)*rect.height};if(point.x>rect.left&&point.x<rect.right&&point.y>rect.top&&point.y<rect.bottom)return point;}}
      return null;
    });assert.ok(position,'Missing-variant source region has no reachable canvas point');await page.mouse.click(position.x,position.y);
  };
  await clickVariant();await page.waitForFunction(()=>{const root=window.mteStudio.groups[0].controllers[0];return root.value.variants.wanou_down===true&&!root.value.playing;});
  await clickVariant();await page.waitForFunction(()=>window.mteStudio.groups[0].controllers[0].value.variants.wanou_down===false);assert.match(await page.locator('#status').textContent(),/Animation unavailable: wanou_down_02/);
  let saved=false;for(let attempt=0;attempt<100;attempt++){saved=await page.evaluate(async()=>{const {loadLocalScene}=await import('/src/engine/scene.js'),scene=await loadLocalScene();return scene?.objects[0]?.bundle==='Spines/painting/301602201_spine'&&scene.objects[0].interactions[0].state.variants.wanou_down===false;});if(saved)break;await page.waitForTimeout(100);}assert.equal(saved,true,'Missing-variant state was not autosaved');
  await page.reload();await page.waitForFunction(()=>window.mteHost?.getState().ready&&window.mteStudio?.groups[0]?.presentation.id==='Spines/painting/301602201_spine'&&!window.mteEditor.busy);assert.equal(await page.evaluate(()=>window.mteStudio.groups[0].controllers[0].value.variants.wanou_down),false);
  await clickVariant();await page.waitForFunction(()=>{const root=window.mteStudio.groups[0].controllers[0];return root.value.variants.wanou_down===true&&!root.value.playing;});assert.deepEqual(errors,[]);console.log(engine+': missing-variant physical clicks autosave their state and recover after reload');
}finally{await close();}
