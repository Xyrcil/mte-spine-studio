import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {NativeEventTimeline} from '../src/engine/native-events.js';
const event=(time,functionName)=>({time,functionName,data:'',floatParameter:0,intParameter:0,objectReferenceParameter:{m_FileID:0,m_PathID:'0'}});
test('native events retain equal-time source ordering and fire once at loop boundaries',()=>{
  const calls=[],events=[event(0,'Start'),event(.5,'First'),event(.5,'Second'),event(1,'End')],handlers=new Map(events.map(row=>[row.functionName,value=>calls.push([value.functionName,value.occurrence])])),timeline=new NativeEventTimeline(events,1,true,handlers);timeline.advance(1);assert.deepEqual(calls,[['Start',0],['First',.5],['Second',.5],['End',1],['Start',1]]);timeline.advance(1);assert.equal(calls.length,5);timeline.advance(1.5);assert.deepEqual(calls.slice(-2),[['First',1.5],['Second',1.5]]);const copy=new NativeEventTimeline(events,1,true,handlers);copy.restore(timeline.cursor,1.5);copy.advance(1.5);assert.equal(calls.length,7);
});
test('unresolved events and unsafe parameters cannot become executable handlers',()=>{
  assert.throws(()=>new NativeEventTimeline([event(0,'constructor')],1,false,{}),/unavailable/);assert.throws(()=>new NativeEventTimeline([{...event(0,'Start'),objectReferenceParameter:{m_FileID:1,m_PathID:'42'}}],1,false,new Map([['Start',()=>{}]])),/parameters/);const timeline=new NativeEventTimeline([event(0,'Start')],1,true,new Map([['Start',()=>{}]]));assert.throws(()=>timeline.advance(10001),/range/);assert.equal(timeline.cursor,0);assert.throws(()=>timeline.restore(99,1),/checkpoint/);
});
test('source event handlers may stop the remaining events without losing their pending cursor',()=>{
  let active=true;const calls=[],events=[event(0,'Stop'),event(.5,'Later')],timeline=new NativeEventTimeline(events,1,false,new Map([['Stop',()=>{calls.push('Stop');active=false;}],['Later',()=>calls.push('Later')]]));timeline.advance(1,()=>active);assert.equal(timeline.cursor,1);assert.deepEqual(calls,['Stop']);timeline.advance(1,()=>active);assert.equal(timeline.cursor,1);
});
test('all recovered skill event parameters and timestamps run through an explicit receiver',t=>{
  if(!fs.existsSync('public/assets/presentations.json')){t.skip('Local game resources are not installed');return;}const clip=JSON.parse(fs.readFileSync('public/assets/presentations.json')).presentations.find(row=>row.id==='Spines/ui/fight').visualAnimations.find(row=>row.type==='AnimationClip'),calls=[],timeline=new NativeEventTimeline(clip.data.m_Events,1.25,false,new Map(['PlaySpine','PlayWord','End'].map(name=>[name,value=>calls.push(value)])));timeline.advance(.2);timeline.advance(.4);const cursor=timeline.cursor,copy=new NativeEventTimeline(clip.data.m_Events,1.25,false,new Map([['PlaySpine',()=>assert.fail('Duplicated entrance event')],['PlayWord',()=>assert.fail('Duplicated word event')],['End',value=>calls.push(value)]]));copy.restore(cursor,.4);copy.advance(1.25);assert.deepEqual(calls.map(row=>row.functionName),['PlaySpine','PlayWord','End']);assert.deepEqual(calls.map(row=>row.occurrence),clip.data.m_Events.map(row=>row.time));
});
