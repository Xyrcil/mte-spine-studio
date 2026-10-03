import test from 'node:test';
import assert from 'node:assert/strict';
import {distortionSettings,distortionPhases,sampleDistortedTexel,hasMaterialDistortion} from '../src/engine/material-distortion.js';
import {Stage} from '../src/engine/stage.js';

const transform={m_Scale:{x:1,y:1},m_Offset:{x:0,y:0}};
function material(){return {shader:'Spine/Skeleton',keywords:['_FLOW_MAP_ON','_NOISE_TEX_ON'],properties:{m_TexEnvs:['_MainTex','_NoiseTex','_MaskTex'].map(name=>[name,structuredClone(transform)]),m_Floats:[['_FlowSpeed',1],['_FlowPower',.2],['_NoiseDistortPower',-.1],['_DistortIntensityX',.1],['_DistortIntensityY',.2]]},textures:{_FlowMap:{path:'flow.png'},_NoiseTex:{path:'noise.png'},_MaskTex:{default:'white'}}};}
const near=(actual,expected)=>{assert.equal(actual.length,expected.length);actual.forEach((value,index)=>assert.ok(Math.abs(value-expected[index])<1e-9,`${actual} != ${expected}`));};

test('distortion settings follow source keywords and retain signed strengths without mutating metadata',()=>{
  const source=material(),before=JSON.stringify(source),settings=distortionSettings(source);assert.equal(settings.noisePower,-.1);assert.equal(settings.flowPower,.2);assert.equal(settings.whiteMask,true);assert.equal(JSON.stringify(source),before);
  assert.equal(distortionSettings({...source,keywords:[]}),null);assert.throws(()=>distortionSettings({...source,shader:'Unknown'}),/shader/);delete source.textures._NoiseTex;assert.throws(()=>distortionSettings(source),/_NoiseTex/);source.textures._NoiseTex={path:'noise.png'};source.properties.m_Floats[0][1]=Infinity;assert.throws(()=>distortionSettings(source),/flow speed/);
  assert.equal(hasMaterialDistortion({materialBindings:{pages:[{materials:{normal:source}}]}}),true);assert.equal(hasMaterialDistortion({}),false);assert.equal(hasMaterialDistortion(),false);
});
test('flow phases are staggered half a period and noise retains signed remainder with Unity time components',()=>{
  const settings=distortionSettings(material());near(distortionPhases(settings,5).flow,[.5,0,0]);near(distortionPhases(settings,10).flow,[0,.5,1]);near(distortionPhases(settings,5).noise,[-.025,0,-.5,-.5]);assert.throws(()=>distortionPhases(settings,-1),/non-negative/);assert.throws(()=>distortionPhases(settings,NaN),/time/);
});
test('flow samples in original Unity coordinates and converts displaced artwork back to PNG coordinates',()=>{
  const settings=distortionSettings({...material(),keywords:['_FLOW_MAP_ON']}),calls=[];
  const output=sampleDistortedTexel(settings,[.4,.3],2.5,(name,uv)=>{calls.push({name,uv});return name==='_FlowMap'?[1,.25,0,1]:[...uv,0,1];});
  near(calls[0].uv,[.4,.3]);near(calls[1].uv,[.35,.275]);near(calls[2].uv,[.25,.225]);near(output,[.3,.25,0,1]);
});
test('noise samples both time offsets, applies the authored mask channels and preserves artwork transforms',()=>{
  const source=material();source.keywords=['_NOISE_TEX_ON'];source.textures._MaskTex={path:'mask.png'};source.properties.m_TexEnvs[0][1]={m_Scale:{x:2,y:3},m_Offset:{x:.1,y:.2}};const settings=distortionSettings(source),calls=[];
  const output=sampleDistortedTexel(settings,[.4,.3],5,(name,uv)=>{calls.push({name,uv});return name==='_NoiseTex'?[.25,0,0,1]:name==='_MaskTex'?[.5,.25,0,1]:[...uv,0,1];});
  near(calls[0].uv,[.375,.3]);near(calls[1].uv,[-.1,.8]);near(calls[2].uv,[.4,.3]);near(output,[.675,-.925,0,1]);
});
test('combined noise and flow use the masked noise result before two-phase artwork sampling',()=>{
  const settings=distortionSettings(material());const calls=[];const output=sampleDistortedTexel(settings,[.4,.3],2.5,(name,uv)=>{calls.push({name,uv});return name==='_NoiseTex'?[.25,0,0,1]:name==='_FlowMap'?[1,.25,0,1]:[...uv,0,1];});
  assert.deepEqual(calls.map(row=>row.name),['_NoiseTex','_NoiseTex','_FlowMap','_MainTex','_MainTex']);near(output,[.35,.15,0,1]);
});
test('material clock advances once per simulation substep and paused redraws cannot advance it',()=>{
  const stage=Object.create(Stage.prototype);Object.assign(stage,{groups:[],materialTime:.125,dispatchEvent(){},sequencePlayer:{advance(delta,step){for(let i=0;i<4;i++)step(delta/4);}}});stage.evaluate(.5);assert.equal(stage.materialTime,.625);stage.evaluate(0);assert.equal(stage.materialTime,.625);stage.evaluate(.5);assert.equal(stage.materialTime,1.125);
});
