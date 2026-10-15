import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';
const engine=process.argv[2]||'chromium',{browser,close}=await launchTestBrowser(engine);
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForSelector('#voice-panel');
  const source=await page.evaluate(async()=>{
    const library=await fetch('/assets/library.json').then(r=>r.json()),index=await fetch('/assets/audio-index.json').then(r=>r.json()),{audioResourceLookup}=await import('/src/engine/audio.js'),lookup=audioResourceLookup(index,library.soundResources),languages=['a_sound_voiceeff','a_sound_voiceeff_ch'];
    const voice=library.storyVoices.find(row=>row.id==='8400001');if(!voice)throw new Error('Story fixture is absent from the source catalogue');
    return {voice,ids:library.storyVoices.map(row=>row.id),tracks:languages.map(language=>({language,clip:lookup.resolve(voice.resourceName,language)})),missing:library.storyVoices.flatMap(row=>languages.filter(language=>!lookup.resolve(row.resourceName,language)).map(language=>({id:row.id,language}))).slice(0,1)};
  });const sourceText=source.voice.text;assert.ok(source.ids.length>0);assert.ok(sourceText);
  assert.equal(await page.evaluate(()=>window.__mteSilentTest),true);
  await page.locator('#voice-scope').selectOption('story');assert.deepEqual(await page.locator('#voice-list option').evaluateAll(nodes=>nodes.map(node=>node.value)),source.ids);
  for(const missing of source.missing){await page.getByLabel('Voice track',{exact:true}).selectOption(missing.language);await page.locator('#voice-list').selectOption(missing.id);assert.equal(await page.getByRole('button',{name:'Play voice',exact:true}).isDisabled(),true);assert.match(await page.locator('#voice-availability').textContent(),/Audio absent for this language/);}
  await page.locator('#voice-search').fill(sourceText);assert.deepEqual(await page.locator('#voice-list option').evaluateAll(nodes=>nodes.map(node=>node.value)),[source.voice.id]);
  for(const {language,clip} of source.tracks){
    await page.getByLabel('Voice track',{exact:true}).selectOption(language);assert.equal(await page.getByRole('button',{name:'Play voice',exact:true}).isDisabled(),!clip);if(!clip)continue;
    await page.getByRole('button',{name:'Play voice',exact:true}).click();await page.waitForFunction(()=>window.mteAudio.element.currentTime>.1);
    assert.equal(await page.locator('#subtitle').textContent(),sourceText);assert.equal(await page.evaluate(()=>window.mteAudio.element.src),new URL('assets/'+clip.path,page.url()).href);assert.equal(await page.evaluate(()=>window.mteAudio.element.muted),true);
    await page.getByRole('button',{name:'Stop voice',exact:true}).click();assert.equal(await page.locator('#subtitle').textContent(),'');
  }
  assert.ok(source.tracks.find(row=>row.language==='a_sound_voiceeff_ch')?.clip,'Chinese story export fixture must exist');
  await page.getByRole('button',{name:'Pause',exact:true}).click();await page.getByRole('button',{name:'Export',exact:true}).click();await page.locator('#export-language').selectOption('a_sound_voiceeff_ch');await page.locator('#export-voice-scope').selectOption('story');await page.locator('#export-voice-search').fill(sourceText);
  const value=`story:${source.voice.id}:${source.voice.resourceName}`;assert.deepEqual(await page.locator('#export-audio option').evaluateAll(nodes=>nodes.map(node=>node.value)),['',value]);await page.locator('#export-audio').selectOption(value);
  for(const [key,value] of [['width','160'],['height','120'],['fps','10'],['end','1']])await page.locator(`#export-${key}`).fill(value);
  const result=await page.evaluate(async()=>{
    const {exportVideoSupport}=await import('/src/engine/export.js'),{Input,BlobSource,ALL_FORMATS,AudioSampleSink,canEncodeAudio,Quality}=await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs');let format;const unavailable=[];
    for(const candidate of ['mp4','webm']){try{await exportVideoSupport({...window.mteExporter.settings(),format:candidate},window.mteExporter.captured.speed);if(!await canEncodeAudio(candidate==='mp4'?'aac':'opus',{sampleRate:48000,numberOfChannels:2,quality:new Quality({bitrate:128000})}))throw new Error('Audio encoder unavailable');format=candidate;break;}catch(error){unavailable.push({format:candidate,reason:error.message});}}
    if(!format){document.querySelector('#export-format').value='mp4';if(await window.mteExporter.run())throw new Error('Unsupported video export unexpectedly succeeded');const warning=document.querySelector('#export-status').textContent;if(!/unavailable|PNG sequence/i.test(warning))throw new Error(warning);document.querySelector('#export-format').value='sequence';const sequence=await window.mteExporter.run();if(!sequence)throw new Error(document.querySelector('#export-status').textContent);return {fallback:true,frames:sequence.plan.frames,bytes:sequence.blob.size,unavailable};}
    document.querySelector('#export-format').value=format;const out=await window.mteExporter.run();if(!out)throw new Error(document.querySelector('#export-status').textContent);
    const input=new Input({source:new BlobSource(out.blob),formats:ALL_FORMATS});try{const track=await input.getPrimaryAudioTrack();if(!track)throw new Error('Export omitted story audio');const sample=await new AudioSampleSink(track).getSample(.5);if(!sample)throw new Error('Story audio sample unavailable');try{const data=sample.toAudioBuffer().getChannelData(0),rms=Math.sqrt(data.reduce((sum,v)=>sum+v*v,0)/data.length);return {format,frames:out.plan.frames,rms};}finally{sample.close();}}finally{input.dispose();}
  });assert.equal(result.frames,10);if(result.fallback)assert.ok(result.bytes>0);else assert.ok(result.rms>.001);assert.deepEqual(errors,[]);console.log(`${engine}: Story audio checks passed: exact source rows, search, indexed language availability, ${source.missing.length?'real missing-resource fixture, ':''}subtitle, silent playback and ${result.fallback?'explicit video-unavailable/PNG fallback (no encoded audio verified)':'encoded video audio'}`,result);
}finally{await close();}
