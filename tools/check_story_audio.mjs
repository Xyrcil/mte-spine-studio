import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForSelector('#voice-panel');
  const sourceText=await page.evaluate(async()=>{const library=await fetch('/assets/library.json').then(r=>r.json());return library.storyVoices.find(row=>row.id==='8400001').text;});
  await page.locator('#voice-scope').selectOption('story');assert.equal(await page.locator('#voice-list option').count(),1613);
  await page.locator('#voice-search').fill(sourceText);assert.equal(await page.locator('#voice-list option').count(),1);
  await page.getByLabel('Voice track',{exact:true}).selectOption('a_sound_voiceeff');assert.equal(await page.getByRole('button',{name:'Play voice',exact:true}).isDisabled(),true);
  await page.getByLabel('Voice track',{exact:true}).selectOption('a_sound_voiceeff_ch');await page.getByRole('button',{name:'Play voice',exact:true}).click();await page.waitForFunction(()=>window.mteAudio.element.currentTime>.1);
  assert.equal(await page.locator('#subtitle').textContent(),sourceText);assert.ok(await page.evaluate(()=>window.mteAudio.element.src.includes('Voice_Plot_0_3000000_1/')));
  await page.getByRole('button',{name:'Stop voice',exact:true}).click();assert.equal(await page.locator('#subtitle').textContent(),'');
  await page.getByRole('button',{name:'Pause',exact:true}).click();await page.getByRole('button',{name:'Export',exact:true}).click();await page.locator('#export-language').selectOption('a_sound_voiceeff_ch');await page.locator('#export-voice-scope').selectOption('story');await page.locator('#export-voice-search').fill(sourceText);assert.equal(await page.locator('#export-audio option').count(),2);
  const value=await page.locator('#export-audio option').nth(1).getAttribute('value');await page.locator('#export-audio').selectOption(value);
  for(const [key,value] of [['width','160'],['height','120'],['fps','10'],['end','1']])await page.locator(`#export-${key}`).fill(value);
  const result=await page.evaluate(async()=>{const out=await window.mteExporter.run(),{Input,BlobSource,ALL_FORMATS,AudioSampleSink}=await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs');if(!out)throw new Error(document.querySelector('#export-status').textContent);const input=new Input({source:new BlobSource(out.blob),formats:ALL_FORMATS}),track=await input.getPrimaryAudioTrack(),sample=await new AudioSampleSink(track).getSample(.5),data=sample.toAudioBuffer().getChannelData(0),rms=Math.sqrt(data.reduce((sum,v)=>sum+v*v,0)/data.length);sample.close();input.dispose();return {frames:out.plan.frames,rms};});assert.equal(result.frames,10);assert.ok(result.rms>.001);assert.deepEqual(errors,[]);console.log('Story audio browser checks passed: all source rows, search, missing language, subtitle, playback and encoded video',result);
}finally{await browser.close();}
