import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {viewportRectLayout} from '../src/engine/ui-layout.js';
import {expandHotSpringPresentations} from '../src/engine/hot-spring.js';
import {point} from '../src/engine/geometry.js';

function transform(id,parent,anchors,size,pivot,position){return {id,type:'RectTransform',data:{m_Father:{m_PathID:parent},m_AnchorMin:anchors[0],m_AnchorMax:anchors[1],m_SizeDelta:size,m_Pivot:pivot,m_AnchoredPosition:position}};}
test('viewport layout resolves stretch, bottom anchoring, and children relative to parent pivots',()=>{
  const root=transform('root','0',[{x:0,y:0},{x:1,y:1}],{x:0,y:0},{x:.5,y:.5},{x:0,y:0}),panel=transform('panel','root',[{x:.5,y:0},{x:.5,y:0}],{x:748,y:202},{x:.5,y:.5},{x:-4,y:160}),child=transform('child','panel',[{x:.5,y:.5},{x:.5,y:.5}],{x:617,y:50},{x:.5,y:.5},{x:-23,y:31}),nodes=new Map([root,panel,child].map(node=>[node.id,node]));
  const before=structuredClone(nodes),layout=viewportRectLayout(nodes,'child','root',{x:1920,y:1080});assert.deepEqual(layout.size,{x:617,y:50});assert.deepEqual(point(layout.matrix,0,0),{x:-27,y:-349});assert.deepEqual(nodes,before);
  assert.deepEqual(point(viewportRectLayout(nodes,'panel','root',{x:1920,y:2160}).matrix,0,0),{x:-4,y:-920});
  panel.data.m_Pivot.x=0;assert.equal(point(viewportRectLayout(nodes,'child','root',{x:1920,y:1080}).matrix,0,0).x,347);
});
test('viewport UI layout rejects missing parents and cycles instead of using serialized preview positions',()=>{
  const root=transform('root','0',[{x:0,y:0},{x:0,y:0}],{x:1,y:1},{x:.5,y:.5},{x:0,y:0}),child=transform('child','missing',[{x:0,y:0},{x:0,y:0}],{x:1,y:1},{x:.5,y:.5},{x:0,y:0}),nodes=new Map([root,child].map(node=>[node.id,node]));assert.throws(()=>viewportRectLayout(nodes,'child','root',{x:1,y:1}),/unavailable/);child.data.m_Father.m_PathID='child';assert.throws(()=>viewportRectLayout(nodes,'child','root',{x:1,y:1}),/hierarchy/);
});
test('original dialogue panels retain body and name graphics, source text fields, and the 50-character typewriter',t=>{
  if(!fs.existsSync('public/assets/library.json')){t.skip('Local resources are not installed');return;}
  const library=JSON.parse(fs.readFileSync('public/assets/library.json')),raw=JSON.parse(fs.readFileSync('public/assets/presentations.json')).presentations,houses=expandHotSpringPresentations(raw,library.hotSpringHouses,library.hotSpringRoles).filter(row=>row.hotSpringHouse);
  if(!raw.find(row=>row.id==='UI/Prefab/UIRoot')){t.skip('Local interface resources are not installed');return;}
  for(const house of houses){const panel=house.hotSpringHouse.dialoguePanel,nodes=new Map(house.hierarchy.map(node=>[node.id,node])),layout=viewportRectLayout(nodes,panel.rootTransform,panel.rootTransform,{x:1920,y:1080});assert.deepEqual(point(layout.matrix,0,0),{x:-4,y:-380});assert.equal(panel.images.length,2);assert.equal(panel.texts.length,2);assert.equal(panel.typewriters[0].data.charactersPerSecond,50);assert.ok(panel.images.every(image=>nodes.get(image.gameObject).data.m_Name!=='btn_changeName'));}
});
