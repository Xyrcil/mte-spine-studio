import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {expandHotSpringPresentations} from '../src/engine/hot-spring.js';
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
