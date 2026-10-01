import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length>0);
  await page.locator('[data-appearance="3013001"]').click();
  await page.waitForFunction(()=>window.mteStudio.groups.length===1&&window.mteStudio.groups[0].appearanceId==='3013001');
  const details=await page.locator('#details').textContent();assert.match(details,/Static portrait/);assert.match(details,/Spine bundle absent/);
  const portrait=await page.evaluate(()=>{const group=window.mteStudio.groups[0];return {asset:group.asset,width:group.width,height:group.height};});
  assert.match(portrait.asset,/^portraits\/3013001_lihui\//);assert.equal(portrait.width,19.62);assert.equal(portrait.height,24.52);
  const voice=await page.evaluate(async()=>{const library=await fetch('/assets/library.json').then(r=>r.json());return library.voices.find(row=>row.targetId==='3013001'&&row.resourceName.includes('Login')&&window.mteAudio.resolve(row.resourceName,'a_sound_voiceeff'))?.id;});
  assert.ok(voice);await page.getByLabel('Voice',{exact:true}).selectOption(voice);await page.getByRole('button',{name:'Play voice',exact:true}).click();await page.waitForFunction(()=>window.mteAudio.element.currentTime>.05);await page.getByRole('button',{name:'Stop voice',exact:true}).click();
  await page.screenshot({path:'private/browser-portrait.png'});
  await page.getByRole('button',{name:'Studio',exact:true}).click();
  await page.locator('[data-asset="Spines/painting/3014027_spine"]').click();await page.waitForFunction(()=>window.mteStudio.groups.length===2);
  await page.locator('#layers').getByRole('button',{name:'格蕾 · 原皮',exact:true}).click();
  await page.getByRole('button',{name:'Duplicate',exact:true}).click();await page.waitForFunction(()=>window.mteStudio.groups.length===3&&!window.mteEditor.busy);
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  const scene=await page.evaluate(()=>window.mteEditor.snapshot());assert.equal(scene.objects.filter(row=>row.asset).length,2);assert.ok(scene.objects.filter(row=>row.asset).every(row=>row.src===undefined));assert.equal(JSON.stringify(scene).includes('data:image/'),false);
  const broken=structuredClone(scene);broken.objects[0].x=999;broken.objects[2].asset='portraits/missing/1.png';
  await page.locator('#scene-file').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(broken))});await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Import failed'));
  assert.deepEqual(await page.evaluate(()=>window.mteEditor.snapshot()),scene);
  await page.waitForTimeout(700);await page.reload();await page.waitForFunction(()=>window.mteStudio?.groups.length===3&&!window.mteEditor.busy);
  assert.deepEqual(await page.evaluate(()=>window.mteEditor.snapshot()),scene);
  await page.locator('#category').selectOption('portrait');assert.ok(await page.locator('#assets img').count()>=169);
  assert.deepEqual(errors,[]);console.log('Portrait browser checks passed: native size, missing-Spine label, voice, mixed scene, duplication, import failure and reload');
}finally{await browser.close();}
