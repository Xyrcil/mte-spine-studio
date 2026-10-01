import test from 'node:test';
import assert from 'node:assert/strict';
import {resourceFiles,validatePackCatalogues,packPath,packUrl,resourceType,PACK_CATALOGS} from '../src/engine/resource-pack.js';
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
