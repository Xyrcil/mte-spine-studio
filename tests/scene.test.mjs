import test from 'node:test';
import assert from 'node:assert/strict';
import {validateScene,History} from '../src/engine/scene.js';
import {Stage,objectTransform} from '../src/engine/stage.js';
import {InteractionRoot} from '../src/engine/interaction.js';
const scene=()=>({schema:1,name:'Scene',camera:{x:0,y:0,width:10,height:10},background:'#191b20',speed:1,paused:true,objects:[{id:'actor',kind:'spine',name:'Actor',bundle:'painting',x:1,y:2,scale:1,rotation:0,opacity:1,flipX:false,flipY:false,visible:true,locked:false,layers:[{id:'body',active:true,tracks:[{index:0,name:'Idle',time:2,loop:true,timeScale:1}]}]}]});
test('derived scene artwork retains its explicit appearance association',()=>{const value=scene();value.objects[0].appearanceId='skin';assert.deepEqual(validateScene(value),value);value.objects[0].appearanceId=42;assert.throws(()=>validateScene(value),/appearance ID/);});
test('scene word checkpoints retain coroutine progress without copying source labels',()=>{const value=scene(),state={kind:'skill-words',schema:1,count:13,clock:.4,step:1,nextUpdate:.41,playing:true};value.objects[0].interactions=[{id:'skill-words',state}];assert.deepEqual(validateScene(value),value);value.objects[0].interactions[0].state={...state,text:'Do not persist source labels'};assert.equal(validateScene(value).objects[0].interactions[0].state.text,undefined);value.objects[0].interactions[0].state.step=99;assert.throws(()=>validateScene(value),/word checkpoint/);});
test('native event cursors round-trip through scenes and reject invalid indices',()=>{const value=scene();value.objects[0].nativeAnimations=[{schema:1,id:'animation',clip:'clip',time:1,playing:true,eventCursor:2}];assert.deepEqual(validateScene(value),value);value.objects[0].nativeAnimations[0].eventCursor=-1;assert.throws(()=>validateScene(value),/event checkpoint/);});
test('scene round trip preserves transforms and animation time',()=>assert.deepEqual(validateScene(scene()),scene()));
test('material clock round trips independently of animation tracks and old scenes remain unchanged',()=>{
  const value=scene();assert.equal(validateScene(value).materialTime,undefined);value.materialTime=7.625;assert.deepEqual(validateScene(value),value);for(const time of [-1,NaN,Infinity,'1'])assert.throws(()=>validateScene({...value,materialTime:time}),/material time/);
});
test('source preview parameters round-trip independently of catalogue settings and reject invalid references',()=>{
  const value=scene();value.camera.sourcePreview={group:'actor',aspect:1.6,view:{camera:{x:0,y:.09,halfHeight:1,referenceAspect:16/9},position:{x:.177,y:.005},scale:{x:.185,y:.185},offset:1.1}};
  const checked=validateScene(value);assert.deepEqual(checked,value);value.camera.sourcePreview.view.position.x=99;assert.equal(checked.camera.sourcePreview.view.position.x,.177);
  const stage=Object.create(Stage.prototype);Object.assign(stage,{camera:checked.camera,groups:[{...checked.objects[0],layers:[],controllers:[],presentation:{id:'painting'}}],background:checked.background,speed:1,paused:true});const snapshot=stage.snapshot();snapshot.camera.sourcePreview.view.scale.x=42;assert.equal(stage.camera.sourcePreview.view.scale.x,.185);
  for(const update of [{group:'missing'},{aspect:0},{view:{}}]){const invalid=structuredClone(checked);Object.assign(invalid.camera.sourcePreview,update);assert.throws(()=>validateScene(invalid),/preview/);}
});
test('native scene animations round-trip clocks and reject duplicate or invalid checkpoints',()=>{const value=scene(),saved={schema:1,id:'animation',clip:'smoke',time:1.25,playing:true};value.objects[0].nativeAnimations=[saved];assert.deepEqual(validateScene(value),value);value.objects[0].nativeAnimations.push(saved);assert.throws(()=>validateScene(value),/Duplicate native/);value.objects[0].nativeAnimations=[{...saved,time:-1}];assert.throws(()=>validateScene(value),/native animation/);});
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
test('controller type preflight rejects otherwise valid foreign states without mutating the scene',async()=>{
  for(const state of [{kind:'skill-display',ended:false},{kind:'skill-words',schema:1,count:2,clock:0,step:0,nextUpdate:0,playing:false},{kind:'bone-drag',schema:1,writing:false,pointer:null,motion:{schema:1,current:{x:0,y:0},from:{x:0,y:0},dragging:false,returning:false,elapsed:0}}]){
    const stage=Object.create(Stage.prototype),value=scene(),root=new InteractionRoot(new EventTarget(),{transforms:new Map(),nodes:new Map(),layers:[],presentation:{hotspots:[]}},{id:'root',gameObject:'0',data:{}}),before=root.snapshot();
    value.objects[0].layers=[];value.objects[0].interactions=[{id:'root',state}];const group={...value.objects[0],presentation:{id:'painting'},layers:[],controllers:[root]};stage.groups=[group];stage.camera={...value.camera};stage.paused=false;value.objects[0].x=999;
    await assert.rejects(stage.restore(value,[],[]),/interaction type does not match asset/);assert.equal(group.x,1);assert.deepEqual(root.snapshot(),before);assert.equal(stage.groups[0],group);assert.equal(stage.paused,false);
  }
});
test('object transforms combine rotation and mirrors',()=>{
  const m=objectTransform({x:3,y:4,scale:2,rotation:90,flipX:true,flipY:false});
  assert.ok(Math.abs(m[0])<1e-10);assert.equal(m[1],-2);assert.equal(m[2],-2);assert.deepEqual(m.slice(4),[3,4]);
});
test('removing a character releases its backgrounds while retaining the shared scene array',()=>{
  const stage=Object.create(Stage.prototype),actor={id:'actor'},background={id:'background',parentId:'actor'},other={id:'other'};stage.groups=[background,actor,other];const shared=stage.groups,released=[];stage.release=group=>released.push(group.id);stage.remove(actor.id);assert.equal(stage.groups,shared);assert.deepEqual(shared,[other]);assert.deepEqual(new Set(released),new Set(['actor','background']));
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
test('portrait references reject traversal and do not embed asset bytes',()=>{
  const value=scene();Object.assign(value.objects[0],{kind:'image',asset:'portraits/role/-123.png',appearanceId:'role',width:20,height:30});
  const checked=validateScene(value);assert.equal(checked.objects[0].asset,'portraits/role/-123.png');assert.equal(checked.objects[0].src,undefined);
  value.objects[0].asset='portraits/../secret/1.png';assert.throws(()=>validateScene(value),/portrait asset/);
});
