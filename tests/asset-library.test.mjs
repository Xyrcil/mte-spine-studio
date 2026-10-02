import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildAssetLibrary,queryAssetLibrary} from '../src/asset-library.js';
import {expandHotSpringPresentations} from '../src/engine/hot-spring.js';

const catalog={presentations:[{id:'base',category:'painting',instances:[{}]},{id:'skin',category:'painting',instances:[{},{}]},{id:'story',category:'story',instances:[{}]},{id:'other',category:'storyCG',instances:[{}]},{id:'empty',instances:[]}]};
const library={characters:[{id:'1',name:'Alice (Summer)'}],voices:[{targetId:'1'}],appearances:[{id:'1',characterId:'1',characterName:'Alice',name:'Original',kind:'painting',bundle:'base',portrait:{}},{id:'2',characterId:'1',characterName:'Alice (Summer)',name:'Summer',kind:'skin',bundle:'skin',portrait:{}},{id:'3',characterId:'1',name:'Story',kind:'story',bundle:'story'},{id:'4',name:'Absent',kind:'painting',spineStatus:'missing-source'},{id:'5',name:'Preview',kind:'painting',spineStatus:'missing-source',portrait:{}}]};
test('library keeps all appearances, standalone bundles and explicit display states',()=>{
  const rows=buildAssetLibrary(catalog,library);assert.equal(rows.length,6);assert.equal(rows.find(r=>r.name==='Absent').status,'missing');assert.equal(rows.find(r=>r.name==='Preview').status,'static');assert.equal(rows.find(r=>r.name==='Summer').status,'animated');assert.equal(rows.find(r=>r.name==='Summer').characterName,'Alice');assert.equal(rows.find(r=>r.name==='Summer').voiceIndexed,true);assert.ok(rows.some(r=>r.presentation?.id==='other'));
});
test('character, category, source searches, favorites and recent order compose',()=>{
  const rows=buildAssetLibrary(catalog,library);assert.equal(queryAssetLibrary(rows,{character:'1'}).length,3);assert.equal(queryAssetLibrary(rows,{category:'painting'}).length,4);assert.equal(queryAssetLibrary(rows,{category:'skin',search:'alice summer'}).length,1);assert.equal(queryAssetLibrary(rows,{category:'portrait'}).length,3);assert.equal(queryAssetLibrary(rows,{character:'unassigned'}).length,3);
  assert.deepEqual(queryAssetLibrary(rows,{collection:'favorites',favorites:['appearance:2']}).map(r=>r.name),['Summer']);assert.deepEqual(queryAssetLibrary(rows,{collection:'recent',recent:['appearance:3','appearance:1']}).map(r=>r.name),['Story','Original']);assert.equal(queryAssetLibrary(rows,{search:'does not exist'}).length,0);
});
test('real local catalogue retains every display entry and every renderable bundle',t=>{
  let c,l;try{c=JSON.parse(readFileSync(new URL('../public/assets/presentations.json',import.meta.url)));l=JSON.parse(readFileSync(new URL('../public/assets/library.json',import.meta.url)));}catch{t.skip('Local game assets are not distributed');return;}
  c.presentations=expandHotSpringPresentations(c.presentations,l.hotSpringHouses);const rows=buildAssetLibrary(c,l);assert.equal(new Set(rows.map(r=>r.key)).size,rows.length);for(const appearance of l.appearances)assert.ok(rows.some(r=>r.appearance===appearance));for(const presentation of c.presentations.filter(p=>p.instances.length))assert.ok(rows.some(r=>r.presentation===presentation));
  for(const row of rows.filter(row=>row.appearance?.hotSpringRoleIds)){assert.equal(row.status,'animated');assert.equal(row.voiceIndexed,true);}
  assert.equal(queryAssetLibrary(rows,{category:'story'}).length,244);assert.equal(queryAssetLibrary(rows,{category:'skin'}).length,65);assert.equal(rows.find(r=>r.appearance?.id==='301402501').characterName,'安普莎');
});
