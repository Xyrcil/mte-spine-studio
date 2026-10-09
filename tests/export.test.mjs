import test from 'node:test';
import assert from 'node:assert/strict';
import {exportPlan,frameSources,exportCamera,clipSample,exportRenderSize} from '../src/engine/export-plan.js';
import {omittedVisualWarnings} from '../src/engine/export-source.js';
import {RenderSession} from '../src/engine/export.js';

test('export material clocks depend on the source time and requested frame, not the seek path',async()=>{
  const fixture=()=>Object.assign(Object.create(RenderSession.prototype),{time:0,pendingTime:0,materialTimeOrigin:2.11,stage:{materialTime:2.11,evaluate(delta){this.materialTime+=delta;},draw(){}},async initialize(){this.time=0;this.pendingTime=0;this.materialTimeOrigin=2.11;this.stage.materialTime=2.11;}});
  for(const target of [.3875,.575,.7625,.95,1.1375,1.325,1.5125]){
    const direct=fixture(),stepped=fixture();await direct.seek(target);
    for(let time=.2;time<target;time+=.1875)await stepped.seek(time);
    await stepped.seek(target);
    assert.equal(direct.stage.materialTime,2.11+target);assert.equal(stepped.stage.materialTime,direct.stage.materialTime);assert.equal(stepped.time,target);
    await stepped.seek(.2);assert.equal(stepped.stage.materialTime,2.11+.2);
    await stepped.seek(target);assert.equal(stepped.stage.materialTime,direct.stage.materialTime);
  }
});
const settings=()=>({format:'mp4',width:320,height:240,scale:1,fps:10,speed:1,start:0,end:1,loops:2,loopMode:'repeat',fade:.2,background:'#191b20',transparent:false,fit:'contain',crop:{x:0,y:0,width:1,height:1}});
test('export supersampling preserves output size and respects device and memory limits',()=>{
  const plan=exportPlan(settings());assert.deepEqual(exportRenderSize(plan,8192),{width:640,height:480,scale:2});assert.equal(plan.width,320);
  assert.deepEqual(exportRenderSize(plan,512),{width:320,height:240,scale:1});
  assert.equal(exportRenderSize({width:3840,height:2160},8192).scale,1);
  assert.equal(exportRenderSize({width:2048,height:2048},8192).scale,2);
  assert.throws(()=>exportRenderSize(plan,128),/rendering limit/);
});
test('source preview exports preserve the captured viewport after host layout changes',()=>{
  const camera={x:1,y:2,width:12,height:8,sourcePreview:{aspect:1.5}},plan=exportPlan(settings());
  assert.deepEqual(exportCamera(camera,2.5,plan),exportCamera({...camera,sourcePreview:undefined},1.5,plan));
});
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
test('short and fractional-rate loops retain bounded source frames across every repetition',()=>{
  for(const fps of [1,10,29.97,60,120])for(const count of [1,2,3,7,20])for(const loopMode of ['repeat','ping-pong'])for(const speed of [.25,1,2]){
    const plan=exportPlan({...settings(),format:'sequence',fps,speed,start:.75,end:.75+count/fps*speed,loops:3,loopMode});
    assert.equal(plan.segmentFrames,count);assert.equal(plan.frames,(loopMode==='repeat'?count:Math.max(1,2*count-2))*3);
    for(let index=0;index<plan.frames;index++){
      const sources=frameSources(plan,index);assert.equal(sources.length,1);assert.equal(sources[0].weight,1);assert.ok(Number.isInteger(sources[0].frame));assert.ok(sources[0].frame>=0&&sources[0].frame<count);
      assert.deepEqual(sources,frameSources(plan,index+plan.cycleFrames));
    }
  }
});
test('crossfade source weights remain normalized and bounded for all valid short overlaps',()=>{
  for(const count of [3,5,10,31])for(let fade=1;fade*2<count;fade++){
    const plan=exportPlan({...settings(),format:'sequence',fps:10,end:count/10,fade:fade/10,loops:3,loopMode:'crossfade'});
    assert.equal(plan.segmentFrames,count);assert.equal(plan.fadeFrames,fade);assert.equal(plan.cycleFrames,count-fade);
    for(let index=0;index<plan.frames;index++){
      const sources=frameSources(plan,index);assert.ok(Math.abs(sources.reduce((sum,row)=>sum+row.weight,0)-1)<1e-12);
      for(const row of sources){assert.ok(row.frame>=0&&row.frame<count);assert.ok(row.weight>=0&&row.weight<=1);}
      assert.deepEqual(sources,frameSources(plan,index+plan.cycleFrames));
    }
  }
});
test('scene and export speed compose without changing the requested source interval',()=>{
  for(const sceneSpeed of [.1,.5,1,4,10])for(const speed of [.1,.5,1,4,10]){
    const plan=exportPlan({...settings(),format:'sequence',fps:30,start:2,end:5,loops:1,speed},sceneSpeed);
    assert.equal(plan.speed,speed*sceneSpeed);assert.equal(plan.segmentFrames,Math.max(1,Math.round(90/(speed*sceneSpeed))));assert.equal(plan.start,2);assert.equal(plan.end,5);
    for(let index=0;index<plan.frames;index++){const time=plan.start+frameSources(plan,index)[0].frame/plan.fps*plan.speed;assert.ok(time>=2&&time<5);}
  }
});
test('pixel multipliers preserve crop composition for contain and cover across output aspects',()=>{
  const camera={x:7,y:-3,width:12,height:8};
  for(const [width,height] of [[320,240],[240,320],[400,100]])for(const fit of ['contain','cover'])for(const crop of [{x:0,y:0,width:1,height:1},{x:.1,y:.2,width:.4,height:.6},{x:.75,y:0,width:.25,height:.5}]){
    const base=exportCamera(camera,1.5,exportPlan({...settings(),format:'png',width,height,fit,crop}));
    for(const scale of [.25,.5,1,2,4]){
      const plan=exportPlan({...settings(),format:'png',width,height,fit,crop,scale}),result=exportCamera(camera,1.5,plan);
      assert.equal(plan.width,width*scale);assert.equal(plan.height,height*scale);assert.deepEqual(result.camera,base.camera);assert.deepEqual(result.maskCamera,base.maskCamera);
      if(fit==='cover')assert.equal(result.clip,null);else for(const key of ['x','y','width','height'])assert.ok(Math.abs(result.clip[key]-base.clip[key]*scale)<=Math.max(1,scale/2+.5));
    }
  }
});
