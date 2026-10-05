import test from 'node:test';
import assert from 'node:assert/strict';
import {resourceFiles,validatePackCatalogues,packPath,packUrl,resourceType,PACK_CATALOGS,expectedPackPaths,verifyPackCache} from '../src/engine/resource-pack.js';
const catalogue=name=>name==='library.json'?{schema:1,characters:[],appearances:[],voices:[],storyVoices:[],soundResources:[]}:name==='presentations.json'?{schema:1,presentations:[]}:{schema:1,entries:[]};
function file(path,content=''){const result=new File([content],path.split('/').at(-1));Object.defineProperty(result,'webkitRelativePath',{value:'assets/'+path});return result;}
test('skeleton material textures are required relative to their own bundle and cannot escape it',async()=>{
  const catalogs=Object.fromEntries(PACK_CATALOGS.map(name=>[name,catalogue(name)])),texture={path:'materials/noise.png'},entry={status:'parsed',path:'spines/painting/role',skeleton:'id/skeleton.skel',atlases:[],materialBindings:{pages:[{materials:{normal:{textures:{_NoiseTex:texture,_MaskTex:{default:'white'}}}}}]}};catalogs['runtime-index.json'].entries=[entry];
  assert.deepEqual(expectedPackPaths(catalogs),['spines/painting/role/id/skeleton.skel','spines/painting/role/materials/noise.png']);
  const selected=PACK_CATALOGS.map(name=>file(name,JSON.stringify(catalogs[name])));selected.push(file('spines/painting/role/id/skeleton.skel'));await assert.rejects(validatePackCatalogues(resourceFiles(selected).rows),/noise.png/);selected.push(file('spines/painting/role/materials/noise.png'));await validatePackCatalogues(resourceFiles(selected).rows);
  texture.path='../outside.png';assert.throws(()=>expectedPackPaths(catalogs),/Invalid resource path/);
});
const files=()=>PACK_CATALOGS.map(name=>file(name,JSON.stringify(catalogue(name))));
test('resource imports require every original material mip and reject escaping mip paths',async()=>{
  const catalogs=Object.fromEntries(PACK_CATALOGS.map(name=>[name,catalogue(name)])),mip={path:'textures/noise.mip-1.png'},texture={path:'textures/noise.png',mips:[mip]};catalogs['runtime-index.json'].entries=[{status:'parsed',path:'spines/role',skeleton:'skeleton.skel',atlases:[],materialBindings:{pages:[{materials:{normal:{textures:{_NoiseTex:texture}}}}]}}];
  const selected=PACK_CATALOGS.map(name=>file(name,JSON.stringify(catalogs[name])));selected.push(file('spines/role/skeleton.skel'),file('spines/role/textures/noise.png'));await assert.rejects(validatePackCatalogues(resourceFiles(selected).rows),/noise.mip-1/);selected.push(file('spines/role/textures/noise.mip-1.png'));await validatePackCatalogues(resourceFiles(selected).rows);mip.path='../outside.png';assert.throws(()=>expectedPackPaths(catalogs),/Invalid resource path/);
});
test('large imported packs verify their manifest in bounded batches without enumerating the cache',async()=>{
  const base='https://example.test/mte/',manifest=[...PACK_CATALOGS.map(path=>({path,size:0})),...Array.from({length:18000},(_,index)=>({path:`portraits/${index}.png`,size:0}))],byUrl=new Map(manifest.map(row=>[packUrl(row.path,base),row]));let active=0,maximum=0,progress;
  const cache={keys:()=>{throw new Error('Operation too large');},match:async url=>{active++;maximum=Math.max(maximum,active);await Promise.resolve();active--;const row=byUrl.get(url);return new Response(null,{headers:{'content-length':'0','content-type':resourceType(row.path)}});}};
  assert.deepEqual(await verifyPackCache(cache,manifest,base,(done,total)=>progress={done,total}),{files:18005,bytes:0});assert.ok(maximum<=64);assert.deepEqual(progress,{done:18005,total:18005});
});
test('pack verification rejects duplicates, missing resources, wrong sizes and content types',async()=>{
  const base='https://example.test/mte/',manifest=PACK_CATALOGS.map(path=>({path,size:0})),response=()=>new Response(null,{headers:{'content-length':'0','content-type':'application/json'}});
  await assert.rejects(verifyPackCache({},[...manifest,manifest[0]],base),/manifest/);await assert.rejects(verifyPackCache({},manifest.slice(1),base),/manifest/);
  for(const match of [async()=>undefined,async()=>new Response(null,{headers:{'content-length':'1','content-type':'application/json'}}),async()=>new Response(null,{headers:{'content-length':'0','content-type':'text/html'}})])await assert.rejects(verifyPackCache({match},manifest,base),/does not match/);
  assert.deepEqual(await verifyPackCache({match:async()=>response()},manifest,base),{files:5,bytes:0});
});
test('resource folders require one catalogue root and exclude executable content',async()=>{
  const selected=[...files(),file('spines/角色/page.png','image'),file('payload.js','code'),file('client.apk','client')],pack=resourceFiles(selected);assert.equal(pack.excluded,2);assert.equal(pack.rows.length,6);await validatePackCatalogues(pack.rows);assert.equal(resourceType('page.png'),'image/png');
  assert.throws(()=>resourceFiles(selected.filter(file=>file.name!=='library.json')),/catalogue missing/);assert.throws(()=>resourceFiles([...selected,selected[0]]),/Duplicate resource/);assert.throws(()=>resourceFiles([file('other/a.png')]),/Choose one/);
});
test('resource paths cannot escape the app scope, use remote URLs or contain URL escapes',()=>{
  for(const path of ['../outside.png','/outside.png','a/../b.png','https://example.test/a.png','a\\b.png','a%2fb.png','a.png?q=1','a.png#x'])assert.throws(()=>packPath(path),/Invalid resource path/);
  assert.equal(packUrl('spines/角色/a.png','https://example.test/mte/'),'https://example.test/mte/assets/spines/%E8%A7%92%E8%89%B2/a.png');
});
test('invalid catalogues and missing indexed files fail before storing any replacement pack',async()=>{
  const bad=files();bad[0]=file('presentations.json','not json');await assert.rejects(validatePackCatalogues(resourceFiles(bad).rows),/Invalid JSON/);
  const indexed=files();indexed[1]=file('runtime-index.json',JSON.stringify({schema:1,entries:[{status:'parsed',path:'spines/example',id:'1',skeleton:'1/skeleton.skel',atlases:[{atlas:'atlas-0/texture.atlas',pages:['page.png']}]}]}));
  await assert.rejects(validatePackCatalogues(resourceFiles(indexed).rows),/Indexed files missing/);indexed.push(file('spines/example/1/skeleton.skel'),file('spines/example/1/atlas-0/texture.atlas'),file('spines/example/1/atlas-0/page.png'));await validatePackCatalogues(resourceFiles(indexed).rows);
});

