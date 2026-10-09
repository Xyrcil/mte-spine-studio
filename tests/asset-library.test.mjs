import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildAssetLibrary,queryAssetLibrary,artworkPreviewView} from '../src/asset-library.js';
import {expandHotSpringPresentations} from '../src/engine/hot-spring.js';

test('original and archived artwork inherit preview settings from their source resource',()=>{
  const camera={fieldOfView:20},view={id:'301301101',origin:'legacy'},explicit={id:'explicit',origin:'archive'},views={camera,views:[view,explicit]};
  for(const presentation of [{id:'Spines/painting/301301101_spine'},{id:'Spines/painting/301301101_spine/original',sourceBundle:'Spines/painting/301301101_spine'},{id:'Spines/painting/301301101_spine_hx/archive-1',sourceBundle:'Spines/painting/301301101_spine_hx'}])assert.deepEqual(artworkPreviewView(presentation,{id:'variant'},views),{...view,camera});
  assert.deepEqual(artworkPreviewView({id:'Spines/painting/301301101_spine'},{id:'explicit'},views),{...explicit,camera});
  assert.equal(artworkPreviewView({id:'Spines/story/301301101'},{id:'variant'},views),undefined);
  assert.equal(artworkPreviewView({id:'Spines/painting/301301101_spine'},{id:'variant'},undefined),undefined);
});

const catalog={presentations:[{id:'base',category:'painting',instances:[{}]},{id:'skin',category:'painting',instances:[{},{}]},{id:'story',category:'story',instances:[{}]},{id:'other',category:'storyCG',instances:[{}]},{id:'empty',instances:[]}]};
const library={characters:[{id:'1',name:'Alice (Summer)'}],voices:[{targetId:'1'}],appearances:[{id:'1',characterId:'1',characterName:'Alice',name:'Original',kind:'painting',bundle:'base',portrait:{}},{id:'2',characterId:'1',characterName:'Alice (Summer)',name:'Summer',kind:'skin',bundle:'skin',portrait:{}},{id:'3',characterId:'1',name:'Story',kind:'story',bundle:'story'},{id:'4',name:'Absent',kind:'painting',spineStatus:'missing-source'},{id:'5',name:'Preview',kind:'painting',spineStatus:'missing-source',portrait:{}}]};
test('library keeps all appearances, standalone bundles and explicit display states',()=>{
  const rows=buildAssetLibrary(catalog,library);assert.equal(rows.length,6);assert.equal(rows.find(r=>r.name==='Absent').status,'missing');assert.equal(rows.find(r=>r.name==='Preview').status,'static');assert.equal(rows.find(r=>r.name==='Summer').status,'animated');assert.equal(rows.find(r=>r.name==='Summer').characterName,'Alice');assert.equal(rows.find(r=>r.name==='Summer').voiceIndexed,true);assert.ok(rows.some(r=>r.presentation?.id==='other'));
});
test('derived skill presentations stay in their selector rather than duplicating artwork cards',()=>{
  const expanded={presentations:[...catalog.presentations,{id:'base/skill/1',category:'ui',skillDisplay:{receiverId:'receiver'},instances:[{}]}]};assert.deepEqual(buildAssetLibrary(expanded,library),buildAssetLibrary(catalog,library));
});
test('empty source templates stay visible as unavailable rather than animated artwork',()=>{
  const empty={id:'template',category:'storyCG',instances:[],unassignedInstances:[{name:'role'}]},partial={id:'partial',category:'storyCG',instances:[{}],unassignedInstances:[{name:'role2'}]};
  const rows=buildAssetLibrary({presentations:[empty,partial]},library);
  assert.equal(rows.find(row=>row.presentation===empty).status,'missing');assert.equal(rows.find(row=>row.presentation===partial).status,'animated');
});
test('character, category, source searches, favorites and recent order compose',()=>{
  const rows=buildAssetLibrary(catalog,library);assert.equal(queryAssetLibrary(rows,{character:'1'}).length,3);assert.equal(queryAssetLibrary(rows,{category:'painting'}).length,4);assert.equal(queryAssetLibrary(rows,{category:'skin',search:'alice summer'}).length,1);assert.equal(queryAssetLibrary(rows,{category:'portrait'}).length,3);assert.equal(queryAssetLibrary(rows,{character:'unassigned'}).length,3);
  assert.deepEqual(queryAssetLibrary(rows,{collection:'favorites',favorites:['appearance:2']}).map(r=>r.name),['Summer']);assert.deepEqual(queryAssetLibrary(rows,{collection:'recent',recent:['appearance:3','appearance:1']}).map(r=>r.name),['Story','Original']);assert.equal(queryAssetLibrary(rows,{search:'does not exist'}).length,0);
});
test('original controller variants retain their own collider geometry and appearance association',t=>{
  let catalog,library;try{catalog=JSON.parse(readFileSync(new URL('../public/assets/presentations.json',import.meta.url)));library=JSON.parse(readFileSync(new URL('../public/assets/library.json',import.meta.url)));}catch{t.skip('Local game assets are not distributed');return;}
  for(const name of ['301301101_spine','301603101_spine']){
    const bundle='Spines/painting/'+name,original=catalog.presentations.find(row=>row.id===bundle+'/original');
    if(!original){t.skip('Original controller variants are not installed');return;}
    const previous=catalog.presentations.find(row=>row.id===bundle),appearance=library.appearances.find(row=>row.bundle===original.id),parent=library.appearances.find(row=>row.bundle===bundle);
    const geometry=row=>row.hotspots.map(hit=>({name:hit.name,colliders:hit.colliders.map(collider=>({type:collider.type,offset:collider.data.m_Offset,size:collider.data.m_Size}))})).sort((a,b)=>a.name.localeCompare(b.name));
    assert.notDeepEqual(geometry(original),geometry(previous));assert.notEqual(original.controllers[0].id,previous.controllers[0].id);
    assert.equal(original.sourceBundle,bundle);assert.equal(appearance.variantOf,parent.id);assert.equal(appearance.characterId,parent.characterId);assert.equal(appearance.kind,parent.kind);
  }
});
test('real local catalogue retains every display entry and every renderable bundle',t=>{
  let c,l;try{c=JSON.parse(readFileSync(new URL('../public/assets/presentations.json',import.meta.url)));l=JSON.parse(readFileSync(new URL('../public/assets/library.json',import.meta.url)));}catch{t.skip('Local game assets are not distributed');return;}
  c.presentations=expandHotSpringPresentations(c.presentations,l.hotSpringHouses);const rows=buildAssetLibrary(c,l);assert.equal(new Set(rows.map(r=>r.key)).size,rows.length);for(const appearance of l.appearances)assert.ok(rows.some(r=>r.appearance===appearance));for(const presentation of c.presentations.filter(p=>p.instances.length))assert.ok(rows.some(r=>r.presentation===presentation));
  for(const row of rows.filter(row=>row.appearance?.hotSpringRoleIds)){assert.equal(row.status,'animated');assert.equal(row.voiceIndexed,true);}
  assert.equal(queryAssetLibrary(rows,{category:'story'}).filter(row=>row.presentation?.origin!=='original-archive').length,244);assert.equal(queryAssetLibrary(rows,{category:'skin'}).filter(row=>!row.appearance.variantOf).length,65);assert.equal(rows.find(r=>r.appearance?.id==='301402501').characterName,'安普莎');
  for(const row of rows.filter(row=>row.appearance?.variantOf)){const parent=rows.find(parent=>parent.appearance?.id===row.appearance.variantOf);assert.ok(parent);assert.equal(row.characterId,parent.characterId);assert.equal(row.category,parent.category);}
});
