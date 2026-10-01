import test from 'node:test';
import assert from 'node:assert/strict';
import {InteractionRecorder,InteractionPlayer,validateSequence,retimeSequenceAction,removeSequenceAction,previewSequenceAt} from '../src/engine/interaction-sequence.js';
import {validateScene} from '../src/engine/scene.js';
import {exportScene} from '../src/engine/export-source.js';

const initial={schema:1,name:'Test',background:'#000000',camera:{x:0,y:0,width:10,height:10},speed:1,paused:false,objects:[{id:'actor',kind:'spine',name:'Actor',bundle:'test',x:0,y:0,scale:1,rotation:0,opacity:1,layers:[],interactions:[]}]};
// Use the same source-backed state validator as saved scenes.
import {InteractionRoot} from '../src/engine/interaction.js';
const source={id:'root',gameObject:'0',data:{}};
const group={transforms:new Map(),layers:[],nodes:new Map(),presentation:{hotspots:[]},isActiveTransform:()=>true};
initial.objects[0].interactions=[{id:'root',state:new InteractionRoot(new EventTarget(),group,source).snapshot()}];
const action=(at,hit='hit')=>({at,group:'actor',controller:'root',hit,animation:'click'});
const sequence=()=>({schema:1,initial,duration:1,actions:[action(0),action(.35),action(1)]});
class FakeStage extends EventTarget {snapshot(){return structuredClone(initial);}triggerInteraction(...args){this.calls.push(args);return {accepted:true,animation:'click'};}calls=[];}

