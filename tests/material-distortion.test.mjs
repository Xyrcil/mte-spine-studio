import test from 'node:test';
import assert from 'node:assert/strict';
import {distortionSettings,distortionPhases,sampleDistortedTexel,hasMaterialDistortion,textureMipLevels} from '../src/engine/material-distortion.js';
import {Stage} from '../src/engine/stage.js';
import {DistortionRenderer} from '../src/engine/distortion-renderer.js';

const transform={m_Scale:{x:1,y:1},m_Offset:{x:0,y:0}};
const texture=path=>({path,width:64,height:64,settings:{m_FilterMode:1,m_WrapU:0,m_WrapV:0}});
function material(){return {shader:'Spine/Skeleton',keywords:['_FLOW_MAP_ON','_NOISE_TEX_ON','_STRAIGHT_ALPHA_INPUT'],properties:{m_TexEnvs:['_MainTex','_NoiseTex','_MaskTex'].map(name=>[name,structuredClone(transform)]),m_Floats:[['_FlowSpeed',1],['_FlowPower',.2],['_NoiseDistortPower',-.1],['_DistortIntensityX',.1],['_DistortIntensityY',.2]]},textures:{_FlowMap:texture('flow.png'),_NoiseTex:texture('noise.png'),_MaskTex:{default:'white'}}};}
const near=(actual,expected)=>{assert.equal(actual.length,expected.length);actual.forEach((value,index)=>assert.ok(Math.abs(value-expected[index])<1e-9,`${actual} != ${expected}`));};
test('source mip metadata requires ordered complete original levels and rejects inferred replacements',()=>{
  const value={...texture('base.png'),width:4,height:2,mipCount:3,mips:[{level:1,width:2,height:1,path:'one.png'},{level:2,width:1,height:1,path:'two.png'}]};assert.deepEqual(textureMipLevels(value),value.mips);assert.deepEqual(textureMipLevels(texture('legacy.png')),[]);
  for(const changed of [{...value,mips:value.mips.slice(1)},{...value,mips:[{...value.mips[0],width:3},value.mips[1]]},{...value,width:5},{...value,mipCount:2,mips:value.mips.slice(0,1)}])assert.throws(()=>textureMipLevels(changed),/mip/);
});
test('anisotropic filtering follows source strength and exposes unavailable device precision',()=>{
  const renderer=Object.create(DistortionRenderer.prototype),calls=[];Object.assign(renderer,{gl:{TEXTURE_2D:1,texParameterf:(...args)=>calls.push(args)},anisotropy:{TEXTURE_MAX_ANISOTROPY_EXT:2},maxAnisotropy:4});renderer.configureAnisotropy({m_Aniso:2});renderer.configureAnisotropy({m_Aniso:0});renderer.configureAnisotropy({m_Aniso:8});assert.deepEqual(calls,[[1,2,2],[1,2,1],[1,2,4]]);
  const source=material();source.textures._NoiseTex.settings.m_Aniso=8;assert.match(renderer.samplerLimitations(source)[0],/8x requested, 4x available/);renderer.anisotropy=null;renderer.maxAnisotropy=1;renderer.configureAnisotropy({m_Aniso:8});assert.equal(calls.length,3);assert.match(renderer.samplerLimitations(source)[0],/1x available/);
  source.textures._NoiseTex.settings.m_Aniso=-1;assert.throws(()=>distortionSettings(source),/anisotropic/);source.textures._NoiseTex.settings.m_Aniso=2;source.textures._NoiseTex.settings.m_MipBias=1;assert.throws(()=>distortionSettings(source),/mip bias/);
});

test('distortion settings follow source keywords and retain signed strengths without mutating metadata',()=>{
  const source=material(),before=JSON.stringify(source),settings=distortionSettings(source);assert.equal(settings.noisePower,-.1);assert.equal(settings.flowPower,.2);assert.equal(settings.whiteMask,true);assert.equal(JSON.stringify(source),before);
  assert.equal(distortionSettings({...source,keywords:[]}),null);assert.throws(()=>distortionSettings({...source,shader:'Unknown'}),/shader/);delete source.textures._NoiseTex;assert.throws(()=>distortionSettings(source),/_NoiseTex/);source.textures._NoiseTex=texture('noise.png');source.properties.m_Floats[0][1]=Infinity;assert.throws(()=>distortionSettings(source),/flow speed/);
  assert.equal(hasMaterialDistortion({materialBindings:{pages:[{materials:{normal:source}}]}}),true);assert.equal(hasMaterialDistortion({}),false);assert.equal(hasMaterialDistortion(),false);
});
test('distortion samplers reject unsupported modes and non-power-of-two repeat textures',()=>{
  const source=material();delete source.textures._FlowMap.settings;assert.throws(()=>distortionSettings(source),/sampler/);source.textures._FlowMap=texture('flow.png');source.textures._FlowMap.settings.m_WrapU=2;assert.throws(()=>distortionSettings(source),/sampler/);source.textures._FlowMap.settings.m_WrapU=0;source.textures._FlowMap.width=65;assert.throws(()=>distortionSettings(source),/repeat texture/);
});
test('flow phases are staggered half a period and noise retains signed remainder with Unity time components',()=>{
  const settings=distortionSettings(material());near(distortionPhases(settings,5).flow,[.5,0,0]);near(distortionPhases(settings,10).flow,[0,.5,1]);near(distortionPhases(settings,5).noise,[-.025,0,-.5,-.5]);assert.throws(()=>distortionPhases(settings,-1),/non-negative/);assert.throws(()=>distortionPhases(settings,NaN),/time/);
});
test('flow samples in original Unity coordinates and converts displaced artwork back to PNG coordinates',()=>{
  const settings=distortionSettings({...material(),keywords:['_FLOW_MAP_ON','_STRAIGHT_ALPHA_INPUT']}),calls=[];
  const output=sampleDistortedTexel(settings,[.4,.3],2.5,(name,uv)=>{calls.push({name,uv});return name==='_FlowMap'?[1,.25,0,1]:[...uv,0,1];});
  near(calls[0].uv,[.4,.3]);near(calls[1].uv,[.35,.275]);near(calls[2].uv,[.25,.225]);near(output,[.3,.25,0,1]);
});
test('noise samples both time offsets, applies the authored mask channels and preserves artwork transforms',()=>{
  const source=material();source.keywords=['_NOISE_TEX_ON','_STRAIGHT_ALPHA_INPUT'];source.textures._MaskTex=texture('mask.png');source.properties.m_TexEnvs[0][1]={m_Scale:{x:2,y:3},m_Offset:{x:.1,y:.2}};const settings=distortionSettings(source),calls=[];
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
test('premultiplied texture variants are explicit rather than treated as straight-alpha images',()=>{
  const source=material();source.keywords=source.keywords.filter(keyword=>keyword!=='_STRAIGHT_ALPHA_INPUT');assert.throws(()=>distortionSettings(source),/premultiplied texture/);
});