test('native images and particle sprites and material textures are indexed relative to their presentation',async()=>{
  const catalogs=Object.fromEntries(PACK_CATALOGS.map(name=>[name,catalogue(name)]));catalogs['presentations.json'].presentations=[{path:'spines/ui/Onsen',images:[{sprite:{path:'effects/sprites/heart.png'}}],effects:[{sprites:[{path:'effects/sprites/smoke.png'}],materials:[{textures:{_MainTex:{path:'effects/textures/main.png'},_MaskTex:{path:'effects/textures/mask.png'}}}]}]}];
  const paths=expectedPackPaths(catalogs);assert.deepEqual(paths.sort(),['heart','smoke'].map(name=>`spines/ui/Onsen/effects/sprites/${name}.png`).concat(['main','mask'].map(name=>`spines/ui/Onsen/effects/textures/${name}.png`)).sort());
  const selected=PACK_CATALOGS.map(name=>file(name,JSON.stringify(catalogs[name])));await assert.rejects(validatePackCatalogues(resourceFiles(selected).rows),/Indexed files missing/);selected.push(...paths.map(path=>file(path,'pixels')));await validatePackCatalogues(resourceFiles(selected).rows);
  catalogs['presentations.json'].presentations[0].images[0].sprite.path='../outside.png';assert.throws(()=>expectedPackPaths(catalogs),/Invalid resource path/);
});
test('composed native images reference their own source bundle without inventing a local copy',()=>{
  const catalogs=Object.fromEntries(PACK_CATALOGS.map(name=>[name,catalogue(name)])),assetPath='spines/interfaces/UI/Prefab/Onsen/effects/heart.png';catalogs['presentations.json'].presentations=[{path:'spines/ui/Onsen',images:[{assetPath,sprite:{path:'effects/heart.png'}}]}];
  assert.deepEqual(expectedPackPaths(catalogs),[assetPath]);
});
test('original fonts are required indexed resources and retain font MIME types',async()=>{
  const catalogs=Object.fromEntries(PACK_CATALOGS.map(name=>[name,catalogue(name)])),path='spines/interfaces/fonts/SOURCE.otf',native='spines/interfaces/fonts/PERTIBD.ttf';catalogs['presentations.json'].presentations=[{fontAssets:[{path}],nativeFontAssets:[{path:native}]}];assert.deepEqual(expectedPackPaths(catalogs),[path,native]);
  const selected=PACK_CATALOGS.map(name=>file(name,JSON.stringify(catalogs[name])));await assert.rejects(validatePackCatalogues(resourceFiles(selected).rows),/Indexed files missing/);selected.push(file(path,'original font'));await assert.rejects(validatePackCatalogues(resourceFiles(selected).rows),/PERTIBD/);selected.push(file(native,'original native font'));const pack=resourceFiles(selected);assert.equal(pack.excluded,0);await validatePackCatalogues(pack.rows);assert.equal(resourceType(path),'font/otf');assert.equal(resourceType(native),'font/ttf');
});