test('sequence validates scene references, ordering and bounded times',()=>{
  const original=sequence(),checked=validateSequence(original);original.initial.name='Changed';assert.equal(checked.initial.name,'Test');
  for(const update of [{duration:Infinity},{duration:.5},{actions:[action(.5),action(.1)]},{actions:[{...action(0),controller:'missing'}]},{actions:[{...action(0),at:-1}]}])assert.throws(()=>validateSequence({...sequence(),...update}));
});
test('click-time editing keeps stable simultaneous ordering, extends duration and does not mutate its source',()=>{
  const original=sequence(),before=structuredClone(original),edited=retimeSequenceAction(original,0,.35);assert.deepEqual(edited.actions.map(row=>row.at),[.35,.35,1]);assert.deepEqual(original,before);
  const extended=retimeSequenceAction(original,1,2);assert.equal(extended.duration,2);assert.deepEqual(extended.actions.map(row=>row.at),[0,1,2]);assert.equal(removeSequenceAction(original,1).actions.length,2);assert.throws(()=>retimeSequenceAction(original,4,1),/unavailable/);assert.throws(()=>retimeSequenceAction(original,0,-1),/time/);assert.throws(()=>removeSequenceAction(original,-1),/unavailable/);
});
test('silent preview rebuilds exact action times from the initial scene and does not emit playback-end notifications',async()=>{
  const stage=new FakeStage();let elapsed=0,ended=0,restored;stage.addEventListener('sequence-ended',()=>ended++);stage.evaluateFrame=delta=>{elapsed+=delta;};stage.draw=()=>{};
  const seek=target=>previewSequenceAt(stage,sequence(),target,{restore:async scene=>{restored=scene;elapsed=0;stage.calls=[];}});
  await seek(.6);assert.equal(restored.paused,true);assert.equal(stage.paused,true);assert.equal(stage.sequenceBusy,false);assert.equal(stage.calls.length,2);assert.ok(Math.abs(elapsed-.6)<1e-10);
  await seek(0);assert.equal(stage.calls.length,1);await seek(1);assert.equal(stage.calls.length,3);assert.equal(ended,0);
});
test('preview cancellation and divergent actions release the editing lock',async()=>{
  const stage=new FakeStage(),controller=new AbortController();stage.evaluateFrame=()=>{};stage.draw=()=>{};
  await assert.rejects(previewSequenceAt(stage,sequence(),.6,{restore:async()=>{},signal:controller.signal,onProgress:()=>controller.abort()}),error=>error.name==='AbortError');assert.equal(stage.sequenceBusy,false);
  stage.triggerInteraction=()=>({accepted:false,reason:'Locked'});await assert.rejects(previewSequenceAt(stage,sequence(),0,{restore:async()=>{}}),/Locked/);assert.equal(stage.sequenceBusy,false);
});
test('legacy sequence previews silence current sound without adding settings to the recorded initial scene',async()=>{
  const stage=new FakeStage();stage.captureAudio=()=>({schema:1,voiceVolume:1,effectVolume:.8,ambientVolume:.5,muted:false,ambientEnabled:true,language:'a_sound_voiceeff',ambientTracks:[],effectTracks:[],voiceTrack:null});stage.evaluateFrame=()=>{};stage.draw=()=>{};let restored;
  await previewSequenceAt(stage,sequence(),0,{restore:async scene=>{restored=scene;}});assert.equal(restored.audio.muted,true);assert.equal(restored.audio.ambientEnabled,false);assert.equal(stage.sequence.initial.audio,undefined);
});
test('recording uses simulation time, ignores rejected and replayed interactions',()=>{
  const stage=new FakeStage(),recorder=new InteractionRecorder(stage);recorder.start();
  stage.dispatchEvent(new CustomEvent('interaction-invoked',{detail:action(0)}));
  stage.dispatchEvent(new CustomEvent('simulation-step',{detail:{delta:.25}}));
  stage.dispatchEvent(new CustomEvent('interaction-invoked',{detail:action(0,'second')}));
  const result=recorder.stop();assert.deepEqual(result.actions.map(row=>row.at),[0,.25]);assert.equal(result.duration,.25);
  stage.dispatchEvent(new CustomEvent('simulation-step',{detail:{delta:9}}));assert.equal(recorder.stop().duration,.25);recorder.dispose();
});
test('playback splits at exact action times and does not duplicate time-zero or final actions',()=>{
  const stage=new FakeStage(),player=new InteractionPlayer(stage,sequence());let elapsed=0;const times=[];
  stage.triggerInteraction=(...args)=>{times.push(elapsed);stage.calls.push(args);return {accepted:true,animation:'click'};};
  const evaluate=delta=>{assert.ok(delta<=1/120+1e-10);elapsed+=delta;};
  player.advance(0,evaluate);player.advance(.6,evaluate);player.advance(.4,evaluate);player.advance(0,evaluate);
  assert.equal(stage.calls.length,3);for(const [index,target] of [0,.35,1].entries())assert.ok(Math.abs(times[index]-target)<1e-10);assert.equal(player.finished,true);
});
test('divergent playback fails explicitly rather than skipping an interaction',()=>{
  const stage=new FakeStage(),player=new InteractionPlayer(stage,sequence());stage.triggerInteraction=()=>({accepted:false,reason:'Locked'});
  assert.throws(()=>player.advance(0,()=>{}),/Locked/);assert.equal(player.cursor,0);
});
test('frame-sized streaming and one-shot replay use identical canonical simulation steps',()=>{
  const value={schema:1,initial,duration:3,actions:[action(3)]},wholeStage=new FakeStage(),streamStage=new FakeStage(),whole=new InteractionPlayer(wholeStage,value),stream=new InteractionPlayer(streamStage,value),wholeSteps=[],streamSteps=[];
  whole.advance(3,delta=>wholeSteps.push(delta));for(let i=0;i<360;i++)stream.advance(1/120,delta=>streamSteps.push(delta));stream.advance(0,delta=>streamSteps.push(delta));
  assert.deepEqual(streamSteps.filter(delta=>delta>0),wholeSteps);assert.equal(wholeSteps.length,360);assert.ok(wholeSteps.every(delta=>delta===1/120));assert.equal(streamStage.calls.length,wholeStage.calls.length);assert.equal(streamStage.calls.length,1);assert.equal(stream.finished,true);
});
test('rendering loss closes recording without advancing through interruption',()=>{
  const stage=new FakeStage(),recorder=new InteractionRecorder(stage);recorder.start();stage.dispatchEvent(new CustomEvent('rendering-lost'));assert.equal(recorder.active,false);assert.equal(recorder.stop().duration,0);recorder.dispose();
});
test('saved scenes retain isolated sequences and reject recursive checkpoints',()=>{
  const sequenceValue=sequence(),scene=validateScene({...initial,sequence:sequenceValue});assert.deepEqual(scene.sequence,validateSequence(sequenceValue));
  assert.throws(()=>validateScene({...initial,sequence:{...sequenceValue,initial:{...initial,sequence:sequenceValue}}}),/Nested/);
  const stage=new FakeStage();stage.snapshot=()=>scene;const recorder=new InteractionRecorder(stage);recorder.start();assert.equal(recorder.stop().initial.sequence,undefined);recorder.dispose();
});
test('sequence export selects recorded speed and objects without mutating the edited scene',()=>{
  const original={...initial,speed:2,objects:[],sequence:sequence()},selected=exportScene(original,true);
  assert.equal(selected.speed,1);assert.equal(selected.objects.length,1);assert.equal(original.objects.length,0);
  assert.equal(exportScene(original).speed,2);assert.throws(()=>exportScene(initial,true),/interaction sequence/);
});
test('export replay advances the remainder beyond the final sequence timestamp',()=>{
  const stage=new FakeStage(),player=new InteractionPlayer(stage,sequence(),{continueAfterEnd:true});let elapsed=0;
  player.advance(1.1,delta=>elapsed+=delta);assert.ok(Math.abs(elapsed-1.1)<1e-10);assert.equal(player.finished,true);assert.equal(stage.calls.length,3);
  player.advance(.1,delta=>elapsed+=delta);assert.ok(Math.abs(elapsed-1.2)<1e-10);assert.equal(stage.sequenceTime,undefined);
});
