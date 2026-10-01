import test from 'node:test';
import assert from 'node:assert/strict';
import {exportPlan} from '../src/engine/export-plan.js';
import {sceneAudioSources,mixExportSample} from '../src/engine/export-audio.js';
const plan=(options={})=>exportPlan({format:'webm',width:100,height:100,fps:10,speed:1,start:1,end:3,loops:2,loopMode:'repeat',fade:.2,fit:'contain',background:'#000000',crop:{x:0,y:0,width:1,height:1},...options});
const track=(options={})=>({scene:true,channels:[Float32Array.from({length:1000},(_,i)=>i/1000)],sampleRate:100,position:2,repeat:false,gain:1,...options});
test('ambient sampling follows captured position, interval, speed and repeat',()=>{
  const p=plan();assert.ok(Math.abs(mixExportSample(p,.35,[track()])[0]-.335)<1e-6);assert.deepEqual(mixExportSample(p,.35,[track()]),mixExportSample(p,2.35,[track()]));
  const fast=plan({speed:2});assert.ok(Math.abs(mixExportSample(fast,.35,[track()])[0]-.37)<1e-6);
});
test('ping-pong audio reverses with the scene and crossfade mixes both ends',()=>{
  const ping=plan({loopMode:'ping-pong'});assert.ok(sceneAudioSources(ping,2.15)[0].time<sceneAudioSources(ping,2.05)[0].time);
  const cross=plan({loopMode:'crossfade',fade:.3}),sources=sceneAudioSources(cross,1.45);assert.equal(sources.length,2);assert.equal(sources.reduce((n,x)=>n+x.weight,0),1);
  const expected=sources.reduce((sum,x)=>sum+(2+x.time)/10*x.weight,0);assert.ok(Math.abs(mixExportSample(cross,1.45,[track()])[0]-expected)<1e-6);
});
test('one-shot exhaustion, looping and summed audio use valid PCM bounds',()=>{
  const p=plan();assert.deepEqual(mixExportSample(p,.4,[track({position:20})]),[0,0]);assert.ok(mixExportSample(p,.4,[track({position:20,repeat:true})])[0]>.1);
  const constant=track({channels:[new Float32Array(1000).fill(.8)]});assert.deepEqual(mixExportSample(p,.5,[constant,constant]),[1,1]);
  const voice={scene:false,channels:[new Float32Array(1000).fill(.2)],sampleRate:100,options:{offset:1,gain:.5}};
  assert.deepEqual(mixExportSample(p,.5,[voice]),[0,0]);assert.ok(Math.abs(mixExportSample(p,1.5,[voice])[0]-.1)<1e-6);
});
