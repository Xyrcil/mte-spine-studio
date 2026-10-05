import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {launchTestBrowser} from './test_browser.mjs';
const engine=process.argv.slice(2).find(arg=>!arg.startsWith('--'))||'chromium',all=process.argv.includes('--all'),{browser,close}=await launchTestBrowser(engine);
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.routeWebSocket(url=>url.hostname==='127.0.0.1'&&url.port==='4173',socket=>socket.close());
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');
  await page.waitForSelector('#voice-panel');
  for(const track of ['a_sound_voiceeff','a_sound_voiceeff_ch']) {
    await page.getByLabel('Voice track',{exact:true}).selectOption(track);
    await page.getByRole('button',{name:'Play voice',exact:true}).click();
    await page.waitForFunction(()=>window.mteAudio.element.currentTime>0.1,null,{timeout:15000});
    const result=await page.evaluate(async()=>{
      const element=window.mteAudio.element;
      const context=new AudioContext();
      const response=await fetch(element.src);
      const decoded=await context.decodeAudioData(await response.arrayBuffer());
      await context.close();
      return {source:element.getAttribute('src'),duration:decoded.duration,channels:decoded.numberOfChannels,subtitle:document.querySelector('#subtitle').textContent};
    });
    if(!result.subtitle || result.duration<=0)throw new Error('Voice or subtitle was not loaded');
    console.log({track,...result});
    await page.getByRole('button',{name:'Stop voice',exact:true}).click();
    if(!await page.evaluate(()=>window.mteAudio.element.paused && !window.mteAudio.element.hasAttribute('src')))throw new Error('Stopped audio still has a resource');
  }
  const retryVoice=await page.evaluate(()=>{const bus=window.mteAudio,voice=bus.voiceRows.find(row=>bus.resolve(row.resourceName,'a_sound_voiceeff_ch'));return {voice,url:new URL(bus.base+bus.resolve(voice.resourceName,'a_sound_voiceeff_ch').path,location.href).href};});
  let blockedRequests=0;const block=async route=>{blockedRequests++;await route.fulfill({status:404,contentType:'audio/mp4',body:''});};await page.route(retryVoice.url,block);
  try{const failed=await page.evaluate(async voice=>{const bus=window.mteAudio;let rejected=false,reported=false;const listener=()=>reported=true;bus.addEventListener('audio-error',listener);try{await bus.play(voice,'a_sound_voiceeff_ch');}catch{rejected=true;}finally{bus.removeEventListener('audio-error',listener);}return {rejected,reported,track:bus.snapshot().voiceTrack,subtitle:bus.currentSubtitle};},retryVoice.voice);assert.ok(blockedRequests>0,'Audio failure route was not exercised');assert.ok(failed.rejected||failed.reported);assert.equal(failed.track,null);assert.equal(failed.subtitle,null);}finally{await page.unroute(retryVoice.url,block);}
  await page.evaluate(async voice=>window.mteAudio.play(voice,'a_sound_voiceeff_ch'),retryVoice.voice);await page.waitForFunction(()=>window.mteAudio.element.currentTime>.1);assert.equal(await page.locator('#subtitle').textContent(),retryVoice.voice.text);await page.evaluate(()=>window.mteAudio.stop());console.log(engine+': failed real audio clears captured voice and subtitle; the same voice plays after retry');
  const source=await page.evaluate(async()=>{const library=await fetch('/assets/library.json').then(r=>r.json()),{voiceCatalog}=await import('/src/engine/voice-catalog.js'),linked=new Set(voiceCatalog(library,library.appearances.map(row=>({appearanceId:row.id}))).map(row=>row.id)),unlinked=library.voices.filter(row=>!linked.has(row.id));return {count:library.voices.length,unlinked:unlinked.length,voice:unlinked.find(row=>window.mteAudio.resolve(row.resourceName,'a_sound_voiceeff_ch'))};});
  assert.ok(source.voice,'No available unlinked voice for the full-library check');
  await page.locator('#voice-scope').selectOption('all');assert.equal(await page.locator('#voice-list option').count(),source.count);await page.locator('#voice-search').fill(source.voice.id);await page.locator('#voice-list').selectOption(source.voice.id);await page.getByRole('button',{name:'Play voice',exact:true}).click();await page.waitForFunction(()=>window.mteAudio.element.currentTime>.1);
  assert.equal(await page.locator('#subtitle').textContent(),source.voice.text);assert.equal(await page.evaluate(()=>window.mteAudio.currentVoice.group),'');await page.getByRole('button',{name:'Stop voice',exact:true}).click();
  await page.getByRole('button',{name:'Export',exact:true}).click();await page.locator('#export-voice-scope').selectOption('all');await page.locator('#export-language').selectOption('a_sound_voiceeff_ch');await page.locator('#export-voice-search').fill(source.voice.id);assert.equal(await page.locator('#export-audio option').count(),2);await page.locator('#export-audio').selectOption(await page.locator('#export-audio option').nth(1).getAttribute('value'));
  await page.locator('#export-format').selectOption(engine==='firefox'?'webm':'mp4');for(const [key,value] of [['width','160'],['height','120'],['fps','10'],['end','.4']])await page.locator(`#export-${key}`).fill(value);
  const exported=await page.evaluate(async()=>{const output=await window.mteExporter.run();if(!output)throw new Error(document.querySelector('#export-status').textContent);const {Input,BlobSource,ALL_FORMATS,AudioSampleSink}=await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs'),input=new Input({source:new BlobSource(output.blob),formats:ALL_FORMATS});try{const track=await input.getPrimaryAudioTrack();if(!track)throw new Error('Exported voice track is missing');const sample=await new AudioSampleSink(track).getSample(.1);try{const data=sample.toAudioBuffer().getChannelData(0);return {frames:output.plan.frames,rms:Math.sqrt(data.reduce((sum,value)=>sum+value*value,0)/data.length)};}finally{sample.close();}}finally{input.dispose();}});assert.equal(exported.frames,4);assert.ok(exported.rms>.0001);
  console.log(engine+' complete voice selector, unlinked source playback and encoded export passed',{voices:source.count,unlinked:source.unlinked,exported});
  if(all){
    page.on('console',message=>{if(message.text().startsWith('Audio decoding:'))console.log(message.text());});
    const report=await page.evaluate(async()=>{
      const {aacGaplessMetadata,normalizeDecodedAac}=await import('/src/engine/audio-delay.js');
      const index=await fetch('/assets/audio-index.json').then(r=>r.json()),library=await fetch('/assets/library.json').then(r=>r.json()),clips=index.entries.flatMap(entry=>entry.clips.map(clip=>({...clip,category:entry.category}))),context=new AudioContext({sampleRate:48000}),failures=[],categories={};let next=0,decoded=0,trimmed=0;
      try{await Promise.all(Array.from({length:3},async()=>{while(next<clips.length){const clip=clips[next++];try{const response=await fetch('/assets/'+clip.path);if(!response.ok)throw new Error('HTTP '+response.status);const data=await response.arrayBuffer(),timing=aacGaplessMetadata(data),raw=await context.decodeAudioData(data),buffer=normalizeDecodedAac(context,raw,timing);if(buffer!==raw)trimmed++;if(!Number.isFinite(buffer.duration)||buffer.duration<=0)throw new Error('Invalid decoded duration');if(buffer.numberOfChannels!==clip.channels)throw new Error('Channel count differs from source');if(Math.abs(buffer.duration-clip.duration)>Math.max(.1,clip.duration*.005))throw new Error('Duration differs from source');decoded++;categories[clip.category]=(categories[clip.category]||0)+1;}catch(error){failures.push({path:clip.path,error:error.message});}if((decoded+failures.length)%256===0)console.log('Audio decoding: '+(decoded+failures.length)+'/'+clips.length);}}));
        const tracks=['a_sound_voiceeff','a_sound_voiceeff_ch'],availability={};for(const [kind,rows] of [['character',library.voices],['story',library.storyVoices]])availability[kind]=Object.fromEntries(tracks.map(track=>[track,{available:rows.filter(row=>window.mteAudio.resolve(row.resourceName,track)).length,total:rows.length}]));
        return {expected:clips.length,decoded,trimmed,categories,availability,extractionErrors:index.entries.filter(entry=>entry.errors.length).map(entry=>entry.id),failures};
      }finally{await context.close();}
    });await writeFile('private/audio-decoding-'+engine+'.json',JSON.stringify(report,null,2));console.log(engine+' full audio decoding',report);assert.deepEqual(report.failures,[]);assert.deepEqual(report.extractionErrors,[]);assert.equal(report.decoded,report.expected);
  }
  if(errors.length)throw new Error(errors.join('\n'));
}finally{await close();}
