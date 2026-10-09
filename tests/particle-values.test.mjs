import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compileAnimationCurve,compileMinMaxCurve,compileGradient,compileMinMaxGradient} from '../src/engine/particle-values.js';

const key=(time,value,inSlope=0,outSlope=0,extra={})=>({time,value,inSlope,outSlope,weightedMode:0,...extra});
const curve=keys=>({m_Curve:keys,m_PreInfinity:2,m_PostInfinity:2});
function gradient(mode=0){return {m_Mode:mode,m_NumColorKeys:2,m_NumAlphaKeys:3,key0:{r:3,g:0,b:0,a:0},key1:{r:0,g:1,b:2,a:1},key2:{r:0,g:0,b:0,a:0},ctime0:0,ctime1:65535,atime0:0,atime1:32768,atime2:65535};}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);

test('particle curves evaluate cubic tangents rather than linear interpolation',()=>{
  const sample=compileAnimationCurve(curve([key(0,0),key(1,1)]));near(sample(.25),.15625);near(sample(-1),0);near(sample(2),1);
  const linear=compileAnimationCurve(curve([key(0,2,1,1),key(2,4,1,1)]));near(linear(.75),2.75);
});
test('weighted particle tangents solve their time coordinate independently',()=>{
  const sample=compileAnimationCurve(curve([key(0,0,0,0,{weightedMode:2,outWeight:.1}),key(1,1,0,0,{weightedMode:1,inWeight:.7})]));near(sample(.275),.5);
  near(sample(0),0);near(sample(1),1);
});
test('infinite tangents preserve held segments and switch exactly at the next key',()=>{
  const sample=compileAnimationCurve(curve([key(0,2,0,'Infinity'),key(1,5,'Infinity',0),key(2,8,3,3)]));near(sample(.999),2);near(sample(1),5);
  assert.ok(Number.isFinite(sample(1.5)));assert.throws(()=>compileAnimationCurve(curve([key(0,0,'NaN')])),/tangent/);
});
test('MinMax curves retain reversed constant ranges and shared curve multipliers',()=>{
  near(compileMinMaxCurve({minMaxState:0,scalar:5})(.8),5);
  near(compileMinMaxCurve({minMaxState:3,scalar:10,minScalar:20})(.8,.25),17.5);
  const single=compileMinMaxCurve({minMaxState:1,scalar:4,maxCurve:curve([key(0,0),key(1,1)])});near(single(.5),2);
  const dual=compileMinMaxCurve({minMaxState:2,scalar:3,minScalar:100,minCurve:curve([key(0,2)]),maxCurve:curve([key(0,4)])});near(dual(.5,.25),7.5);
});
test('gradient color and opacity key times are sampled separately without clipping HDR',()=>{
  const sample=compileGradient(gradient());assert.deepEqual(sample(0),[3,0,0,0]);assert.deepEqual(sample(1),[0,1,2,0]);
  const result=sample(32768/65535);near(result[3],1);near(result[0],3*(1-32768/65535));
  const fixed=compileGradient(gradient(1));assert.deepEqual(fixed(.25),[0,1,2,1]);
});
test('MinMax gradients distinguish random color sampling from lifetime sampling',()=>{
  const constant=compileMinMaxGradient({minMaxState:0,maxColor:{r:2,g:1,b:0,a:.5}});assert.deepEqual(constant(.5),[2,1,0,.5]);
  const colors=compileMinMaxGradient({minMaxState:2,minColor:{r:0,g:0,b:0,a:0},maxColor:{r:2,g:1,b:0,a:1}});assert.deepEqual(colors(.5,.25),[.5,.25,0,.25]);
  const random=compileMinMaxGradient({minMaxState:4,maxGradient:gradient()}),ordinary=compileMinMaxGradient({minMaxState:1,maxGradient:gradient()});assert.deepEqual(random(.8,.25),ordinary(.25));
  const pair=compileMinMaxGradient({minMaxState:3,minGradient:gradient(),maxGradient:gradient()});assert.deepEqual(pair(.3,.7),ordinary(.3));
});
test('malformed particle values fail before simulation instead of producing invalid poses',()=>{
  assert.throws(()=>compileAnimationCurve(curve([key(1,0),key(0,1)])),/increasing/);
  assert.throws(()=>compileMinMaxCurve({minMaxState:4,scalar:1}),/mode/);
  assert.throws(()=>compileGradient({...gradient(),m_Mode:7}),/interpolation/);
  assert.throws(()=>compileGradient({...gradient(),ctime1:Infinity}),/time/);
  assert.throws(()=>compileMinMaxCurve({minMaxState:0,scalar:1})(NaN),/fraction/);
  assert.throws(()=>compileAnimationCurve(curve([key(-1e308,0),key(1e308,1)])),/finite spans/);
  const large=compileMinMaxCurve({minMaxState:3,scalar:1e308,minScalar:-1e308});near(large(0,.5),0);
});
test('all extracted particle scalar and gradient profiles produce finite repeatable samples',t=>{
  if(!fs.existsSync('public/assets/presentations.json')){t.skip('Local game resources are not installed');return;}
  const catalog=JSON.parse(fs.readFileSync('public/assets/presentations.json','utf8'));let profiles=0;
  function walk(value){
    if(!value||typeof value!=='object')return;
    if('minMaxState' in value){
      const sample='maxColor' in value?compileMinMaxGradient(value):compileMinMaxCurve(value);profiles++;
      for(const time of [0,.1,.5,.9,1])for(const random of [0,.25,.75,1]){const result=sample(time,random);assert.deepEqual(sample(time,random),result);assert.ok((Array.isArray(result)?result:[result]).every(Number.isFinite));}
    }
    for(const child of Object.values(value))walk(child);
  }
  const effects=catalog.presentations.flatMap(presentation=>presentation.effects||[]);for(const effect of effects)walk(effect.data);
  assert.equal(catalog.presentations.filter(presentation=>presentation.origin!=='original-archive').flatMap(presentation=>presentation.effects||[]).length,5);assert.ok(profiles>100);console.log(`Validated ${profiles} native particle value profiles`);
});
