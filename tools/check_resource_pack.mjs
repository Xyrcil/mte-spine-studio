import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat,mkdtemp,rm} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from '@playwright/test';
import {expectedPackPaths,PACK_CATALOGS,resourceType} from '../src/engine/resource-pack.js';
const root=resolve('dist'),assets=resolve('public/assets'),catalogues=Object.fromEntries(await Promise.all(PACK_CATALOGS.map(async name=>[name,JSON.parse(await readFile(resolve(assets,name),'utf8'))])));
const bundle='Spines/painting/3014027_spine',appearance=catalogues['library.json'].appearances.find(row=>row.bundle===bundle),voice=catalogues['library.json'].voices.find(row=>row.targetId===appearance.characterId&&row.resourceName.includes('Login'));
const fixture={
  'presentations.json':{schema:1,presentations:catalogues['presentations.json'].presentations.filter(row=>row.id===bundle)},
  'runtime-index.json':{schema:1,summary:{parsed:1},entries:catalogues['runtime-index.json'].entries.filter(row=>row.bundle===bundle)},
  'library.json':{schema:1,characters:catalogues['library.json'].characters.filter(row=>row.id===appearance.characterId),appearances:[appearance],voices:[voice],storyVoices:[],soundResources:catalogues['library.json'].soundResources.filter(row=>row.resource.split('/').at(-1)===voice.resourceName)},
  'audio-index.json':{schema:1,entries:catalogues['audio-index.json'].entries.filter(row=>row.name===voice.resourceName)},
  'portrait-index.json':{schema:1,entries:catalogues['portrait-index.json'].entries.filter(row=>row.sprites.some(sprite=>sprite.path===appearance.portrait.path))}
};
const paths=[...PACK_CATALOGS,...expectedPackPaths(fixture)],allowed=new Set(paths);let mediaNetworkRequests=0;
const server=createServer(async(request,response)=>{
  try{
    const path=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(path==='/fixtures/files.json'){response.setHeader('content-type','application/json');response.end(JSON.stringify(paths));return;}
    if(path.startsWith('/fixtures/')){const name=path.slice(10);if(!allowed.has(name)){response.writeHead(404).end();return;}response.setHeader('content-type',resourceType(name));response.end(fixture[name]?JSON.stringify(fixture[name]):await readFile(resolve(assets,name)));return;}
    if(!path.startsWith('/pack-check/')){response.writeHead(404).end();return;}
    const local=path.slice(12)||'index.html';if(local.startsWith('assets/')&&!/^assets\/[^/]+\.(js|css)$/.test(local)){mediaNetworkRequests++;response.writeHead(404,{'content-type':'text/plain'}).end('No game assets are hosted');return;}
    const target=resolve(root,local);if(!target.startsWith(root+'/')||!(await stat(target)).isFile()){response.writeHead(404).end();return;}response.setHeader('content-type',extname(target)==='.js'?'text/javascript':extname(target)==='.css'?'text/css':extname(target)==='.html'?'text/html':extname(target)==='.json'?'application/json':'text/plain');response.end(await readFile(target));
  }catch{response.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,url=origin+'/pack-check/';
const full=process.argv.includes('--full'),profile=full?await mkdtemp(resolve('private/pack-check-profile-')):null;
const browser=full?null:await chromium.launch({channel:'chrome',headless:true});
const context=full?await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,viewport:{width:1440,height:1000}}):await browser.newContext({viewport:{width:1440,height:1000}});
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
  await page.evaluate(()=>window.mteCache.request('CLEAR'));assert.ok(await page.evaluate(()=>window.mteCache.request('PACK_STATUS')));await context.setOffline(true);await page.reload();await page.waitForFunction(()=>window.mteStudio?.groups.length&&!window.mteEditor.busy);
  const networkBefore=mediaNetworkRequests;await page.getByRole('button',{name:'Export',exact:true}).click();await page.locator('#export-format').selectOption('png');for(const [key,value] of [['width','160'],['height','120'],['end','.2']])await page.locator(`#export-${key}`).fill(value);const output=await page.evaluate(async()=>{const result=await window.mteExporter.run();return {ok:Boolean(result),frames:result?.plan.frames,status:document.querySelector('#export-status').textContent};});assert.equal(output.ok,true,output.status);assert.equal(output.frames,1);assert.equal(mediaNetworkRequests,networkBefore);
  await page.getByRole('button',{name:'Gallery',exact:true}).click();
  if(full){
    await context.setOffline(false);await page.locator('#pack-zip-file').setInputFiles(resolve('private/mte-resources.zip'));let previous=-1;
    for(let elapsed=0;elapsed<900;elapsed+=5){const progress=await page.evaluate(()=>({busy:window.mtePack.busy,done:document.querySelector('#pack-progress').value,total:document.querySelector('#pack-progress').max,status:document.querySelector('#pack-status').textContent,reload:window.mteStudio.packReloadRequired}));if(progress.done!==previous){console.log('Full pack progress',progress);previous=progress.done;}if(progress.reload)break;if(!progress.busy&&elapsed>0)throw new Error(progress.status);await page.waitForTimeout(5000);}
    assert.equal(await page.evaluate(()=>window.mteStudio.packReloadRequired),true);const imported=await page.evaluate(()=>window.mteCache.request('PACK_STATUS'));assert.ok(imported.bytes>3*1024**3);await page.reload();await page.waitForFunction(()=>window.mteStudio?.groups.length&&!window.mteEditor.busy);assert.equal(await page.evaluate(()=>window.mteLibrary.rows.length),513);console.log('Full converted resource archive imported and loaded',imported);
  }
  await page.locator('#pack-remove').click();await page.waitForFunction(()=>window.mteStudio.packReloadRequired);assert.equal(await page.evaluate(()=>window.mteCache.request('PACK_STATUS')),null);assert.deepEqual(errors,[]);console.log('Local pack checks passed: code-only host, real imported Spine/audio, atomic replacement, missing-file rejection, cancellation, cross-tab reload, isolated cache clearing, byte ranges and offline PNG export',first.result);
}finally{await context.close();if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));if(profile)await rm(profile,{recursive:true});}
