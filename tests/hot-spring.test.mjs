import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {expandHotSpringPresentations,HotSpringRoot,validateHotSpringState} from '../src/engine/hot-spring.js';
import {unityTransform,multiply,objectTransform,point} from '../src/engine/geometry.js';
function focusFixture(){
  const events=[],transform={id:'root',data:{m_LocalPosition:{x:0,y:0},m_LocalScale:{x:1,y:1}}},roleTransform={id:'role-transform',data:{m_LocalPosition:{x:100,y:200},m_LocalScale:{x:1,y:1},m_SizeDelta:{x:60,y:80},m_Pivot:{x:.25,y:.75}}},role={id:'role',focus:{position:[-56,-163],zoom:1.62},levels:[{level:1,voiceIds:['11','12']}]};
  const group={id:'object',x:3,y:4,scale:2,rotation:19,flipX:true,nodes:new Map([['root',transform],['role-transform',roleTransform],['role-go',{id:'role-go',type:'GameObject',data:{m_Name:'role'}}]]),transforms:new Map([['role-go',roleTransform]]),isActiveTransform:()=>true,presentation:{hotSpringHouse:{rootTransform:'root',roles:[role],backgroundOffset:[-10,20],defaultZoom:.5}}};
  group.world=id=>id==='root'?unityTransform(transform.data):multiply(unityTransform(transform.data),unityTransform(roleTransform.data));const root=new HotSpringRoot({dispatchEvent:event=>events.push({type:event.type,...event.detail})},group);return {root,group,events};
}
test('source UI rectangles include pivot and object transforms, not arbitrary canvas taps',()=>{
  const {root,group}=focusFixture(),matrix=multiply(objectTransform(group),group.world('role-transform')),inside=point(matrix,0,0),outside=point(matrix,100,0);
  assert.equal(root.hitAt(inside.x,inside.y).id,'role');assert.equal(root.hitAt(outside.x,outside.y),null);root.click(root.hotspots[0]);assert.equal(root.hitAt(inside.x,inside.y),null);
});
test('one-second focus, selected pool and return survive a mid-transition checkpoint',()=>{
  const {root,events}=focusFixture();root.click(root.hotspots[0]);root.advance(.5);const checkpoint=root.snapshot();assert.equal(root.value.phase,'focusing');assert.ok(Math.abs(root.pose().x-(-44.5))<1e-9);
  root.advance(.5);const final=root.snapshot();assert.equal(final.phase,'dialogue');assert.ok(['11','12'].includes(final.voiceId));assert.equal(events.filter(event=>event.type==='voice-request').length,1);
  root.restore(checkpoint);root.advance(.5);assert.deepEqual(root.snapshot(),final);root.click(root.hotspots.find(hit=>hit.id==='continue'));assert.equal(root.value.phase,'returning');root.advance(1);assert.equal(root.value.phase,'idle');assert.deepEqual(root.pose(),root.defaults());assert.ok(events.some(event=>event.type==='voice-stop-request'));
});
test('hot spring state validation rejects foreign roles, voices and invalid levels',()=>{
  const {root}=focusFixture(),saved=root.snapshot();assert.deepEqual(validateHotSpringState(saved),saved);
  assert.throws(()=>root.restore({...saved,phase:'focusing'}),/role/);assert.throws(()=>root.restore({...saved,roleId:'other'}),/role/);assert.throws(()=>root.restore({...saved,roleId:'role',voiceId:'other'}),/voice/);assert.throws(()=>validateHotSpringState({...saved,levels:{role:0}}),/level/);assert.throws(()=>validateHotSpringState({...saved,random:0}),/random/);
});
test('hot spring houses select their own hierarchy without mutating the source bundle',()=>{
  const go=(id,name,active=true)=>({id,type:'GameObject',data:{m_Name:name,m_IsActive:active}}),tf=(id,go,children=[])=>({id,type:'RectTransform',data:{m_GameObject:{m_PathID:go},m_Children:children.map(m_PathID=>({m_PathID}))}});
  const source={id:'onsen',path:'assets',hierarchy:[go('a','1'),tf('ta','a',['tr']),go('r','role',false),tf('tr','r'),go('b','2'),tf('tb','b')],instances:[{id:'role',transform:'tr'},{id:'other',transform:'tb'}],hotspots:[],controllers:[],images:[{transform:'ta'},{transform:'tb'}]},before=structuredClone(source);
  const rows=expandHotSpringPresentations([source],[{id:'1',bundle:'onsen',roleIds:['role']},{id:'missing',bundle:'onsen',roleIds:[]}]);
  assert.equal(rows.length,2);assert.equal(rows[1].resourceBundle,'onsen');assert.deepEqual(rows[1].instances,[source.instances[0]]);assert.equal(rows[1].images.length,1);
  assert.equal(rows[1].hierarchy.find(node=>node.id==='r').data.m_IsActive,true);assert.deepEqual(source,before);
});
test('real hot spring tables produce three isolated houses with their declared roles',()=>{
  if(!fs.existsSync('public/assets/library.json'))return;
  const library=JSON.parse(fs.readFileSync('public/assets/library.json')),source=JSON.parse(fs.readFileSync('public/assets/presentations.json')).presentations;
  if(!library.hotSpringHouses)return;
  const rows=expandHotSpringPresentations(source,library.hotSpringHouses).filter(row=>row.hotSpringHouse);assert.equal(rows.length,3);
  for(const row of rows){assert.ok(row.instances.length);const names=row.hierarchy.filter(node=>node.type==='GameObject').map(node=>node.data.m_Name);assert.ok(row.hotSpringHouse.roleIds.every(id=>names.includes(id)));assert.ok(library.hotSpringHouses.filter(house=>house.id!==row.hotSpringHouse.id).every(house=>!names.includes(house.id)));}
});
