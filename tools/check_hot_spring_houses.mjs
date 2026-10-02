import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {selectAsset} from './select_asset.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
  const houses=await page.evaluate(async()=>{const library=await fetch('/assets/library.json').then(r=>r.json());return library.hotSpringHouses;});assert.equal(houses.length,3);
  for(const house of houses){
    const id=`${house.bundle}/${house.id}`;await selectAsset(page,id);await page.waitForFunction(id=>window.mteStudio.groups[0]?.presentation.id===id,id);
    const result=await page.evaluate(async()=>{
      const stage=window.mteStudio,group=stage.groups[0];stage.paused=true;
      const library=await fetch('/assets/library.json').then(r=>r.json()),catalog=await fetch('/assets/presentations.json').then(r=>r.json()),entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries,{expandHotSpringPresentations}=await import('/src/engine/hot-spring.js'),presentations=expandHotSpringPresentations(catalog.presentations,library.hotSpringHouses);
      const snapshot=stage.snapshot();await stage.restore(snapshot,presentations,entries);const restored=stage.snapshot();
      const {RenderSession}=await import('/src/engine/export.js'),{exportPlan}=await import('/src/engine/export-plan.js'),plan=exportPlan({format:'png',width:160,height:120,fps:10,start:0,end:1,speed:1,loops:1,loopMode:'repeat',background:'#191b20',fit:'contain',crop:{x:0,y:0,width:1,height:1}}),session=new RenderSession(snapshot,presentations,entries,stage.imageAssets,stage.canvas.width/stage.canvas.height,plan);
      let exported;try{await session.initialize();await session.seek(.25);exported=session.stage.groups[0].presentation.id;if(session.stage.gl.getError()!==session.stage.gl.NO_ERROR)throw new Error('Export graphics error');}finally{session.dispose();}
      return {id:group.presentation.id,layers:group.layers.filter(layer=>layer.active).length,roles:group.presentation.hotSpringHouse.roleIds,activeRoles:group.presentation.hotSpringHouse.roleIds.filter(id=>[...group.nodes.values()].some(node=>node.type==='GameObject'&&node.data.m_Name===id&&node.data.m_IsActive)),same:JSON.stringify(snapshot)===JSON.stringify(restored),exported,voices:document.querySelector('#voice-list').options.length};
    });assert.ok(result.layers>0);assert.deepEqual(result.activeRoles,house.roleIds);assert.equal(result.same,true);assert.equal(result.exported,id);assert.ok(result.voices>0);console.log(result);
  }
  assert.deepEqual(errors,[]);console.log('Three real hot spring houses loaded, restored and rendered independently');
}finally{await browser.close();}
