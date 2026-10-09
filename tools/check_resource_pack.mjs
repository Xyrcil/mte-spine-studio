import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat,mkdtemp,rm} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium,webkit} from '@playwright/test';
import {launchTestBrowser,silentMedia} from './test_browser.mjs';
import {expectedPackPaths,PACK_CATALOGS,resourceType} from '../src/engine/resource-pack.js';
import {selectAsset} from './select_asset.mjs';
import {buildAssetLibrary} from '../src/asset-library.js';
import {expandHotSpringPresentations} from '../src/engine/hot-spring.js';
import {expandStationDrawings} from '../src/engine/station-drawing.js';
import {skillDisplayOptions} from '../src/engine/skill-display.js';
const engineOption=process.argv.indexOf('--engine'),engine=engineOption>=0?process.argv[engineOption+1]:'chromium';
assert.ok(['chromium','firefox','webkit'].includes(engine),'Choose --engine chromium, firefox or webkit');
const root=resolve('dist'),assets=resolve('public/assets'),catalogues=Object.fromEntries(await Promise.all(PACK_CATALOGS.map(async name=>[name,JSON.parse(await readFile(resolve(assets,name),'utf8'))])));
const bundle='Spines/painting/3014027_spine',appearance=catalogues['library.json'].appearances.find(row=>row.bundle===bundle),voice=catalogues['library.json'].voices.find(row=>row.targetId===appearance.characterId&&row.resourceName.includes('Login'));
const skillRole=catalogues['library.json'].skillDisplay.roles.find(row=>row.id==='3000001'),skillIds=new Set(skillRole.skillIds),skillResource=skillRole.emblemResource,skillAppearance=catalogues['library.json'].appearances.find(row=>row.portraitResource===`UI/Image/lihui/${skillRole.id}_lihui`),skillPortrait=skillAppearance?.portrait;
assert.ok(skillPortrait,'Original skill portrait is unavailable');
const visualBundles=[bundle,'Spines/ui/Onsen','Spines/painting/301500101_spine','UI/Prefab/Onsen','Spines/ui/fight','Spines/painting/3014021_spine','Spines/painting/3014009_spine','Spines/painting/3016188_spine'];
const fixture={
  'presentations.json':{schema:1,presentations:catalogues['presentations.json'].presentations.filter(row=>visualBundles.includes(row.id))},
  'runtime-index.json':{schema:1,entries:catalogues['runtime-index.json'].entries.filter(row=>visualBundles.includes(row.bundle))},
  'library.json':{schema:1,characters:catalogues['library.json'].characters,appearances:catalogues['library.json'].appearances.filter(row=>visualBundles.includes(row.bundle)||row.id===skillAppearance.id),voices:[voice],storyVoices:[],soundResources:catalogues['library.json'].soundResources.filter(row=>row.resource.split('/').at(-1)===voice.resourceName),skillDisplay:{...catalogues['library.json'].skillDisplay,roles:[skillRole],skills:catalogues['library.json'].skillDisplay.skills.filter(row=>skillIds.has(row.id)),stands:catalogues['library.json'].skillDisplay.stands.filter(row=>row.id===skillRole.id),emblems:catalogues['library.json'].skillDisplay.emblems.filter(row=>row.resource===skillResource)}},
  'audio-index.json':{schema:1,entries:catalogues['audio-index.json'].entries.filter(row=>row.name===voice.resourceName)},
  'portrait-index.json':{schema:1,entries:catalogues['portrait-index.json'].entries.filter(row=>row.sprites.some(sprite=>sprite.path===appearance.portrait.path||sprite.path===skillPortrait.path||sprite.name===skillResource.split('/').at(-1)))}
};
fixture['library.json'].artworkViews=catalogues['library.json'].artworkViews;
const paths=[...PACK_CATALOGS,...expectedPackPaths(fixture)],allowed=new Set(paths);let mediaNetworkRequests=0;
const server=createServer(async(request,response)=>{
  try{
    const path=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(path==='/uncached-network-probe'){response.setHeader('cache-control','no-store');response.end('Network reachable');return;}
    if(path==='/fixtures/files.json'){response.setHeader('content-type','application/json');response.end(JSON.stringify(paths));return;}
    if(path.startsWith('/fixtures/')){const name=path.slice(10);if(!allowed.has(name)){response.writeHead(404).end();return;}response.setHeader('content-type',resourceType(name));response.end(fixture[name]?JSON.stringify(fixture[name]):await readFile(resolve(assets,name)));return;}
    if(!path.startsWith('/pack-check/')){response.writeHead(404).end();return;}
    const local=path.slice(12)||'index.html';if(local.startsWith('assets/')&&!/^assets\/[^/]+\.(js|css)$/.test(local)){mediaNetworkRequests++;response.writeHead(404,{'content-type':'text/plain'}).end('No game assets are hosted');return;}
    const target=resolve(root,local);if(!target.startsWith(root+'/')||!(await stat(target)).isFile()){response.writeHead(404).end();return;}response.setHeader('content-type',extname(target)==='.js'?'text/javascript':extname(target)==='.css'?'text/css':extname(target)==='.html'?'text/html':extname(target)==='.json'?'application/json':'text/plain');response.end(await readFile(target));
  }catch{response.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,url=origin+'/pack-check/';
const full=process.argv.includes('--full'),profile=full&&engine!=='firefox'?await mkdtemp(resolve('private/pack-check-profile-')):null;
const archiveOption=process.argv.indexOf('--archive');if(archiveOption>=0&&!process.argv[archiveOption+1])throw new Error('Archive path is required');
const fullArchive=resolve(archiveOption>=0?process.argv[archiveOption+1]:'private/mte-resources.zip');
const launched=profile?null:await launchTestBrowser(engine);
const context=profile?await ({chromium,webkit}[engine]).launchPersistentContext(profile,{...(engine==='chromium'?{channel:'chrome',args:['--mute-audio']}:{}),headless:true,viewport:{width:1440,height:1000}}):await launched.browser.newContext({viewport:{width:1440,height:1000}});
await context.addInitScript(silentMedia);
async function setOffline(value){
  if(engine!=='webkit'){await context.setOffline(value);return;}
  // WebKit offline emulation blocks even service-worker responses (Playwright #42775).
  if(value){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await assert.rejects(fetch(origin+'/uncached-network-probe'));}
  else if(!server.listening)await new Promise(resolve=>server.listen(Number(new URL(origin).port),'127.0.0.1',resolve));
}
try{
  const page=await context.newPage(),other=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  for(const tab of [page,other]){await tab.goto(url);await tab.waitForFunction(()=>window.mtePack&&navigator.serviceWorker.controller);assert.equal(await tab.evaluate(()=>window.mteCache.ready),true);}
  const importFixture=(mode='valid')=>page.evaluate(async mode=>{
    const paths=await fetch('/fixtures/files.json').then(response=>response.json()),files=[];
    for(const path of paths){if(mode==='missing'&&path.endsWith('.skel'))continue;const blob=await (await fetch('/fixtures/'+path)).blob(),file=new File([blob],path.split('/').at(-1));Object.defineProperty(file,'webkitRelativePath',{value:'converted/'+path});files.push(file);}
    if(mode==='cancel')for(let i=0;i<300;i++){const file=new File(['{}'],`extra-${i}.json`);Object.defineProperty(file,'webkitRelativePath',{value:`converted/extra-${i}.json`});files.push(file);}
    try{return {result:await window.mtePack.importFiles(files)};}catch(error){return {error:error.message,name:error.name};}
  },mode);
  const first=await importFixture();assert.ok(first.result,JSON.stringify(first));await other.waitForFunction(()=>window.mteStudio.packReloadRequired);assert.equal(await page.evaluate(()=>window.mteEditor.busy),true);await page.reload();await page.waitForFunction(()=>window.mteStudio?.groups.length&&!window.mteEditor.busy);
  assert.equal(await page.evaluate(()=>window.mteStudio.groups[0].presentation.id),bundle);const before=await page.evaluate(()=>window.mteCache.request('PACK_STATUS'));
  assert.match((await importFixture('missing')).error,/Indexed files missing/);assert.deepEqual(await page.evaluate(()=>window.mteCache.request('PACK_STATUS')),before);
  const cancelled=importFixture('cancel');await page.waitForFunction(()=>window.mtePack.busy&&document.querySelector('#pack-progress').value>0);await page.locator('#pack-cancel').click();assert.equal((await cancelled).name,'AbortError');assert.deepEqual(await page.evaluate(()=>window.mteCache.request('PACK_STATUS')),before);assert.equal(await page.evaluate(()=>window.mteEditor.busy),false);
  const next=await importFixture();assert.ok(next.result);assert.notEqual((await page.evaluate(()=>window.mteCache.request('PACK_STATUS'))).name,before.name);assert.equal(await page.evaluate(name=>caches.has(name),before.name),false);
  await page.reload();await page.waitForFunction(()=>window.mteStudio?.groups.length&&!window.mteEditor.busy);await page.locator('#pause').click();await page.getByRole('button',{name:'Play voice',exact:true}).click();await page.waitForFunction(()=>window.mteAudio.element.currentTime>.05);await page.getByRole('button',{name:'Stop voice',exact:true}).click();
  const audioUrl=await page.evaluate(()=>window.mteAudio.base+window.mteAudio.resolve(window.mteAudio.voiceRows[0].resourceName).path);
  const range=await page.evaluate(async url=>{const full=await fetch(url).then(r=>r.arrayBuffer()),response=await fetch(url,{headers:{Range:'bytes=2-11'}});return {status:response.status,actual:[...new Uint8Array(await response.arrayBuffer())],expected:[...new Uint8Array(full).slice(2,12)]};},audioUrl);assert.equal(range.status,206);assert.deepEqual(range.actual,range.expected);
  assert.equal(await page.evaluate(async()=>{const response=await fetch(new URL('../uncached-network-probe',location.href),{cache:'no-store'});return response.status;}),200,'Network control must succeed before disconnecting');
  await page.evaluate(()=>window.mteCache.request('CLEAR'));assert.ok(await page.evaluate(()=>window.mteCache.request('PACK_STATUS')));await setOffline(true);await page.reload();await page.waitForFunction(()=>window.mteStudio?.groups.length&&!window.mteEditor.busy);
  assert.equal(await page.evaluate(async()=>{try{const response=await fetch(new URL('../uncached-network-probe',location.href),{cache:'no-store'});return !response.ok;}catch{return true;}}),true,'Uncached requests must fail while disconnected');
  const networkBefore=mediaNetworkRequests;await page.getByRole('button',{name:'Export',exact:true}).click();await page.locator('#export-format').selectOption('png');for(const [key,value] of [['width','160'],['height','120'],['end','.2']])await page.locator(`#export-${key}`).fill(value);const output=await page.evaluate(async()=>{const result=await window.mteExporter.run();return {ok:Boolean(result),frames:result?.plan.frames,status:document.querySelector('#export-status').textContent};});assert.equal(output.ok,true,output.status);assert.equal(output.frames,1);assert.equal(mediaNetworkRequests,networkBefore);
  await page.getByRole('button',{name:'Gallery',exact:true}).click();
  const materials=[];
  for(const [id,field,expected,time] of [['3014021','vertexColorPower',2.5,7.6],['3014009','tint',4,2.9]]){
    const source=`Spines/painting/${id}_spine`;await selectAsset(page,source);await page.waitForFunction(source=>window.mteStudio.groups[0]?.presentation.id===source&&!window.mteEditor.busy,source);
    const importedMaterial=await page.evaluate(({field,time})=>{
      const stage=window.mteStudio,group=stage.groups[0];stage.evaluate(time);
      const profiles=group.layers.flatMap(layer=>[...(layer.materialMapping?.pages?.values()||[])].flatMap(page=>Object.values(page))).filter(material=>material[field]);
      const pixels=()=>{stage.draw();const values=new Uint8Array(stage.canvas.width*stage.canvas.height*4);stage.gl.readPixels(0,0,stage.canvas.width,stage.canvas.height,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,values);return values;},original=pixels(),saved=profiles.map(material=>({material,value:material[field]}));for(const row of saved)delete row.material[field];const plain=pixels();for(const row of saved)row.material[field]=row.value;stage.draw();
      const distortionProfiles=group.layers.flatMap(layer=>[...(layer.materialMapping?.pages?.values()||[])].flatMap(page=>Object.values(page))).filter(material=>material.distortion),materialTime=stage.materialTime;stage.materialTime=materialTime+.5;const advanced=pixels();stage.materialTime=materialTime;stage.draw();
      return {values:saved.map(row=>row.value),changed:plain.reduce((count,value,index)=>count+Number(value!==original[index]),0),distortionProfiles:distortionProfiles.length,distortionChanged:advanced.reduce((count,value,index)=>count+Number(value!==original[index]),0)};
    },{field,time});assert.ok(importedMaterial.values.some(value=>field==='tint'?value.r===expected&&value.g===expected&&value.b===expected&&value.a===1:value===expected));assert.ok(importedMaterial.changed>100,JSON.stringify(importedMaterial));materials.push({source,...importedMaterial});
    if(id==='3014009'){assert.match(await page.locator('#details').textContent(),/Material distortion filtering and color-space verification pending/);assert.ok(importedMaterial.distortionProfiles>0);assert.ok(importedMaterial.distortionChanged>100,JSON.stringify(importedMaterial));}
    await page.getByRole('button',{name:'Export',exact:true}).click();assert.ok(await page.evaluate(async()=>Boolean(await window.mteExporter.run())));await page.getByRole('button',{name:'Gallery',exact:true}).click();assert.equal(mediaNetworkRequests,networkBefore);
  }
  console.log(engine+': Imported source material tint and vertex-color power render and export offline',materials);
  const materialFiles=fixture['runtime-index.json'].entries.flatMap(entry=>(entry.materialBindings?.pages||[]).flatMap(page=>Object.values(page.materials).flatMap(material=>Object.values(material.textures||{}).filter(texture=>texture.path).map(texture=>({path:entry.path+'/'+texture.path,width:texture.width,height:texture.height})))));
  assert.ok(materialFiles.length>0);assert.ok(materialFiles.some(row=>row.path.endsWith('_FlowMap.png')));assert.ok(materialFiles.some(row=>row.path.endsWith('_NoiseTex.png')));assert.ok(materialFiles.some(row=>row.path.endsWith('_MaskTex.png')));
  const sourceTextures=await page.evaluate(async rows=>{const results=[];for(const row of rows){const response=await fetch('assets/'+row.path);if(!response.ok||response.headers.get('content-type')!=='image/png')throw new Error('Material texture is unavailable: '+row.path);const image=await createImageBitmap(await response.blob());results.push({path:row.path,valid:image.width===row.width&&image.height===row.height});image.close();}return results;},materialFiles);assert.ok(sourceTextures.every(row=>row.valid));assert.equal(mediaNetworkRequests,networkBefore);console.log(engine+': Source flow, noise and mask textures retain dimensions after import and disconnect',sourceTextures.length);
  await selectAsset(page,'Spines/ui/Onsen');await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/ui/Onsen');
  const native=await page.evaluate(()=>{const stage=window.mteStudio,group=stage.groups[0];stage.evaluate(1.25);const pixels=()=>{stage.draw();const data=new Uint8Array(stage.canvas.width*stage.canvas.height*4);stage.gl.readPixels(0,0,stage.canvas.width,stage.canvas.height,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,data);return data;},before=pixels(),images=group.nativeImages.filter(image=>image.used);for(const image of images)image.used=false;const after=pixels();for(const image of images)image.used=true;return {models:group.nativeAnimations.filter(row=>row.model).length,changed:before.reduce((n,v,i)=>n+Number(v!==after[i]),0)};});assert.equal(native.models,2);assert.ok(native.changed>100,JSON.stringify(native));
  const localMedia=paths.filter(path=>path.includes('/effects/'));assert.ok(localMedia.length>1);const media=await page.evaluate(async paths=>Promise.all(paths.map(async path=>({path,status:(await fetch('assets/'+path)).status}))),localMedia);assert.ok(media.every(row=>row.status===200),JSON.stringify(media));assert.equal(mediaNetworkRequests,networkBefore);
  const fontRows=fixture['presentations.json'].presentations.find(row=>row.id==='UI/Prefab/Onsen').fontAssets;assert.equal(fontRows.length,3);
  const fonts=await page.evaluate(async rows=>{const result=[];for(let i=0;i<rows.length;i++){const source=rows[i],response=await fetch('assets/'+source.path),data=await response.arrayBuffer();if(data.byteLength!==source.bytes)throw new Error('Imported font bytes are incomplete');const face=new FontFace('mte-imported-font-'+i,data);await face.load();result.push({name:source.name,status:face.status,type:response.headers.get('content-type'),expectedType:'font/'+source.format});}return result;},fontRows);assert.ok(fonts.every(row=>row.status==='loaded'&&row.type===row.expectedType),JSON.stringify(fonts));assert.equal(mediaNetworkRequests,networkBefore);
  await page.locator('#skill-role').selectOption(skillRole.id);await page.locator('#open-skill').click();await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.skillDisplay&&!document.querySelector('#open-skill').disabled);
  const skill=await page.evaluate(async()=>{
    const stage=window.mteStudio,group=stage.groups[0];stage.evaluate(.5);const scene=window.mteEditor.snapshot();
    return {bundle:group.presentation.id,appearanceId:scene.objects[0].appearanceId,fonts:group.presentation.nativeFontAssets.map(row=>row.path),cursor:group.nativeAnimations[0].model.events.cursor,rows:group.controllers.find(root=>root.source.id==='skill-words').rows.length};
  });assert.equal(skill.appearanceId,skillAppearance.id);assert.equal(skill.cursor,2);assert.equal(skill.rows,2);
  await page.getByRole('button',{name:'Export',exact:true}).click();await page.locator('#export-format').selectOption('png');const skillOutput=await page.evaluate(async()=>{const output=await window.mteExporter.run();return {ok:Boolean(output),status:document.querySelector('#export-status').textContent};});assert.ok(skillOutput.ok,skillOutput.status);assert.equal(mediaNetworkRequests,networkBefore);
  await page.getByRole('button',{name:'Gallery',exact:true}).click();
  if(full){
    console.log(engine+': Full pack storage estimate',await page.evaluate(()=>navigator.storage.estimate()));
    await setOffline(false);await page.locator('#pack-zip-file').setInputFiles(fullArchive);let previous=-1;
    for(let elapsed=0;elapsed<900;elapsed+=5){const progress=await page.evaluate(()=>({busy:window.mtePack.busy,done:document.querySelector('#pack-progress').value,total:document.querySelector('#pack-progress').max,status:document.querySelector('#pack-status').textContent,reload:window.mteStudio.packReloadRequired}));if(progress.done!==previous){console.log('Full pack progress',progress);previous=progress.done;}if(progress.reload)break;if(!progress.busy&&elapsed>0)throw new Error(progress.status);await page.waitForTimeout(5000);}
    assert.equal(await page.evaluate(()=>window.mteStudio.packReloadRequired),true);const imported=await page.evaluate(()=>window.mteCache.request('PACK_STATUS'));assert.ok(imported.bytes>3*1024**3);
    const fullPaths=[...PACK_CATALOGS,...expectedPackPaths(catalogues)];assert.equal(imported.files,fullPaths.length);
    const stored=await page.evaluate(async paths=>{const pack=await window.mteCache.request('PACK_STATUS'),cache=await caches.open(pack.name),missing=[];for(let start=0;start<paths.length;start+=64)await Promise.all(paths.slice(start,start+64).map(async path=>{const response=await cache.match(new URL('assets/'+path,location.href).href);if(!response)missing.push(path);await response?.body?.cancel();}));return {files:pack.files,missing};},fullPaths);assert.equal(stored.files,fullPaths.length);assert.deepEqual(stored.missing,[]);
    await setOffline(true);await page.reload();await page.waitForFunction(()=>window.mteStudio?.groups.length&&!window.mteEditor.busy);
    const library=structuredClone(catalogues['library.json']);
    let expanded=expandHotSpringPresentations(catalogues['presentations.json'].presentations,library.hotSpringHouses,library.hotSpringRoles,library.voices,library.characters);
    expanded.push(...skillDisplayOptions(expanded,library).flatMap(row=>row.presentation?[row.presentation]:[]));
    expanded=expandStationDrawings(expanded,library,catalogues['runtime-index.json'].entries);
    assert.equal(await page.evaluate(()=>window.mteLibrary.rows.length),buildAssetLibrary({presentations:expanded},library).length);
    for(const name of PACK_CATALOGS){const actual=await page.evaluate(async name=>(await fetch('assets/'+name)).json(),name);assert.deepEqual(actual,catalogues[name],`Imported catalogue differs: ${name}`);}
    await page.getByRole('button',{name:'Gallery',exact:true}).click();await page.locator('#skill-role').selectOption(skillRole.id);await page.locator('#open-skill').click();await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.skillDisplay&&!document.querySelector('#open-skill').disabled);await page.getByRole('button',{name:'Export',exact:true}).click();await page.locator('#export-format').selectOption('png');assert.ok(await page.evaluate(async()=>Boolean(await window.mteExporter.run())));console.log('Full converted resource archive imported, matched every indexed file and catalogue, and exported a skill offline',imported);
  }
  await page.getByRole('button',{name:'Gallery',exact:true}).click();await page.locator('#pack-remove').click();await page.waitForFunction(()=>window.mteStudio.packReloadRequired);assert.equal(await page.evaluate(()=>window.mteCache.request('PACK_STATUS')),null);assert.deepEqual(errors,[]);console.log(engine+': Local pack checks passed: code-only host, real imported Spine/audio, native images, particle media, original fonts, skill events and offline PNG, atomic replacement, missing-file rejection, cancellation, cross-tab reload, isolated cache clearing and byte ranges',first.result,native,fonts,skill);
}finally{await context.close();if(launched)await launched.close();await new Promise(resolve=>server.close(resolve));if(profile)await rm(profile,{recursive:true});}
