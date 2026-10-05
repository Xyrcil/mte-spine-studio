import test from 'node:test';
import assert from 'node:assert/strict';
import {StoryCgRoot,validateStoryCgState,isStoryCg} from '../src/engine/story-cg.js';

function fixture(wq=false){
  const calls=[],names=['start','stand','liliya','liliya2','shake','shake2','animation'];
  const layer=(id,active=true,renderType='SkeletonAnimation')=>({active,instance:{id,name:id,transform:id,renderType,timeScale:.8},skeleton:{data:{findAnimation:name=>names.includes(name)?{name}:null}},state:{setAnimation:(track,name,loop)=>calls.push({id,track,name,loop})}});
  const group={presentation:{id:`Spines/storyCG/${wq?'WQ_1_NF':'0_2_SSZZ'}/asset`},layers:[layer('a'),layer('b'),layer('hidden',false),layer('graphic',true,'SkeletonGraphic')],isActiveTransform:()=>true};
  return {group,calls,root:new StoryCgRoot({},group)};
}
test('source CG startup selects active SkeletonAnimation components without changing source speed',()=>{
  const {group,calls,root}=fixture();assert.deepEqual(calls.map(c=>[c.id,c.name,c.loop]),[['a','start',false],['b','start',false]]);assert.equal(root.layers.length,3);assert.equal(group.layers[0].storyTimeScale,undefined);assert.equal(group.layers[0].instance.timeScale,.8);assert.equal(root.hitAt(0,0),null);assert.ok(root.hotspots.every(hit=>hit.colliders.length===0));
  assert.equal(isStoryCg(group.presentation),true);assert.equal(isStoryCg({id:'Spines/story/anjie'}),false);
});
test('source event strings control layer-local speed and detach after entrance-to-idle',()=>{
  const {group,calls,root}=fixture(),[a,b]=group.layers,track={animation:{name:'start'}};
  root.onEvent(a,track,{data:{name:'slow'},stringValue:''});assert.equal(a.storyTimeScale,undefined);
  root.onEvent(a,track,{stringValue:'slow'});assert.equal(a.storyTimeScale,Math.fround(.7));assert.equal(b.storyTimeScale,undefined);
  const saved=root.snapshot();root.onEvent(a,track,{stringValue:'recover'});assert.equal(a.storyTimeScale,1);root.restore(saved);assert.equal(a.storyTimeScale,Math.fround(.7));
  root.onEvent(a,track,{stringValue:'stand'});assert.deepEqual(calls.at(-1),{id:'a',track:0,name:'stand',loop:true});const count=calls.length;
  root.onEvent(a,track,{stringValue:'recover'});root.onEvent(a,track,{stringValue:'stand'});assert.equal(calls.length,count);assert.equal(a.storyTimeScale,Math.fround(.7));
  assert.equal(a.instance.timeScale,.8);assert.deepEqual(root.snapshot().layers[0].listeners,[]);
});
test('explicit source commands coordinate active layers and retain independent callbacks in snapshots',()=>{
  const {group,calls,root}=fixture();assert.deepEqual(root.click({id:'nextState'}),{accepted:true,animation:'liliya'});assert.deepEqual(calls.slice(-2).map(c=>c.name),['liliya','liliya']);const saved=root.snapshot();
  root.onEvent(group.layers[0],{animation:{name:'liliya'}},{stringValue:'liliya2'});assert.equal(calls.at(-1).name,'liliya2');assert.deepEqual(root.snapshot().layers[1].listeners,['start','liliya']);root.restore(saved);assert.deepEqual(root.snapshot(),saved);
  assert.equal(root.click({id:'shake'}).accepted,true);root.onEvent(group.layers[0],{animation:{name:'shake'}},{stringValue:'shake2'});assert.equal(calls.at(-1).name,'shake2');assert.equal(root.click({id:'invented'}).accepted,false);
});
test('WQ source path loops animation without registering default event behavior',()=>{
  const {group,calls,root}=fixture(true);assert.ok(calls.every(c=>c.name==='animation'&&c.loop));root.onEvent(group.layers[0],{animation:{name:'animation'}},{stringValue:'slow'});assert.equal(group.layers[0].storyTimeScale,undefined);assert.ok(root.snapshot().layers.every(row=>row.listeners.length===0));
});
test('story snapshots reject malformed, duplicate and foreign layer states',()=>{
  const {root}=fixture(),saved=root.snapshot();assert.deepEqual(validateStoryCgState(saved),saved);assert.throws(()=>validateStoryCgState({...saved,layers:[saved.layers[0],saved.layers[0]]}),/Invalid/);assert.throws(()=>root.check({...saved,layers:saved.layers.map((row,index)=>index?row:{...row,id:'foreign'})}),/does not match/);assert.throws(()=>validateStoryCgState({...saved,layers:[{...saved.layers[0],speed:2}]}),/Invalid/);assert.throws(()=>validateStoryCgState({...saved,layers:[{...saved.layers[0],listeners:['missing']}]}),/Invalid/);
});
