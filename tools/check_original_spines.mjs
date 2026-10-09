import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {launchTestBrowser} from './test_browser.mjs';
import {materialPremultipliedAlpha} from '../src/engine/material-order.js';

const root=resolve(process.argv[2]||'private/original-clarissa-shaders-20261007');
const entries=JSON.parse(await readFile(root+'/runtime-index.json','utf8')).entries;
const alphaOnly=process.argv.includes('--premultiplied'),alphaBundles=new Set(entries.filter(entry=>entry.materialBindings?.pages.some(page=>Object.values(page.materials).some(materialPremultipliedAlpha))).map(entry=>entry.bundle));
const catalog=JSON.parse(await readFile(root+'/presentations.json','utf8')).presentations.filter(row=>!alphaOnly||alphaBundles.has(row.id));
assert.ok(catalog.length,'No matching presentations');
const engines=process.argv.slice(3).filter(value=>value!=='--premultiplied');
for(const engine of engines.length?engines:['chromium','firefox','webkit']){
  const {browser,close}=await launchTestBrowser(engine);
  try{
    const page=await browser.newPage(),errors=[],pending=new Map();page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>pending.set(request,new URL(request.url()).pathname));
    page.on('requestfinished',request=>pending.delete(request));
    page.on('requestfailed',request=>{pending.delete(request);console.error(engine,'Source request failed',new URL(request.url()).pathname,request.failure()?.errorText);});
    page.on('console',message=>{if(message.text().startsWith('[source-check]'))console.log(engine,message.text());});
    await page.route('**/assets/**',async route=>{
      const relative=decodeURIComponent(new URL(route.request().url()).pathname.split('/assets/')[1]||'');
      if(!catalog.some(row=>relative.startsWith(row.path+'/')))return route.continue();
      const path=resolve(root,relative);assert.ok(path.startsWith(root+sep));await route.fulfill({path});
    });
    await page.goto(process.env.MTE_TEST_URL||'http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
    const results=await page.evaluate(async({catalog,entries,alphaOnly})=>{
      const {Stage}=await import('/src/engine/stage.js');const results=[];
      for(const presentation of catalog){
        if(!presentation.instances.length){
          if(!presentation.unassignedInstances?.length&&entries.some(entry=>entry.bundle===presentation.id))throw new Error('Source skeleton was omitted from its presentation');
          console.log('[source-check] '+(presentation.unassignedInstances?.length?'Unassigned template: ':'No source skeleton: ')+presentation.id);continue;
        }
        console.log('[source-check] '+presentation.id);
        const canvas=document.createElement('canvas');canvas.width=160;canvas.height=160;const stage=new Stage(canvas,{manual:true});
        try{
          const group=await stage.add(presentation,entries.filter(row=>row.bundle===presentation.id));
          const names=[...new Set(group.layers.flatMap(layer=>layer.skeleton.data.animations.map(animation=>animation.name)))];let poses=0,colored=0;
          for(const name of names){
            for(const layer of group.layers){layer.state.clearTracks();layer.skeleton.setToSetupPose();if(layer.skeleton.data.findAnimation(name))layer.state.setAnimation(0,name,true);}
            stage.evaluate(.5);stage.fit();stage.draw();
            for(const layer of group.layers){if(!layer.skeleton.bones.every(bone=>['a','b','c','d','worldX','worldY'].every(key=>Number.isFinite(bone[key]))))throw new Error('Non-finite original animation pose');poses++;}
            const pixels=new Uint8Array(160*160*4);stage.gl.readPixels(0,0,160,160,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,pixels);
            for(let i=0;i<pixels.length;i+=4)if(pixels[i]!==25||pixels[i+1]!==27||pixels[i+2]!==32)colored++;
          }
          let alphaVerification;
          if(alphaOnly){
            stage.draw();const original=new Uint8Array(160*160*4);stage.gl.readPixels(0,0,160,160,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,original);
            const saved=stage.snapshot();await stage.restore(saved,catalog,entries);stage.draw();const restored=new Uint8Array(original.length);stage.gl.readPixels(0,0,160,160,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,restored);if(!original.every((value,index)=>value===restored[index]))throw new Error('Premultiplied source pixels changed on restore');
            const {exportMedia,RenderSession}=await import('/src/engine/export.js'),output=await exportMedia({scene:saved,catalog,entries,imageAssets:stage.imageAssets,sourceAspect:1,settings:{format:'png',width:160,height:160,fps:30,start:0,end:1,speed:1,loops:1,loopMode:'repeat',background:stage.background,fit:'contain',crop:{x:0,y:0,width:1,height:1}}}),reference=new RenderSession(saved,catalog,entries,stage.imageAssets,1,{...output.plan,supersampling:true});
            try{await reference.initialize();await reference.seek(0);const image=document.createElement('canvas');image.width=image.height=160;const ctx=image.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(reference.canvas,0,0,160,160);const expected=ctx.getImageData(0,0,160,160).data;ctx.clearRect(0,0,160,160);const bitmap=await createImageBitmap(output.blob);ctx.drawImage(bitmap,0,0);bitmap.close();const actual=ctx.getImageData(0,0,160,160).data;let error=0;for(let index=0;index<actual.length;index++)error=Math.max(error,Math.abs(actual[index]-expected[index]));if(error>1)throw new Error('Premultiplied source PNG differs from supersampled reference: '+error);alphaVerification={restored:true,exportError:error,mappedLayers:stage.groups[0].layers.filter(layer=>layer.materialMapping?.alphaMapped).length};}finally{reference.dispose();}
          }
          results.push({bundle:presentation.id,layers:group.layers.length,animations:names.length,poses,colored,materialErrors:group.layers.flatMap(layer=>layer.entry.materialBindings?.errors||[]),limitations:group.layers.flatMap(layer=>layer.materialLimitations||[]),origin:presentation.origin,...(alphaVerification?{alphaVerification}: {})});
        }finally{stage.dispose();stage.gl.getExtension('WEBGL_lose_context')?.loseContext();}
      }
      return {silent:window.__mteSilentTest,results};
    },{catalog,entries,alphaOnly}).catch(error=>{console.error(engine,'Pending source requests',[...pending.values()]);throw error;});
    assert.deepEqual(errors,[]);assert.equal(results.silent,true);
    for(const row of results.results){if(!alphaOnly)assert.equal(row.origin,'original-archive');else assert.ok(row.alphaVerification.mappedLayers>0,JSON.stringify(row));assert.deepEqual(row.materialErrors,[]);assert.ok(row.colored>100);assert.ok(row.poses>=row.animations);}
    console.log(engine,JSON.stringify(results.results));
  }finally{await close();}
}
