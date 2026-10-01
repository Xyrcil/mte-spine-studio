import {selectAsset} from './select_asset.mjs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length>0);
  await page.locator('#category').selectOption('story');assert.equal(await page.locator('#library-count').textContent(),'244 artwork entries');assert.equal(await page.locator('#assets [data-asset]').count(),24);
  await selectAsset(page,'Spines/story/gelei');await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/story/gelei');
  assert.equal(await page.locator('#animation-preview').inputValue(),'stand');
  await page.locator('#animation-preview').selectOption('weixiao');assert.equal(await page.evaluate(()=>window.mteStudio.groups[0].layers[0].state.getCurrent(0).animation.name),'weixiao');
  await page.waitForTimeout(400);await page.screenshot({path:'private/browser-story.png'});
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  const result=await page.evaluate(async()=>{
    const stage=window.mteStudio,presentations=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries;
    const standalone=presentations.filter(p=>p.standalone),failures=[];let loaded=0;
    for(const presentation of standalone){
      for(const group of [...stage.groups])stage.remove(group.id);
      try{await stage.add(presentation,entries.filter(entry=>entry.bundle===presentation.id));stage.evaluate(1/30);stage.draw();const error=stage.gl.getError();if(error!==stage.gl.NO_ERROR)throw new Error(`WebGL error ${error}`);loaded++;}
      catch(error){failures.push({id:presentation.id,error:error.message});}
    }
    return {expected:standalone.length,loaded,failures};
  });console.log(result);assert.deepEqual(result.failures,[]);assert.equal(result.loaded,275);assert.deepEqual(errors,[]);
}finally{await browser.close();}
