import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {switchLayerSkin} from '../src/engine/artwork-variant.js';
import {captureAnimation,capturePose} from '../src/engine/animation-state.js';
const context=vm.createContext({console,Float32Array,Int16Array,Uint16Array,Uint8Array,ArrayBuffer,Math});vm.runInContext(fs.readFileSync('public/vendor/spine-webgl.js','utf8'),context);const s=context.spine;
function fixture(){
  const data=new s.SkeletonJson({}).readSkeletonData({bones:[{name:'root'}],events:{sound:{}},animations:{idle:{bones:{root:{rotate:[{time:0,angle:10},{time:1,angle:60}]}},events:[{time:.1,name:'sound'}]}}}),slot=new s.SlotData(0,'slot',data.bones[0]);slot.attachmentName='part';data.slots.push(slot);
  for(const name of ['default','hexie']){const skin=new s.Skin(name);skin.setAttachment(0,'part',new s.RegionAttachment(name+'-part'));data.skins.push(skin);if(name==='default')data.defaultSkin=skin;}
  const skeleton=new s.Skeleton(data),state=new s.AnimationState(new s.AnimationStateData(data));state.setAnimation(0,'idle',true);state.update(.2);state.apply(skeleton);return {skeleton,state};
}
test('switching real runtime skins changes attachments without time advancement or duplicate events',()=>{
  const layer=fixture(),track=layer.state.getCurrent(0),time=track.trackTime,events=[];layer.state.addListener({event:(_track,event)=>events.push(event.data.name)});switchLayerSkin(layer,'hexie');assert.equal(layer.skeleton.skin.name,'hexie');assert.equal(layer.skeleton.slots[0].getAttachment().name,'hexie-part');assert.equal(track.trackTime,time);assert.equal(events.length,0);assert.equal(layer.state.queue.objects.length,0);
  layer.state.update(.01);layer.state.apply(layer.skeleton);assert.equal(events.length,0);switchLayerSkin(layer,null);assert.equal(layer.skeleton.skin,null);assert.equal(layer.skeleton.slots[0].getAttachment().name,'default-part');
});
test('variant validation is atomic and preserves previously queued notifications',()=>{
  const layer=fixture(),attachment=layer.skeleton.slots[0].getAttachment();assert.throws(()=>switchLayerSkin(layer,'missing'),/unavailable/);assert.equal(layer.skeleton.slots[0].getAttachment(),attachment);assert.throws(()=>switchLayerSkin(layer,42),/Invalid/);
  layer.state.queue.drainDisabled=true;layer.state.setAnimation(1,'idle',true);const pending=[...layer.state.queue.objects];switchLayerSkin(layer,'hexie');assert.deepEqual([...layer.state.queue.objects],pending);assert.equal(layer.state.queue.drainDisabled,true);
});
test('changing an unapplied track does not consume its first-frame sound event',()=>{
  const layer=fixture(),events=[];layer.state.addListener({event:(_track,event)=>events.push(event.data.name)});layer.state.setAnimation(0,'idle',true);layer.state.update(.2);const track=layer.state.getCurrent(0),last=track.nextAnimationLast;switchLayerSkin(layer,'hexie');assert.equal(events.length,0);assert.equal(track.nextAnimationLast,last);layer.state.apply(layer.skeleton);assert.deepEqual(events,['sound']);
});
test('selecting the current variant leaves playback and attachments untouched',()=>{const layer=fixture();switchLayerSkin(layer,'hexie');const before={animation:captureAnimation(layer.state),pose:capturePose(layer.skeleton)};switchLayerSkin(layer,'hexie');assert.deepEqual({animation:captureAnimation(layer.state),pose:capturePose(layer.skeleton)},before);});
