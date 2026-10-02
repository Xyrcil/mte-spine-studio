import test from 'node:test';
import assert from 'node:assert/strict';
import {resourceFiles,validatePackCatalogues,packPath,packUrl,resourceType,PACK_CATALOGS,expectedPackPaths} from '../src/engine/resource-pack.js';
const catalogue=name=>name==='library.json'?{schema:1,characters:[],appearances:[],voices:[],storyVoices:[],soundResources:[]}:name==='presentations.json'?{schema:1,presentations:[]}:{schema:1,entries:[]};
function file(path,content=''){const result=new File([content],path.split('/').at(-1));Object.defineProperty(result,'webkitRelativePath',{value:'assets/'+path});return result;}
const files=()=>PACK_CATALOGS.map(name=>file(name,JSON.stringify(catalogue(name))));
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
