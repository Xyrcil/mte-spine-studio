import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.evaluate(async()=>{const audio=window.mteAudio;await audio.playEffect('301619402_animation','a_sound_ui',.2,true,window.mteStudio.groups[0].id);});
  await page.waitForFunction(()=>[...window.mteAudio.effects][0]?.currentTime>.25);await page.evaluate(()=>window.mteAudio.pause());
  const saved=await page.evaluate(()=>window.mteEditor.snapshot());assert.equal(saved.audio.effectTracks.length,1);
  await page.locator('#scene-file').setInputFiles({name:'effects.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});await page.waitForFunction(()=>!window.mteEditor.busy);assert.deepEqual(await page.evaluate(()=>window.mteEditor.snapshot()),saved);
  await page.waitForTimeout(700);await page.reload();await page.waitForFunction(()=>window.mteEditor&&!window.mteEditor.busy&&window.mteAudio?.effects.size===1);assert.deepEqual(await page.evaluate(()=>window.mteEditor.snapshot()),saved);
  await page.getByRole('button',{name:'Studio',exact:true}).click();await page.getByRole('button',{name:'Duplicate',exact:true}).click();await page.waitForFunction(()=>!window.mteEditor.busy&&window.mteStudio.groups.length===2);assert.equal(await page.evaluate(()=>window.mteAudio.effects.size),2);
  await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(time=>[...window.mteAudio.effects].every(element=>element.currentTime>time+.05),saved.audio.effectTracks[0].time);
  await page.getByRole('button',{name:'Pause',exact:true}).click();const group=await page.evaluate(()=>window.mteEditor.selected().id);await page.locator('#layers .layer').filter({has:page.locator('[aria-pressed="true"]')}).getByRole('button',{name:'Remove',exact:true}).click();assert.equal(await page.evaluate(id=>[...window.mteAudio.effects].some(element=>element.effectGroup===id),group),false);assert.deepEqual(errors,[]);
  console.log('Effect state checks passed: real audio position, JSON import, reload, duplication, resume and object cleanup');
}finally{await browser.close();}
