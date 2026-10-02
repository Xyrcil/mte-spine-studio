import test from 'node:test';
import assert from 'node:assert/strict';
import {exportPlan,frameSources,exportCamera,clipSample} from '../src/engine/export-plan.js';
import {omittedVisualWarnings} from '../src/engine/export-source.js';
const settings=()=>({format:'mp4',width:320,height:240,scale:1,fps:10,speed:1,start:0,end:1,loops:2,loopMode:'repeat',fade:.2,background:'#191b20',transparent:false,fit:'contain',crop:{x:0,y:0,width:1,height:1}});
test('exports identify omitted active visuals without warning about hidden or disabled ones',()=>{
  const group={visible:true,isActiveTransform:id=>id!=='inactive',transforms:new Map([['go',{id:'active'}]]),effects:[{reason:'Unsupported shader',source:{transform:'active',renderer:{m_Enabled:1}}}],nativeAnimations:[{reason:'Unsupported events',source:{data:{m_PlayAutomatically:true,m_GameObject:{m_PathID:'go'}}}}]};
  assert.deepEqual(omittedVisualWarnings([group],{}),['Some source particle effects are not rendered','Some source native animation clips are not rendered']);
  assert.deepEqual(omittedVisualWarnings([{...group,visible:false}],{}),[]);group.effects[0].source.renderer.m_Enabled=0;group.nativeAnimations[0].source.data.m_PlayAutomatically=false;assert.deepEqual(omittedVisualWarnings([group],{}),[]);
});
test('hot spring decoration warnings follow conversations rather than idle previews',()=>{
  const group={id:'house',visible:true,presentation:{hotSpringHouse:{}},controllers:[{value:{kind:'hot-spring',phase:'idle'}}]},scene={sequence:{actions:[{group:'house',controller:'hot-spring',hit:'role'}]}};
  assert.deepEqual(omittedVisualWarnings([group],scene,false),[]);assert.deepEqual(omittedVisualWarnings([group],scene,true),['Original hot spring dialogue decorations are not rendered']);group.controllers[0].value.phase='dialogue';assert.deepEqual(omittedVisualWarnings([group],{},false),['Original hot spring dialogue decorations are not rendered']);
});
test('export frame timestamps cover intervals without duplicating endpoints',()=>{const plan=exportPlan(settings());assert.equal(plan.frames,20);assert.equal(plan.duration,2);assert.deepEqual(frameSources(plan,9),[{frame:9,weight:1}]);assert.deepEqual(frameSources(plan,10),[{frame:0,weight:1}]);});
test('ping-pong does not duplicate either endpoint',()=>{const plan=exportPlan({...settings(),end:.4,loops:1,loopMode:'ping-pong'});assert.deepEqual(Array.from({length:plan.frames},(_,i)=>frameSources(plan,i)[0].frame),[0,1,2,3,2,1]);});
test('crossfade overlaps the interval and weights sum to one',()=>{const plan=exportPlan({...settings(),end:1.2,loopMode:'crossfade'});assert.equal(plan.cycleFrames,10);const last=frameSources(plan,9);assert.deepEqual(last,[{frame:11,weight:0},{frame:1,weight:1}]);for(let i=0;i<plan.frames;i++)assert.equal(frameSources(plan,i).reduce((sum,row)=>sum+row.weight,0),1);});
test('crop camera preserves source viewport and applies letterbox clipping',()=>{const plan=exportPlan({...settings(),width:400,height:200,crop:{x:0,y:0,width:.5,height:1}}),bounds=exportCamera({x:0,y:0,width:10,height:10},1,plan);assert.equal(bounds.camera.x,-2.5);assert.equal(bounds.camera.width,20);assert.equal(bounds.clip.width,100);assert.equal(bounds.clip.height,200);});
test('invalid encoding dimensions, crops, transparency and time ranges are rejected',()=>{for(const change of [{width:321},{transparent:true},{crop:{x:.9,y:0,width:.5,height:1}},{end:0},{speed:NaN},{loopMode:'crossfade',fade:1}])assert.throws(()=>exportPlan({...settings(),...change}));});
test('audio samples support gain, delay, mono upmix, speed and looping',()=>{const channels=[new Float32Array(48000).fill(1)];assert.deepEqual(clipSample(channels,48000,.05,{offset:.1}),[0,0]);assert.deepEqual(clipSample(channels,48000,.5,{gain:.5}),[.5,.5]);assert.deepEqual(clipSample(channels,48000,1.5),[0,0]);assert.deepEqual(clipSample(channels,48000,1.5,{repeat:true}),[1,1]);assert.deepEqual(clipSample(channels,48000,.6,{rate:2}),[0,0]);});
