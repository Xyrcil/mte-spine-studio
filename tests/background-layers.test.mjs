import test from 'node:test';
import assert from 'node:assert/strict';
import {backgroundMatrix,backgroundOpacity,objectVisible,setBackgroundParent,objectDragDelta,sceneDrawOrder,moveSceneLayer,duplicateSceneObject} from '../src/engine/background-layers.js';
import {validateScene} from '../src/engine/scene.js';
import {point} from '../src/engine/geometry.js';
const owner=(id='actor')=>({id,kind:'spine',name:id,bundle:'bundle',x:3,y:4,scale:2,rotation:37,opacity:.5,flipX:true,flipY:false,visible:true,locked:false,layers:[]});
const image=(id='background')=>({id,kind:'image',name:id,src:'data:image/png;base64,AA==',width:2,height:3,x:-2,y:1,scale:.8,rotation:-14,opacity:.6,flipX:false,flipY:true,visible:true,locked:false});
const scene=objects=>({schema:1,name:'Scene',background:'#000000',camera:{x:0,y:0,width:10,height:10},speed:1,paused:true,objects});
const near=(a,b)=>a.forEach((value,index)=>assert.ok(Math.abs(value-b[index])<1e-10,`${index}: ${value} != ${b[index]}`));
test('attachment and detachment retain image geometry under rotated mirrored owners',()=>{
  const actor=owner(),background=image(),objects=[background,actor],before=backgroundMatrix(background,objects);setBackgroundParent(background,actor.id,objects);near(backgroundMatrix(background,objects),before);assert.equal(background.parentId,actor.id);assert.equal(backgroundOpacity(background,objects),.3);
  actor.x+=5;const moved=backgroundMatrix(background,objects);assert.ok(Math.abs(moved[4]-before[4]-5)<1e-10);actor.visible=false;assert.equal(objectVisible(background,objects),false);actor.visible=true;setBackgroundParent(background,undefined,objects);near(backgroundMatrix(background,objects),moved);assert.equal(background.parentId,undefined);assert.equal(background.opacity,.3);
});
test('background drag deltas stay local and draw order keeps each background behind its owner',()=>{
  const actor=owner(),other=owner('other'),a=image('a'),b=image('b'),objects=[a,other,b,actor];setBackgroundParent(a,actor.id,objects);setBackgroundParent(b,actor.id,objects);assert.deepEqual(sceneDrawOrder(objects).map(row=>row.id),['other','a','b','actor']);moveSceneLayer(objects,a,1);assert.deepEqual(sceneDrawOrder(objects).map(row=>row.id),['other','b','a','actor']);moveSceneLayer(objects,actor,-1);assert.deepEqual(sceneDrawOrder(objects).map(row=>row.id),['b','a','actor','other']);
  const before=point(backgroundMatrix(a,objects),0,0),delta=objectDragDelta(a,objects,2,-1);a.x+=delta.x;a.y+=delta.y;const after=point(backgroundMatrix(a,objects),0,0);assert.ok(Math.abs(after.x-before.x-2)<1e-10&&Math.abs(after.y-before.y+1)<1e-10);
});
test('scene links round-trip and reject missing owners, chains and attached portraits',()=>{
  const actor=owner(),background={...image(),parentId:actor.id},original=scene([background,actor]);assert.deepEqual(validateScene(original),original);
  for(const parentId of ['missing',background.id])assert.throws(()=>validateScene(scene([{...background,parentId},actor])),/background owner/);
  assert.throws(()=>validateScene(scene([{...actor,parentId:background.id},background])),/background owner/);assert.throws(()=>validateScene(scene([{...background,asset:'portraits/role/1.png'},actor])),/background owner/);
  const portrait={...image('portrait'),asset:'portraits/role/1.png'};delete portrait.src;assert.equal(validateScene(scene([{...background,parentId:portrait.id},portrait])).objects[0].parentId,portrait.id);
});
test('duplicating a character preserves its backgrounds and remaps sound owners without changing the source',()=>{
  const actor=owner(),background={...image(),parentId:actor.id},original=scene([background,actor]);original.audio={ambientTracks:[{id:actor.id},{id:background.id}],effectTracks:[{group:background.id}]};let id=0;const {scene:copy,copy:character}=duplicateSceneObject(original,actor.id,()=>`copy-${id++}`);assert.equal(character.x,actor.x+1);const attached=copy.objects.find(row=>row.parentId===character.id);assert.ok(attached);assert.equal(attached.x,background.x);assert.equal(copy.audio.ambientTracks.length,4);assert.equal(copy.audio.effectTracks.at(-1).group,attached.id);assert.equal(original.objects.length,2);
});
