import {selectAsset} from './select_asset.mjs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});
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
  console.log('Interaction audio checks passed: real foot sound, head voice despite missing effect, deduplication, metadata gain, path alias, language and source subtitle');
}finally{await browser.close();}
