import {selectAsset} from './select_asset.mjs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';

const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1600,height:1200}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
  await selectAsset(page,'Spines/painting/301619402_spine');await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/painting/301619402_spine');
  await page.evaluate(async()=>{
    const {InteractionRecorder}=await import('/src/engine/interaction-sequence.js'),stage=window.mteStudio,root=stage.groups[0].controllers[0];stage.paused=true;window.mteAudio.stopEffects();window.mteAudio.stop();root.reset();
    for(const layer of root.layers){layer.state.clearTracks();layer.skeleton.setToSetupPose();}root.play('animation',0,true);stage.evaluate(0);stage.fit();
    const recorder=new InteractionRecorder(stage);recorder.start();stage.evaluate(.137);const hit=root.hotspots.find(hit=>hit.name==='HitArea_anim_anim2');const result=stage.triggerInteraction(stage.groups[0].id,root.source.id,hit.id);if(!result.accepted)throw new Error(result.reason);
    for(let i=0;i<1200&&root.value.playing;i++)stage.evaluate(1/120);stage.evaluate(.25);recorder.stop();recorder.dispose();stage.groups[0].x+=100;
  });
  const original=await page.evaluate(()=>window.mteEditor.snapshot());await page.locator('[data-view="export"]').click();await page.locator('#export-use-sequence').check();
  for(const [key,value] of [['width','160'],['height','120'],['fps','10'],['loops','2']])await page.locator(`#export-${key}`).fill(value);
  const result=await page.evaluate(async()=>{
    const {exportMedia,RenderSession,collectInteractionEffects}=await import('/src/engine/export.js'),{exportPlan}=await import('/src/engine/export-plan.js'),{unzipSync}=await import('/node_modules/fflate/esm/browser.js'),{Input,BlobSource,ALL_FORMATS,AudioSampleSink}=await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs');
    const stage=window.mteStudio,audio=window.mteAudio,scene=window.mteExporter.captured,catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries,settings=window.mteExporter.settings(),plan=exportPlan(settings,scene.sequence.initial.speed),args={scene,catalog,entries,imageAssets:stage.imageAssets,sourceAspect:stage.canvas.width/stage.canvas.height,settings};
    const effectProvider=(name,category)=>{const info=audio.soundInfo(name,category);return info.clip?{url:audio.base+info.clip.path,gain:info.volume}:null;};
    const session=new RenderSession(scene,catalog,entries,stage.imageAssets,args.sourceAspect,plan);let clips,backward;
    try{await session.initialize();clips=(await collectInteractionEffects(session,plan,effectProvider)).clips;await session.seek(scene.sequence.duration);const end=session.stage.groups[0].controllers[0].primary.state.getCurrent(0).animation.name;await session.seek(0);const start=session.stage.groups[0].controllers[0].primary.state.getCurrent(0).animation.name;backward={end,start,x:session.stage.groups[0].x};}finally{session.dispose();}
    const sequence=await exportMedia({...args,settings:{...settings,format:'sequence'}}),files=Object.values(unzipSync(new Uint8Array(await sequence.blob.arrayBuffer()))),repeat=files.slice(0,sequence.plan.cycleFrames).every((file,index)=>file.length===files[index+sequence.plan.cycleFrames].length&&file.every((byte,i)=>byte===files[index+sequence.plan.cycleFrames][i]));
    const video=await window.mteExporter.run();if(!video)throw new Error(document.querySelector('#export-status').textContent);
    const input=new Input({source:new BlobSource(video.blob),formats:ALL_FORMATS}),videoTrack=await input.getPrimaryVideoTrack(),audioTrack=await input.getPrimaryAudioTrack();let energy=0,count=0;
    if(audioTrack)for await(const sample of new AudioSampleSink(audioTrack).samples()){const channel=sample.toAudioBuffer().getChannelData(0);for(const value of channel){energy+=value*value;count++;}sample.close();}
    const packetCount=(await videoTrack.computePacketStats()).packetCount;input.dispose();
    let rejected=false;const invalid=structuredClone(scene);invalid.sequence.actions[0].hit='missing-region';try{await exportMedia({...args,scene:invalid,settings:{...settings,format:'png',start:.2}});}catch(error){rejected=error.message.includes('could not be reproduced');}
    const variants=[];
    for(const loopMode of ['ping-pong','crossfade']){
      const output=await exportMedia({...args,settings:{...settings,format:'webm',start:.09,end:.9,loopMode,fade:.2}}),input=new Input({source:new BlobSource(output.blob),formats:ALL_FORMATS}),track=await input.getPrimaryVideoTrack();
      variants.push({loopMode,frames:(await track.computePacketStats()).packetCount,expected:output.plan.frames});input.dispose();
    }
    return {clips:clips.map(clip=>({url:clip.url,offset:clip.offset})),backward,repeat,files:files.length,packetCount,expected:video.plan.frames,rms:Math.sqrt(energy/count),rejected,variants,x:scene.sequence.initial.objects[0].x};
  });
  const sound=result.clips.find(clip=>clip.url.includes('301619402_anim_anim2'));assert.ok(sound);assert.ok(Math.abs(sound.offset-.137)<1e-10,JSON.stringify(result));
  assert.equal(result.backward.end,'animation2');assert.equal(result.backward.start,'animation');assert.equal(result.backward.x,result.x);assert.equal(result.repeat,true);assert.equal(result.packetCount,result.expected);assert.equal(result.files,result.expected);assert.ok(result.rms>.001);assert.equal(result.rejected,true);
  assert.deepEqual(await page.evaluate(()=>window.mteEditor.snapshot()),original);assert.deepEqual(errors,[]);
  for(const variant of result.variants)assert.equal(variant.frames,variant.expected);
  console.log('Sequence export checks passed: recorded scene, exact click sound time, backward seek, identical PNG loops, decoded video/audio and rejected missing regions',result);
}finally{await browser.close();}
