import {selectAsset} from './select_asset.mjs';
import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';
const engine=process.argv[2]||'chromium',{browser,close}=await launchTestBrowser(engine);
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
  const routing=await page.evaluate(async()=>{
    const library=await fetch('/assets/library.json').then(r=>r.json()),{resolveInteractionVoice}=await import('/src/engine/interaction-audio.js');
    let checked=0;const failures=[];
    for(const row of library.voices){
      const match=/^Voice_(\d{9})_Touch_(Head|Hand|Chest)$/.exec(row.resourceName);if(!match)continue;
      const base=`Voice_${match[1].slice(0,-2)}_Touch_${match[2]}`;if(!library.voices.some(item=>item.resourceName===base))continue;
      const calls=[],audio={resolve:name=>{calls.push(name);return name===base?{}:null;}};
      const result=resolveInteractionVoice({skinId:match[1],event:{Head:2,Hand:1,Chest:3}[match[2]]},library,audio,'a_sound_voiceeff_ch');
      if(result!==null||calls.includes(base))failures.push(row.resourceName);checked++;
    }
    return {checked,failures};
  });assert.ok(routing.checked>0);assert.deepEqual(routing.failures,[]);console.log(`Checked ${routing.checked} real skin/base pairs with unavailable skin audio: no substituted base lines`);
  await selectAsset(page,'Spines/painting/301600901_spine');await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/painting/301600901_spine');
  const clicked=await page.evaluate(()=>{const stage=window.mteStudio,root=stage.groups[0].controllers[0];return root.click(root.hotspots.find(hit=>hit.event===4));});assert.equal(clicked.accepted,true);assert.equal(clicked.animation,'stand_down');
  await page.waitForFunction(()=>[...window.mteAudio.effects].some(effect=>effect.currentTime>.05&&effect.src.includes('301600901_cm_Foot_Down/')));
  const effect=await page.evaluate(()=>{const bus=window.mteAudio,element=[...bus.effects].find(effect=>effect.src.includes('301600901_cm_Foot_Down/'));return {actual:element.volume,expected:bus.effectVolume*bus.soundInfo('301600901_cm_Foot_Down','a_sound_ui').volume};});assert.equal(effect.actual,effect.expected);
  const expected=await page.evaluate(async()=>{const library=await fetch('/assets/library.json').then(r=>r.json()),row=library.voices.find(row=>row.targetId==='301600901'&&row.alias&&window.mteAudio.resolve(row.resourceName,'a_sound_voiceeff_ch'));window.mteAudio.language='a_sound_voiceeff_ch';document.querySelector('#voice-language').value='a_sound_voiceeff_ch';window.mteStudio.dispatchEvent(new CustomEvent('voice-request',{detail:{skinId:'301600901',explicit:'SoundRes/a_sound_voiceeff/'+row.alias,event:2}}));return {text:row.text,name:row.resourceName};});
  await page.waitForFunction(()=>window.mteAudio.element.currentTime>.05);assert.equal(await page.locator('#subtitle').textContent(),expected.text);assert.ok(await page.evaluate(name=>window.mteAudio.element.src.includes('/'+name+'/'),expected.name));assert.deepEqual(errors,[]);
  await selectAsset(page,'Spines/painting/301619101_spine');await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/painting/301619101_spine');
  const head=await page.evaluate(async()=>{const stage=window.mteStudio,root=stage.groups[0].controllers[0];window.headSounds=[];stage.addEventListener('sound-request',event=>window.headSounds.push(event.detail.name));root.value.isBig=true;const result=root.click(root.hotspots.find(hit=>hit.event===13)),library=await fetch('/assets/library.json').then(r=>r.json()),voice=library.voices.find(row=>row.resourceName==='Voice_3016191_Touch_Head');return {result,text:voice.text};});assert.equal(head.result.accepted,true);
  await page.waitForFunction(()=>window.mteAudio.element.currentTime>.05);assert.equal(await page.locator('#subtitle').textContent(),head.text);assert.equal(await page.evaluate(()=>window.headSounds.filter(name=>name==='301619101_cm_click_03_head').length),1);assert.match(await page.locator('#status').textContent(),/Sound unavailable: 301619101_cm_click_03_head/);assert.deepEqual(errors,[]);
  await selectAsset(page,'Spines/painting/301301101_spine');await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/painting/301301101_spine');
  const position=await page.evaluate(()=>{
    const stage=window.mteStudio,group=stage.groups[0],root=group.controllers[0],audio=window.mteAudio,resolve=audio.resolve.bind(audio);audio.stop();audio.stopEffects();
    audio.resolve=(name,language)=>name.split('/').at(-1)==='Voice_301301101_Touch_Head'&&language==='a_sound_voiceeff_ch'?null:resolve(name,language);
    document.querySelector('#voice-language').value='a_sound_voiceeff_ch';root.reset();root.play('animation',0,true);stage.evaluate(0);stage.fit();stage.paused=false;
    const hit=root.hotspots.find(hit=>hit.event===1),m=root.matrix(hit),offset=hit.colliders[0].data.m_Offset,world={x:m[0]*offset.x+m[2]*offset.y+m[4],y:m[1]*offset.x+m[3]*offset.y+m[5]},rect=stage.canvas.getBoundingClientRect(),width=Math.max(stage.camera.width,stage.camera.height*rect.width/rect.height),height=width*rect.height/rect.width;
    return {x:rect.left+((world.x-stage.camera.x)/width+.5)*rect.width,y:rect.top+(.5-(world.y-stage.camera.y)/height)*rect.height,actual:root.hitAt(world.x,world.y)?.id,target:hit.id};
  });assert.equal(position.actual,position.target);await page.mouse.click(position.x,position.y);
  await page.waitForFunction(()=>document.querySelector('#status').textContent==='Voice unavailable (a_sound_voiceeff_ch): Voice_301301101_Touch_Head');
  assert.equal(await page.evaluate(()=>window.mteAudio.currentVoice),null);assert.deepEqual(errors,[]);
  await selectAsset(page,'Spines/painting/301619201_spine');await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/painting/301619201_spine'&&!window.mteEditor.busy);
  const missingClick=await page.evaluate(async()=>{
    const {InteractionRecorder}=await import('/src/engine/interaction-sequence.js'),stage=window.mteStudio,group=stage.groups[0],root=group.controllers[0],audio=window.mteAudio;
    stage.paused=true;audio.stop();audio.stopEffects();audio.language='a_sound_voiceeff_ch';document.querySelector('#voice-language').value=audio.language;
    for(let i=0;i<3600&&root.primary.state.getCurrent(0)?.animation.name==='start';i++)stage.evaluate(1/120);
    const recorder=new InteractionRecorder(stage);recorder.start();stage.evaluate(.137);stage.paused=false;const result=stage.triggerInteraction(group.id,root.source.id,root.hotspots.find(hit=>hit.name==='HitArea_tou').id);stage.evaluate(.6);
    window.missingVoiceSequence=JSON.parse(JSON.stringify(recorder.stop()));recorder.dispose();return {result,actions:window.missingVoiceSequence.actions};
  });assert.equal(missingClick.result.accepted,false);assert.equal(missingClick.result.unavailable,true);assert.equal(missingClick.result.animation,'click_02');assert.equal(missingClick.actions.length,1);assert.equal(missingClick.actions[0].unavailable,true);assert.ok(Math.abs(missingClick.actions[0].at-.137)<1e-10);
  await page.waitForFunction(()=>window.mteAudio.currentVoice?.voice.resourceName==='Voice_301619201_Touch_Head'&&window.mteAudio.element.currentTime>.05);assert.match(await page.locator('#subtitle').textContent(),/发簪/);await page.evaluate(()=>window.mteAudio.pause());
  const missingExport=await page.evaluate(async()=>{
    const {exportMedia,exportVideoSupport,RenderSession,collectInteractionEffects}=await import('/src/engine/export.js'),{exportPlan}=await import('/src/engine/export-plan.js'),{interactionExportProvider}=await import('/src/engine/interaction-export.js'),{sequenceCacheResources}=await import('/src/engine/sequence-cache.js'),{Input,BlobSource,ALL_FORMATS,AudioSampleSink}=await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs');
    const stage=window.mteStudio,audio=window.mteAudio,sequence=window.missingVoiceSequence,scene={...sequence.initial,sequence},library=await fetch('/assets/library.json').then(r=>r.json()),catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries;
    const settings={useSequence:true,format:'png',width:320,height:240,fps:10,start:.35,end:1,speed:1,loops:1,loopMode:'repeat',background:scene.background,fit:'contain',crop:{x:0,y:0,width:1,height:1}},args={scene,catalog,entries,imageAssets:stage.imageAssets,sourceAspect:stage.canvas.width/stage.canvas.height,settings},provider=interactionExportProvider(library,audio,sequence.initial),plan=exportPlan(settings,1),session=new RenderSession(scene,catalog,entries,stage.imageAssets,args.sourceAspect,plan);let scheduled;
    try{await session.initialize();scheduled=await collectInteractionEffects(session,plan,null,()=>{},provider);}finally{session.dispose();}
    const captionOnly=interactionExportProvider(library,audio,sequence.initial,{includeAudio:false,includeSubtitles:true}),caption=await exportMedia({...args,interactionProvider:captionOnly}),plain=await exportMedia(args);
    async function pixels(blob){const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();return ctx.getImageData(0,0,canvas.width,canvas.height).data;}
    const left=await pixels(caption.blob),right=await pixels(plain.blob),captionDifference=left.reduce((sum,value,index)=>sum+Number(value!==right[index]),0),cache=await sequenceCacheResources(sequence,{catalog,entries,imageAssets:stage.imageAssets,audio,library,base:new URL('/',location.href),sourceAspect:args.sourceAspect});
    let videoSettings;for(const format of ['mp4','webm']){const candidate={...settings,format,start:0,loops:2};try{await exportVideoSupport(candidate,1);videoSettings=candidate;break;}catch{}}
    if(!videoSettings)throw new Error('No video encoder available for the missing-animation voice check');const video=await exportMedia({...args,settings:videoSettings,interactionProvider:provider}),input=new Input({source:new BlobSource(video.blob),formats:ALL_FORMATS});
    let energy=0,count=0,earlyEnergy=0,earlyCount=0;try{const track=await input.getPrimaryAudioTrack();if(!track)throw new Error('Missing-animation voice was omitted from the video');for await(const sample of new AudioSampleSink(track).samples()){const values=sample.toAudioBuffer().getChannelData(0);for(let i=0;i<values.length;i++){energy+=values[i]**2;count++;if(sample.timestamp+i/48000<.08){earlyEnergy+=values[i]**2;earlyCount++;}}sample.close();}}finally{input.dispose();}
    return {voices:scheduled.voices.map(row=>({url:row.url,offset:row.offset,text:row.text})),captionDifference,cached:scheduled.voices.length===1&&cache.urls.includes(new URL(scheduled.voices[0].url,location.href).href),format:videoSettings.format,videoVoices:video.interactionVoices,rms:Math.sqrt(energy/count),earlyRms:Math.sqrt(earlyEnergy/earlyCount)};
  });assert.equal(missingExport.voices.length,1);assert.ok(missingExport.voices[0].url.includes('/Voice_301619201_Touch_Head/'));assert.ok(Math.abs(missingExport.voices[0].offset-.137)<1e-10);assert.ok(missingExport.captionDifference>100);assert.equal(missingExport.cached,true);assert.equal(missingExport.videoVoices,1);assert.ok(missingExport.rms>.001);assert.ok(missingExport.earlyRms<.001);assert.deepEqual(errors,[]);
  console.log(engine+': Interaction audio passed: real sounds/subtitles, missing-track warning and missing-animation voice playback, recorded timestamp, caption-only PNG, cache preparation and loop-video audio',missingExport);
}finally{await close();}
