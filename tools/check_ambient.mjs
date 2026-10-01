import {selectAsset} from './select_asset.mjs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length>0);
  await selectAsset(page,'Spines/painting/301600901_spine');await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/painting/301600901_spine');
  await page.locator('#ambient-enabled').check();await page.waitForFunction(()=>[...window.mteAudio.ambients.values()].some(channel=>channel.element.currentTime>.1));
  assert.equal(await page.evaluate(()=>[...window.mteAudio.ambients.values()][0].element.loop),false);
  await page.getByRole('button',{name:'Pause',exact:true}).click();const paused=await page.evaluate(()=>[...window.mteAudio.ambients.values()][0].element.currentTime);await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>[...window.mteAudio.ambients.values()][0].element.currentTime),paused);
  await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(time=>[...window.mteAudio.ambients.values()][0].element.currentTime>time+.1,paused);
  await page.getByRole('button',{name:'Studio',exact:true}).click();await selectAsset(page,'Spines/painting/3014027_spine');await page.waitForFunction(()=>window.mteStudio.groups.length===2);
  const selects=page.locator('#ambient-tracks select');await selects.nth(1).selectOption('a_sound_bgm/bgm_BianNianShi_01_star_ocean_past');await page.waitForFunction(()=>window.mteAudio.ambients.size===2&&[...window.mteAudio.ambients.values()].every(channel=>channel.element.currentTime>.05));
  await page.locator('#sound-muted').check();assert.equal(await page.evaluate(()=>[...window.mteAudio.ambients.values()].every(channel=>channel.element.muted)),true);
  await page.getByRole('button',{name:'Pause',exact:true}).click();const saved=await page.evaluate(()=>window.mteEditor.snapshot());assert.equal(saved.audio.ambientTracks.length,2);assert.equal(saved.audio.ambientTracks.find(track=>track.category==='a_sound_bgm').loop,true);
  await page.getByRole('button',{name:'Duplicate',exact:true}).click();await page.waitForFunction(()=>!window.mteEditor.busy&&window.mteStudio.groups.length===3);assert.equal(await page.evaluate(()=>window.mteAudio.ambients.size),3);
  await page.locator('#scene-file').setInputFiles({name:'ambient.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});await page.waitForFunction(()=>!window.mteEditor.busy&&window.mteStudio.groups.length===2);assert.deepEqual(await page.evaluate(()=>window.mteEditor.snapshot()),saved);
  await page.waitForTimeout(700);await page.reload();await page.waitForFunction(()=>window.mteStudio?.groups.length===2&&!window.mteEditor.busy);assert.deepEqual(await page.evaluate(()=>window.mteEditor.snapshot()),saved);
  await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>[...window.mteAudio.ambients.values()].every(channel=>!channel.element.paused));
  await page.getByRole('button',{name:'Gallery',exact:true}).click();await selectAsset(page,'Spines/painting/3014027_spine');await page.waitForFunction(()=>window.mteStudio.groups.length===1&&window.mteAudio.ambients.size===0);
  assert.deepEqual(errors,[]);console.log('Ambient checks passed: real skin sound, independent music, pause/resume, duplication, save/import/reload, mute and cleanup');
}finally{await browser.close();}
