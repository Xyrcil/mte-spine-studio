import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {selectAsset} from './select_asset.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteLibrary&&window.mteStudio?.groups.length);
  const total=await page.evaluate(()=>window.mteLibrary.rows.length);assert.equal(await page.locator('#library-count').textContent(),`${total} artwork entries`);assert.equal(await page.locator('.asset').count(),24);
  const seen=new Set();while(true){for(const key of await page.locator('.asset').evaluateAll(nodes=>nodes.map(n=>n.dataset.libraryKey)))seen.add(key);if(await page.getByRole('button',{name:'Next',exact:true}).isDisabled())break;await page.getByRole('button',{name:'Next',exact:true}).click();}assert.equal(seen.size,total);
  await page.locator('#library-character').selectOption('3014025');assert.equal(await page.locator('#assets h3').first().textContent(),'安普莎');assert.equal(await page.locator('#library-count').textContent(),'7 artwork entries');
  await page.locator('#category').selectOption('skin');assert.equal(await page.locator('.asset').count(),2);
  await page.locator('.asset-favorite').first().click();const favorite=await page.locator('.asset-favorite[aria-pressed=true]').locator('..').locator('.asset').getAttribute('data-library-key');
  await page.locator('#library-collection').selectOption('favorites');assert.equal(await page.locator('.asset').count(),1);
  await page.locator('#search').fill('no-such-character');assert.equal(await page.locator('.asset').count(),0);assert.match(await page.locator('.library-empty').textContent(),/No artwork/);
  await selectAsset(page,'Spines/painting/3014027_spine');await page.waitForFunction(()=>!window.mteEditor.busy&&window.mteStudio.groups[0]?.presentation.id==='Spines/painting/3014027_spine');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('mte-library-recent')||'[]').length===1);
  await page.locator('#search').fill('');await page.locator('#library-collection').selectOption('recent');assert.equal(await page.locator('.asset').count(),1);assert.equal(await page.locator('.asset').getAttribute('aria-pressed'),'true');
  await page.reload();await page.waitForFunction(()=>window.mteLibrary&&window.mteStudio?.groups.length&&!window.mteEditor.busy);await page.locator('#library-collection').selectOption('favorites');assert.equal(await page.locator('.asset').getAttribute('data-library-key'),favorite);
  await page.locator('.asset-favorite').click();assert.equal(await page.locator('.asset').count(),0);assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('mte-library-favorites'))),[]);
  await selectAsset(page,'Spines/painting/3014027_spine');await page.waitForFunction(()=>!window.mteEditor.busy);await page.locator('#category').selectOption('portrait');assert.match(await page.locator('.asset').first().textContent(),/Static portrait.*Animated version/);await page.locator('.asset').first().click();await page.waitForFunction(()=>window.mteStudio.groups[0]?.kind==='image');
  await selectAsset(page,'appearance:3013010');assert.match(await page.locator('#status').textContent(),/Display unavailable/);assert.match(await page.locator('[data-library-key="appearance:3013010"]').textContent(),/Display missing/);
  await page.locator('#search').fill('');await page.locator('#library-character').selectOption('unassigned');assert.ok(await page.locator('.asset').count()>0);
  await page.screenshot({path:'private/browser-library.png'});
  await page.setViewportSize({width:390,height:844});assert.ok((await page.locator('.workspace').boundingBox()).width>=390);assert.equal(await page.locator('.library').isVisible(),false);
  await page.getByRole('button',{name:'Library',exact:true}).click();assert.equal(await page.locator('.library').isVisible(),true);assert.equal(await page.locator('#search').evaluate(node=>node===document.activeElement),true);await page.screenshot({path:'private/browser-library-mobile.png'});
  await page.keyboard.press('Escape');assert.equal(await page.locator('.library').isVisible(),false);await selectAsset(page,'Spines/painting/3014027_spine');await page.waitForFunction(()=>!document.body.classList.contains('library-open')&&window.mteStudio.groups[0]?.presentation.id==='Spines/painting/3014027_spine');assert.equal(await page.locator('#library-toggle').getAttribute('aria-expanded'),'false');
  assert.deepEqual(errors,[]);console.log(`Library browser checks passed: all ${total} entries reachable, canonical character grouping, skins, favorites, recent, reload, static alternative, missing source and narrow layout`);
}finally{await browser.close();}
