import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {launchTestBrowser} from './test_browser.mjs';

const root=resolve(process.argv[2]||'private/original-clarissa-shaders-20261007');
const catalog=JSON.parse(await readFile(root+'/presentations.json','utf8')).presentations;
const entries=JSON.parse(await readFile(root+'/runtime-index.json','utf8')).entries;
for(const engine of process.argv.slice(3).length?process.argv.slice(3):['chromium','firefox','webkit']){
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
    const results=await page.evaluate(async({catalog,entries})=>{
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
          results.push({bundle:presentation.id,layers:group.layers.length,animations:names.length,poses,colored,materialErrors:group.layers.flatMap(layer=>layer.entry.materialBindings?.errors||[]),limitations:group.layers.flatMap(layer=>layer.materialLimitations||[]),origin:presentation.origin});
        }finally{stage.dispose();stage.gl.getExtension('WEBGL_lose_context')?.loseContext();}
      }
      return {silent:window.__mteSilentTest,results};
    },{catalog,entries}).catch(error=>{console.error(engine,'Pending source requests',[...pending.values()]);throw error;});
    assert.deepEqual(errors,[]);assert.equal(results.silent,true);
    for(const row of results.results){assert.equal(row.origin,'original-archive');assert.deepEqual(row.materialErrors,[]);assert.ok(row.colored>100);assert.ok(row.poses>=row.animations);}
    console.log(engine,JSON.stringify(results.results));
  }finally{await close();}
}
