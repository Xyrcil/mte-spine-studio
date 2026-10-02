import {selectAsset} from './select_asset.mjs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';

const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1600,height:1200}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
  await selectAsset(page,'Spines/painting/301301101_spine');await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/painting/301301101_spine');
  await page.evaluate(async()=>{
    const {InteractionRecorder}=await import('/src/engine/interaction-sequence.js'),stage=window.mteStudio,first=stage.groups[0],entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries;
    stage.paused=true;window.mteAudio.stop();window.mteAudio.stopEffects();window.mteAudio.language='a_sound_voiceeff_ch';
    const second=await stage.add(first.presentation,entries.filter(entry=>entry.bundle===first.presentation.id));
    for(const group of [first,second]){const root=group.controllers[0];root.reset();root.play('animation',0,true);}stage.evaluate(0);stage.fit();
    const recorder=new InteractionRecorder(stage);recorder.start();
    for(const [group,event,delta] of [[first,2,.137],[second,3,.3]]){stage.evaluate(delta);const root=group.controllers[0],hit=root.hotspots.find(hit=>hit.event===event),result=stage.triggerInteraction(group.id,root.source.id,hit.id);if(!result.accepted)throw new Error(result.reason);}
    stage.evaluate(.6);recorder.stop();recorder.dispose();
  });
  const original=await page.evaluate(()=>window.mteEditor.snapshot());await page.locator('[data-view="export"]').click();await page.locator('#export-use-sequence').check();await page.locator('#export-effects').uncheck();await page.locator('#export-ambient').uncheck();
  for(const [key,value] of [['width','320'],['height','240'],['fps','10'],['end','1'],['loops','2']])await page.locator(`#export-${key}`).fill(value);
  const result=await page.evaluate(async()=>{
    const {exportMedia,RenderSession,collectInteractionEffects}=await import('/src/engine/export.js'),{exportPlan}=await import('/src/engine/export-plan.js'),{interactionExportProvider}=await import('/src/engine/interaction-export.js'),{sceneCaptionWeight}=await import('/src/engine/export-audio.js'),{Input,BlobSource,ALL_FORMATS,AudioSampleSink}=await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs');
    const stage=window.mteStudio,audio=window.mteAudio,scene=window.mteExporter.captured,library=await fetch('/assets/library.json').then(r=>r.json()),catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries,settings=window.mteExporter.settings(),plan=exportPlan(settings,scene.sequence.initial.speed),args={scene,catalog,entries,imageAssets:stage.imageAssets,sourceAspect:stage.canvas.width/stage.canvas.height,settings},provider=interactionExportProvider(library,audio,scene.sequence.initial);
    const session=new RenderSession(scene,catalog,entries,stage.imageAssets,args.sourceAspect,plan);let voices;
    try{await session.initialize();voices=(await collectInteractionEffects(session,plan,null,()=>{},provider)).voices;}finally{session.dispose();}
    const output=await window.mteExporter.run();if(!output)throw new Error(document.querySelector('#export-status').textContent);
    const input=new Input({source:new BlobSource(output.blob),formats:ALL_FORMATS}),track=await input.getPrimaryAudioTrack(),pcm=new Float32Array(96000);
    for await(const sample of new AudioSampleSink(track).samples()){const channel=sample.toAudioBuffer().getChannelData(0),start=Math.round(sample.timestamp*48000),skip=Math.max(0,-start),target=Math.max(0,start);if(target<pcm.length)pcm.set(channel.subarray(skip,skip+pcm.length-target),target);sample.close();}input.dispose();
    const rms=(start,end)=>{const data=pcm.subarray(Math.round(start*48000),Math.round(end*48000));return Math.sqrt(data.reduce((sum,value)=>sum+value*value,0)/data.length);};
    const context=new AudioContext({sampleRate:48000}),second=await context.decodeAudioData(await (await fetch(voices[1].url)).arrayBuffer()),reference=second.getChannelData(0);let expectedEnergy=0,difference=0;
    for(let index=Math.round(.65*48000);index<Math.round(.85*48000);index++){const position=(index/48000-voices[1].offset)*second.sampleRate,at=Math.floor(position),fraction=position-at,value=(reference[at]*(1-fraction)+reference[at+1]*fraction)*scene.sequence.initial.audio.voiceVolume;expectedEnergy+=value*value;difference+=(pcm[index]-value)**2;}await context.close();
    const captionOnly=interactionExportProvider(library,audio,scene.sequence.initial,{includeAudio:false,includeSubtitles:true});
    async function pixels(blob){const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();return ctx.getImageData(0,0,canvas.width,canvas.height).data;}
    const captionDiff=[];
    for(const start of [.25,.65]){const options={...settings,format:'png',start,end:1},withCaption=await exportMedia({...args,settings:options,interactionProvider:captionOnly}),plain=await exportMedia({...args,settings:options}),a=await pixels(withCaption.blob),b=await pixels(plain.blob);captionDiff.push(a.reduce((sum,value,index)=>sum+Number(value!==b[index]),0));}
    const mutedScene=structuredClone(scene);mutedScene.sequence.initial.audio.muted=true;
    const muted=await exportMedia({...args,scene:mutedScene,interactionProvider:provider}),mutedInput=new Input({source:new BlobSource(muted.blob),formats:ALL_FORMATS}),noAudio=await mutedInput.getPrimaryAudioTrack()===null;mutedInput.dispose();
    const weights=voices.map(voice=>[.25,.65].map(time=>sceneCaptionWeight(plan,time,{...voice,rate:voice.sceneRate,duration:10})));
    const expectedTexts=scene.sequence.actions.map(action=>{const object=scene.sequence.initial.objects.find(object=>object.id===action.group),hit=catalog.find(presentation=>presentation.id===object.bundle).hotspots.find(hit=>hit.id===action.hit);return library.voices.find(voice=>voice.resourceName===hit.audio).text;});
    const missingAudio=Object.create(audio),missingNames=scene.sequence.actions.map(action=>{const object=scene.sequence.initial.objects.find(object=>object.id===action.group);return catalog.find(presentation=>presentation.id===object.bundle).hotspots.find(hit=>hit.id===action.hit).audio;});
    missingAudio.resolve=(name,language)=>language==='a_sound_voiceeff_ch'&&missingNames.includes(name.split('/').at(-1))?null:audio.resolve(name,language);
    const missingProvider=interactionExportProvider(library,missingAudio,scene.sequence.initial),missingExport=await exportMedia({...args,settings:{...settings,format:'png',start:.65,end:1},interactionProvider:missingProvider});
    const {sequenceCacheResources}=await import('/src/engine/sequence-cache.js'),missingCache=await sequenceCacheResources(scene.sequence,{catalog,entries,imageAssets:stage.imageAssets,audio:missingAudio,library,base:new URL('/',location.href),sourceAspect:args.sourceAspect});
    const expectedWarnings=missingNames.map(name=>`Voice unavailable (a_sound_voiceeff_ch): ${name}`);
    return {voices:voices.map(voice=>({url:voice.url,text:voice.text,offset:voice.offset,until:voice.until})),expectedTexts,count:output.interactionVoices,early:rms(0,.1),first:rms(.2,.4),second:rms(.6,.9),replacementError:Math.sqrt(difference/expectedEnergy),captionDiff,noAudio,weights,missing:{expectedWarnings,exportWarnings:missingExport.warnings.filter(warning=>warning.startsWith('Voice unavailable')),cacheWarnings:missingCache.warnings.filter(warning=>warning.startsWith('Voice unavailable')),exportVoices:missingExport.interactionVoices}};
  });
  assert.equal(result.voices.length,2);assert.equal(result.count,2);assert.ok(result.voices.every(voice=>voice.url.includes('/a_sound_voiceeff_ch/')));assert.deepEqual(result.voices.map(voice=>voice.text),result.expectedTexts);assert.ok(result.expectedTexts.every(Boolean));
  assert.ok(Math.abs(result.voices[0].offset-.137)<1e-10);assert.ok(Math.abs(result.voices[0].until-.437)<1e-10);assert.deepEqual(result.weights,[[1,0],[0,1]]);assert.ok(result.early<.001);assert.ok(result.first>.001);assert.ok(result.second>.001);assert.ok(result.captionDiff.every(value=>value>100));assert.equal(result.noAudio,true);
  assert.ok(result.replacementError<.3,JSON.stringify(result));
  assert.deepEqual(result.missing.exportWarnings,result.missing.expectedWarnings);assert.deepEqual(result.missing.cacheWarnings,result.missing.expectedWarnings);assert.equal(result.missing.exportVoices,0);
  assert.deepEqual(await page.evaluate(()=>window.mteEditor.snapshot()),original);assert.deepEqual(errors,[]);console.log('Scheduled voice export checks passed: Chinese skin voices, exact timestamps, interruption, decoded audio, caption-only PNG and muted subtitles',result);
}finally{await browser.close();}
