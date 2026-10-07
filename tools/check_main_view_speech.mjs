import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';
import {selectAsset} from './select_asset.mjs';

const engine=process.argv[2]||'chromium',{browser,close}=await launchTestBrowser(engine);
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteAudio&&window.mteLibrary);
  await selectAsset(page,'Spines/drawing/station/601001');await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/drawing/station/601001'&&!window.mteEditor.busy);
  await page.evaluate(()=>window.mteHost.resume());await page.locator('#main-view-localized').check();
  await page.locator('#main-view-start').click();await page.locator('#main-view-touch').click();
  await page.waitForFunction(()=>window.mteAudio.currentVoice?.voice.sourceMainView&&window.mteAudio.element.currentTime>.05);
  const initial=await page.evaluate(async()=>{window.mteHost.pause();const scene=window.mteEditor.snapshot(),bus=window.mteAudio,source=window.mteStudio.mainViewSpeech.library.mainViewVoices,voice=bus.currentVoice.voice;
    if(!scene.mainViewSpeechClock.wordsRemaining||scene.mainViewSpeechClock.canClick||voice.resourceName.toLowerCase().includes('chest'))throw new Error('Source click gate or localization filter changed');
    if(bus.currentSubtitle.text!==(source.captions[voice.resourceName]||''))throw new Error('Source caption visibility changed');
    await window.mteEditor.restore(scene);if(JSON.stringify(scene)!==JSON.stringify(window.mteEditor.snapshot()))throw new Error('Main-view checkpoint changed on restore');
    return {name:voice.resourceName,remaining:scene.mainViewSpeechClock.wordsRemaining,exact:scene.audio.voiceTrack.exactResource,source:scene.audio.voiceTrack.sourceMainView,silent:bus.element.muted};
  });assert.equal(initial.exact,true);assert.equal(initial.source,true);assert.equal(initial.silent,true);
  await page.locator('#main-view-stop').click();await page.locator('#sequence-record').click();
  await page.locator('#main-view-start').click();await page.locator('#main-view-touch').click();await page.waitForFunction(()=>window.mteAudio.currentVoice?.voice.sourceMainView);
  const automatic=await page.evaluate(()=>{const stage=window.mteStudio,voices=[],hides=[],voice=event=>voices.push(event.detail),hide=event=>hides.push(event.detail);stage.addEventListener('voice-request',voice);stage.addEventListener('voice-caption-hide-request',hide);
    try{const remaining=stage.mainViewSpeechClock.value.wordsRemaining;stage.evaluate(remaining+120+.05);if(voices.length!==1||hides.length!==1||!voices[0].sourceResource)throw new Error('Original completion and two-minute idle callback did not run');return {resource:voices[0].sourceResource,late:voices[0].lateness,gameAdvance:remaining+120+.05};}
    finally{stage.removeEventListener('voice-request',voice);stage.removeEventListener('voice-caption-hide-request',hide);}
  });
  await page.waitForFunction(name=>window.mteAudio.currentVoice?.voice.resourceName===name&&window.mteAudio.element.currentTime>.05,automatic.resource);await page.locator('#sequence-stop').click();
  const recorded=await page.evaluate(()=>window.mteStudio.sequence);assert.deepEqual(recorded.actions.map(row=>row.type),['main-view-speech','main-view-speech']);
  const output=await page.evaluate(async engine=>{
    const stage=window.mteStudio,scene=window.mteEditor.snapshot(),library=stage.mainViewSpeech.library,bus=window.mteAudio,catalog=stage.groups.map(group=>group.presentation),entries=(await fetch('/assets/runtime-index.json').then(response=>response.json())).entries;
    const {RenderSession,collectInteractionEffects,exportMedia}=await import('/src/engine/export.js'),{exportPlan}=await import('/src/engine/export-plan.js'),{interactionExportProvider}=await import('/src/engine/interaction-export.js'),{sequenceCacheResources}=await import('/src/engine/sequence-cache.js');
    const settings={useSequence:true,format:engine==='firefox'?'webm':'mp4',width:320,height:240,fps:8,speed:1,start:scene.sequence.duration,end:scene.sequence.duration+1.25,loops:1,loopMode:'repeat',background:scene.background,fit:'contain',crop:{x:0,y:0,width:1,height:1}},plan=exportPlan(settings),session=new RenderSession(scene,catalog,entries,stage.imageAssets,4/3,plan),provider=interactionExportProvider(library,bus,scene.sequence.initial);
    let trajectories;
    try{await session.initialize();const events=await collectInteractionEffects(session,plan,null,()=>{},provider);if(events.voices.length!==2||events.captionStops.length!==1)throw new Error('Recorded automatic speech was not reproduced');
      const touch=events.voices[0],idle=events.voices[1];if(!touch.captionUntil||touch.until!==idle.offset)throw new Error('Source words completion stopped audio instead of captions');
      await session.seek(scene.sequence.duration);if(session.stage.mainViewSpeech.value.group!==stage.mainViewSpeech.value.group||session.stage.mainViewSpeech.value.random!==stage.mainViewSpeech.value.random)throw new Error('Recorded speaker or random stream changed');
      await session.seek(scene.sequence.actions[1].at+.5);if(!session.stage.mainViewSpeech.value.wordsVisible||session.stage.mainViewSpeechClock.value.canClick)throw new Error('Backward seek failed to restore source speech');
      trajectories={voices:events.voices.length,captionStops:events.captionStops.length,captionUntil:touch.captionUntil,audioUntil:touch.until,idleAt:idle.offset,backwardSeek:true};
    }finally{session.dispose();}
    const cached=await sequenceCacheResources(scene.sequence,{catalog,entries,imageAssets:stage.imageAssets,audio:bus,library,base:location.href});if(cached.warnings.length)throw new Error('Source sequence cache warnings: '+cached.warnings.join('; '));
    const out=await exportMedia({scene,catalog,entries,imageAssets:stage.imageAssets,sourceAspect:4/3,settings,interactionProvider:provider}),{Input,BlobSource,ALL_FORMATS,AudioSampleSink}=await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs'),input=new Input({source:new BlobSource(out.blob),formats:ALL_FORMATS});let energy=0,count=0;
    try{const audio=await input.getPrimaryAudioTrack();if(!audio)throw new Error('Export lost automatic speech');for await(const sample of new AudioSampleSink(audio).samples()){for(const value of sample.toAudioBuffer().getChannelData(0)){energy+=value*value;count++;}sample.close();}}finally{input.dispose();}
    const rms=Math.sqrt(energy/count);if(!(rms>.001))throw new Error('Exported automatic speech is silent');if(JSON.stringify(scene)!==JSON.stringify(window.mteEditor.snapshot()))throw new Error('Export changed the editor scene');
    return {...trajectories,format:settings.format,frames:out.plan.frames,rms,cacheUrls:cached.urls.length,scenePreserved:true};
  },engine);
  assert.deepEqual(errors,[]);console.log('Main-view source speech checks passed',{engine,initial,automatic,recordedActions:recorded.actions.length,output});
}finally{await close();}
