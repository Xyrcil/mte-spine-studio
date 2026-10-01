import test from 'node:test';
import assert from 'node:assert/strict';
import {validateScene,History} from '../src/engine/scene.js';
import {Stage,objectTransform} from '../src/engine/stage.js';
const scene=()=>({schema:1,name:'Scene',camera:{x:0,y:0,width:10,height:10},background:'#191b20',speed:1,paused:true,objects:[{id:'actor',kind:'spine',name:'Actor',bundle:'painting',x:1,y:2,scale:1,rotation:0,opacity:1,flipX:false,flipY:false,visible:true,locked:false,layers:[{id:'body',active:true,tracks:[{index:0,name:'Idle',time:2,loop:true,timeScale:1}]}]}]});
test('scene round trip preserves transforms and animation time',()=>assert.deepEqual(validateScene(scene()),scene()));
test('scene rejects duplicate identifiers, invalid tracks and external images',()=>{
  let value=scene();value.objects.push(structuredClone(value.objects[0]));assert.throws(()=>validateScene(value),/Duplicate object/);
  value=scene();value.objects[0].layers.push(structuredClone(value.objects[0].layers[0]));assert.throws(()=>validateScene(value),/Duplicate layer/);
  value=scene();value.objects[0].layers[0].tracks[0].index=1e9;assert.throws(()=>validateScene(value),/track index/);
  value=scene();Object.assign(value.objects[0],{kind:'image',src:'https://example.com/image.png',width:2,height:2});assert.throws(()=>validateScene(value),/embedded raster/);
  value=scene();value.objects[0].x=NaN;assert.throws(()=>validateScene(value),/Invalid x/);
});
test('history snapshots are isolated and a new edit clears redo',()=>{
  const history=new History(2),value=scene();history.push(value);value.objects[0].x=4;
  assert.equal(history.undo(value).objects[0].x,1);assert.equal(history.redo(scene()).objects[0].x,4);
  history.undo(value);history.push(scene());assert.equal(history.future.length,0);
});
test('failed asset preflight leaves existing object transforms intact',async()=>{
  const stage=Object.create(Stage.prototype),value=scene(),group={...value.objects[0],presentation:{id:'painting'},layers:[{instance:{id:'body'},skeleton:{data:{findAnimation:name=>name==='Idle'}}}]};
  stage.groups=[group];stage.camera={...value.camera};stage.paused=false;
  value.objects[0].x=99;value.objects[0].layers[0].tracks[0].name='Unknown';
  await assert.rejects(stage.restore(value,[],[]),/animation unavailable/);
  assert.equal(group.x,1);assert.equal(stage.groups[0],group);assert.equal(stage.paused,false);
});
test('object transforms combine rotation and mirrors',()=>{
  const m=objectTransform({x:3,y:4,scale:2,rotation:90,flipX:true,flipY:false});
  assert.ok(Math.abs(m[0])<1e-10);assert.equal(m[1],-2);assert.equal(m[2],-2);assert.deepEqual(m.slice(4),[3,4]);
});
test('failed import releases staged resources without replacing the old scene',async()=>{
  const stage=Object.create(Stage.prototype),value=scene(),old={id:'old'},staged={kind:'spine',layers:[]};
  stage.groups=[old];stage.camera={...value.camera};stage.paused=false;
  let disposed=false,detached=false;
  stage.add=async(_presentation,_entries,_signal,isDetached)=>{detached=isDetached;return staged;};
  stage.release=group=>{assert.equal(group,staged);disposed=true;};
  await assert.rejects(stage.restore(value,[{id:'painting'}],[]),/layer count/);
  assert.equal(detached,true);assert.equal(disposed,true);assert.deepEqual(stage.groups,[old]);assert.equal(stage.paused,false);
});
