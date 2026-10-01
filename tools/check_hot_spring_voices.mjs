import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {selectAsset} from './select_asset.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
  const roles=await page.evaluate(async()=>{const library=await fetch('/assets/library.json').then(r=>r.json());return library.hotSpringRoles;});assert.equal(roles.length,6);assert.equal(roles.reduce((count,role)=>count+role.levels.length,0),30);
  const media=await page.evaluate(async()=>{
    const library=await fetch('/assets/library.json').then(r=>r.json()),audio=window.mteAudio,ids=new Set(library.hotSpringRoles.flatMap(role=>role.levels.flatMap(pool=>pool.voiceIds))),context=new AudioContext(),decoded={a_sound_voiceeff:0,a_sound_voiceeff_ch:0},missing=[];
    try{for(const id of ids){const voice=library.voices.find(row=>row.id===id);if(!voice)throw new Error(`Voice metadata missing: ${id}`);for(const category of Object.keys(decoded)){const clip=audio.resolve(voice.resourceName,category);if(!clip){missing.push({id,category});continue;}const response=await fetch(audio.base+clip.path);if(!response.ok)throw new Error(`Voice download failed: ${id}`);const pcm=await context.decodeAudioData(await response.arrayBuffer());if(!pcm.length||pcm.duration<=0)throw new Error(`Voice decode failed: ${id}`);decoded[category]++;}}}finally{await context.close();}
    return {voices:ids.size,decoded,missing};
  });assert.equal(media.voices,52);assert.equal(media.decoded.a_sound_voiceeff+media.decoded.a_sound_voiceeff_ch+media.missing.length,104);
  for(const role of roles){
    await selectAsset(page,role.bundle);await page.waitForFunction(bundle=>window.mteStudio.groups[0]?.presentation.id===bundle,role.bundle);
    assert.equal(await page.locator('#voice-scope').inputValue(),'hot-spring');assert.match(await page.locator('#details').textContent(),/click behavior unavailable/);
    for(const pool of role.levels){await page.locator('#hot-spring-level').selectOption(String(pool.level));assert.deepEqual(await page.locator('#voice-list option').evaluateAll(nodes=>nodes.map(node=>node.value)),pool.voiceIds);assert.equal(await page.evaluate(()=>window.mteEditor.selected().hotSpringLevel),pool.level);}
  }
  await selectAsset(page,roles[0].bundle);await page.waitForFunction(bundle=>window.mteStudio.groups[0]?.presentation.id===bundle,roles[0].bundle);await page.locator('#hot-spring-level').selectOption('5');
  await page.getByRole('button',{name:'Play voice',exact:true}).click();await page.waitForFunction(()=>window.mteAudio.element.currentTime>.05);
  const speech=await page.evaluate(()=>({id:window.mteAudio.currentVoice.voice.id,text:window.mteAudio.currentVoice.voice.text,group:window.mteAudio.currentVoice.group}));assert.ok(roles[0].levels[4].voiceIds.includes(speech.id));assert.equal(await page.locator('#subtitle').textContent(),speech.text);assert.equal(speech.group,await page.evaluate(()=>window.mteEditor.selected().id));
  await page.getByRole('button',{name:'Stop voice',exact:true}).click();await page.locator('#pause').click();await page.waitForTimeout(500);const saved=await page.evaluate(()=>window.mteEditor.snapshot());assert.equal(saved.objects[0].hotSpringLevel,5);
  await page.locator('#hot-spring-sound').click();await page.waitForFunction(()=>[...window.mteAudio.effects].some(element=>element.currentTime>.05));assert.equal(await page.evaluate(()=>[...window.mteAudio.effects].at(-1).effectName),roles[0].ambientSound);await page.evaluate(()=>window.mteAudio.stopEffects());
  await page.locator('#hot-spring-level').selectOption('2');await page.getByRole('button',{name:'Undo',exact:true}).click();await page.waitForFunction(()=>!window.mteEditor.busy&&window.mteEditor.selected()?.hotSpringLevel===5);assert.equal(await page.locator('#hot-spring-level').inputValue(),'5');
  await page.getByRole('button',{name:'Duplicate',exact:true}).click();await page.waitForFunction(()=>window.mteStudio.groups.length===2&&!window.mteEditor.busy);assert.equal(await page.evaluate(()=>window.mteEditor.selected().hotSpringLevel),5);
  await page.locator('#scene-file').setInputFiles({name:'hot-spring.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});await page.waitForFunction(()=>window.mteStudio.groups.length===1&&!window.mteEditor.busy);assert.equal(await page.locator('#hot-spring-level').inputValue(),'5');
  await page.locator('#voice-scope').selectOption('story');assert.equal(await page.locator('#hot-spring-level').isVisible(),false);await page.locator('#voice-scope').selectOption('hot-spring');
  await page.waitForTimeout(700);await page.reload();await page.waitForFunction(()=>window.mteStudio?.groups.length===1&&!window.mteEditor.busy);assert.equal(await page.locator('#hot-spring-level').inputValue(),'5');
  await page.evaluate(()=>{const stage=window.mteStudio;stage.paused=false;window.voiceGapResult=stage.interact(stage.canvas.getBoundingClientRect().left+10,stage.canvas.getBoundingClientRect().top+10);});assert.equal(await page.evaluate(()=>window.voiceGapResult.reason),'No interaction region here');
  assert.deepEqual(errors,[]);console.log('Hot spring voice checks passed: six roles, all 30 source level pools, decoded available tracks, real audio/subtitle, object attribution, undo, duplication, import, reload and explicit missing click behavior',media);
}finally{await browser.close();}
