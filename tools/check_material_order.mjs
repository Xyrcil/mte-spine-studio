import {selectAsset} from './select_asset.mjs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],results=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);await page.locator('#pause').click();
  for(const id of ['3013015','3014009','301601602']){
    const bundle=`Spines/painting/${id}_spine`;await selectAsset(page,bundle);await page.waitForFunction(bundle=>window.mteStudio.groups[0]?.presentation.id===bundle,bundle);
    assert.doesNotMatch(await page.locator('#details').textContent(),/Material ordering unavailable:/);assert.match(await page.locator('#details').textContent(),/Material segment visual verification pending/);
    const result=await page.evaluate(async()=>{
      const stage=window.mteStudio,group=stage.groups[0],layer=group.layers.find(layer=>layer.instance.renderOrderStatus==='mixed-queues'),{skeletonDrawSegments}=await import('/src/engine/material-order.js'),catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries;
      const pixels=()=>{stage.draw();const data=new Uint8Array(stage.canvas.width*stage.canvas.height*4);stage.gl.readPixels(0,0,stage.canvas.width,stage.canvas.height,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,data);return data;};
      const initial=skeletonDrawSegments(layer),expected=layer.instance.renderMaterials.map(material=>material.id),sourceMatches=JSON.stringify(initial.map(segment=>segment.material))===JSON.stringify(expected);
      for(const delta of [.137,.731,2.04]){stage.evaluate(delta);const segments=skeletonDrawSegments(layer);if(segments.some(segment=>!Number.isInteger(segment.queue)||!segment.slots.length))throw new Error('Invalid animated material segment');}
      const saved=stage.snapshot(),original=pixels();for(let i=0;i<20;i++){stage.evaluate(0);stage.draw();}const frozen=JSON.stringify(stage.snapshot())===JSON.stringify(saved);
      stage.evaluate(.321);await stage.restore(saved,catalog,entries);const restored=pixels(),restoreEqual=restored.every((value,index)=>value===original[index]);
      const {exportMedia}=await import('/src/engine/export.js'),output=await exportMedia({scene:saved,catalog,entries,imageAssets:stage.imageAssets,sourceAspect:stage.canvas.width/stage.canvas.height,settings:{format:'png',width:stage.canvas.width,height:stage.canvas.height,scale:1,fps:30,speed:1,start:0,end:1,loops:1,loopMode:'repeat',fade:.2,background:stage.background,transparent:false,fit:'contain',crop:{x:0,y:0,width:1,height:1}}});
      const bitmap=await createImageBitmap(output.blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let exportError=0;
      for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)for(let c=0;c<4;c++)exportError=Math.max(exportError,Math.abs(data[(y*canvas.width+x)*4+c]-original[((canvas.height-y-1)*canvas.width+x)*4+c]));
      window.materialRecovery={saved,pixels:original};return {bundle:group.presentation.id,sourceMatches,segments:initial.length,queues:[...new Set(initial.map(segment=>segment.queue))],frozen,restoreEqual,exportError,warning:output.warnings.some(warning=>warning.includes('original-client visual verification')),glError:stage.gl.getError()};
    });
    for(const key of ['sourceMatches','frozen','restoreEqual','warning'])assert.equal(result[key],true,JSON.stringify(result));assert.equal(result.queues.length,2);assert.ok(result.exportError<=1,JSON.stringify(result));assert.equal(result.glError,0);results.push(result);
  }
  await page.evaluate(()=>{window.materialRecovery.extension=window.mteStudio.gl.getExtension('WEBGL_lose_context');window.materialRecovery.extension.loseContext();});await page.waitForFunction(()=>window.mteStudio.contextLost&&window.mteStudio.recoveryPending);await page.evaluate(()=>window.materialRecovery.extension.restoreContext());await page.waitForFunction(()=>!window.mteStudio.recoveryPending,null,{timeout:30000});
  const recovered=await page.evaluate(()=>{const stage=window.mteStudio;stage.draw();const pixels=new Uint8Array(window.materialRecovery.pixels.length);stage.gl.readPixels(0,0,stage.canvas.width,stage.canvas.height,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,pixels);const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;return {state:JSON.stringify(canonical(stage.snapshot()))===JSON.stringify(canonical(window.materialRecovery.saved)),pixels:pixels.every((value,index)=>value===window.materialRecovery.pixels[index])};});assert.deepEqual(recovered,{state:true,pixels:true});
  assert.deepEqual(results.map(result=>result.segments),[5,10,3]);assert.deepEqual(errors,[]);console.log('Mixed material checks passed: original segment references, live animations, pause, scene restore, PNG parity, context recovery and explicit verification notice',results);
}finally{await browser.close();}
