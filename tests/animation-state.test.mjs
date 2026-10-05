import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {captureAnimation,capturePose,validateAnimation,validatePose,restoreAnimation,restorePose,assertCheckpoint} from '../src/engine/animation-state.js';
const context=vm.createContext({console,Float32Array,Int16Array,Uint16Array,Uint8Array,ArrayBuffer,Math});vm.runInContext(fs.readFileSync('public/vendor/spine-webgl.js','utf8'),context);const s=context.spine;
function fixture(){const data=new s.SkeletonJson({}).readSkeletonData({bones:[{name:'root'}],animations:{a:{bones:{root:{rotate:[{time:0,angle:10},{time:1,angle:60}]}}},b:{bones:{root:{rotate:[{time:0,angle:-60},{time:1,angle:-10}]}}},c:{bones:{root:{rotate:[{time:0,angle:150},{time:1,angle:160}]}}}}}),skeleton=new s.Skeleton(data),mix=new s.AnimationStateData(data);mix.defaultMix=.4;return {skeleton,state:new s.AnimationState(mix)};}
function step(value,delta){value.state.update(delta);value.state.apply(value.skeleton);value.skeleton.updateWorldTransform();}
test('interrupted mix chains restore the same current pose and future samples',()=>{
  const original=fixture();original.state.setAnimation(0,'a',true);step(original,.3);original.state.setAnimation(0,'b',false);step(original,.1);original.state.setAnimation(0,'c',true);step(original,.07);
  const animation=validateAnimation(JSON.parse(JSON.stringify(captureAnimation(original.state)))),pose=validatePose(JSON.parse(JSON.stringify(capturePose(original.skeleton)))),restored=fixture();
  assertCheckpoint(restored,animation,pose);restoreAnimation(restored.state,animation,s);restorePose(restored.skeleton,pose);restored.skeleton.updateWorldTransform();
  assert.equal(restored.skeleton.bones[0].rotation,original.skeleton.bones[0].rotation);assert.equal(animation.entries.length,3);
  for(let i=0;i<50;i++){step(original,1/120);step(restored,1/120);assert.ok(Math.abs(original.skeleton.bones[0].rotation-restored.skeleton.bones[0].rotation)<1e-10);}
});
test('queued animations and empty-animation fades remain functional after restore',()=>{
  const original=fixture();original.state.setAnimation(0,'a',false);original.state.addAnimation(0,'b',true,.5);step(original,.2);
  const restored=fixture();restoreAnimation(restored.state,validateAnimation(captureAnimation(original.state)),s);restorePose(restored.skeleton,validatePose(capturePose(original.skeleton)));
  for(let i=0;i<100;i++){step(original,.01);step(restored,.01);assert.equal(original.state.getCurrent(0).animation.name,restored.state.getCurrent(0).animation.name);assert.ok(Math.abs(original.skeleton.bones[0].rotation-restored.skeleton.bones[0].rotation)<1e-10);}
  original.state.setEmptyAnimation(0,.2);step(original,.05);const saved=validateAnimation(captureAnimation(original.state));assert.ok(saved.entries.some(entry=>entry.name==='<empty>'));restoreAnimation(restored.state,saved,s);restorePose(restored.skeleton,validatePose(capturePose(original.skeleton)));for(let i=0;i<30;i++){step(original,.01);step(restored,.01);assert.ok(Math.abs(original.skeleton.bones[0].rotation-restored.skeleton.bones[0].rotation)<1e-10);}
});
test('checkpoint validation rejects cyclic and inconsistent mix links',()=>{const value=fixture();value.state.setAnimation(0,'a',true);step(value,.1);const saved=captureAnimation(value.state);saved.entries[0].mixingFrom=0;saved.entries[0].mixingTo=0;assert.throws(()=>validateAnimation(saved),/Cyclic/);});
test('restoration removes omitted optional alpha left on reused track entries',()=>{
  const original=fixture();original.state.setAnimation(0,'a',true);step(original,.2);const saved=validateAnimation(captureAnimation(original.state));assert.equal(saved.entries[0].totalAlpha,undefined);
  const restored=fixture(),allocate=restored.state.trackEntry;restored.state.trackEntry=function(...args){const entry=allocate.apply(this,args);entry.totalAlpha=999;return entry;};
  restoreAnimation(restored.state,saved,s);restorePose(restored.skeleton,validatePose(capturePose(original.skeleton)));assert.deepEqual(captureAnimation(restored.state),captureAnimation(original.state));assert.equal(Object.hasOwn(restored.state.getCurrent(0),'totalAlpha'),false);
  for(let i=0;i<20;i++){step(original,.01);step(restored,.01);assert.equal(original.skeleton.bones[0].rotation,restored.skeleton.bones[0].rotation);}
  const explicit=validateAnimation(captureAnimation(original.state));explicit.entries[0].totalAlpha=0;restoreAnimation(restored.state,explicit,s);assert.equal(restored.state.getCurrent(0).totalAlpha,0);
});
test('attachment checkpoints use skin keys rather than attachment display names',()=>{
  const value=fixture(),skin=new s.Skin('default'),slotData=new s.SlotData(0,'slot',value.skeleton.data.bones[0]),attachment=new s.RegionAttachment('display-name');skin.setAttachment(0,'lookup-key',attachment);value.skeleton.data.slots.push(slotData);value.skeleton.data.defaultSkin=skin;value.skeleton.data.skins.push(skin);
  const skeleton=new s.Skeleton(value.skeleton.data);skeleton.slots[0].setAttachment(attachment);const pose=validatePose(capturePose(skeleton));assert.equal(pose.slots[0].attachment,'lookup-key');assert.equal(pose.slots[0].attachmentSkin,'default');const clone=new s.Skeleton(value.skeleton.data);assertCheckpoint({skeleton:clone},null,pose);restorePose(clone,pose);assert.equal(clone.slots[0].getAttachment(),attachment);
});
test('checkpoint imports reject incomplete timing and forged reverse mix links',()=>{
  const value=fixture();value.state.setAnimation(0,'a',true);step(value,.1);let saved=captureAnimation(value.state);delete saved.entries[0].animationLast;assert.throws(()=>validateAnimation(saved),/animationLast/);
  value.state.setAnimation(0,'b',true);step(value,.1);saved=captureAnimation(value.state);saved.entries[0].mixingTo=1;assert.throws(()=>validateAnimation(saved),/mix relationship/);
});
