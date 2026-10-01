import test from 'node:test';
import assert from 'node:assert/strict';
import {InteractionRoot,validateInteraction} from '../src/engine/interaction.js';
import {colliderContains,polygonContains,point,inversePoint,objectTransform} from '../src/engine/geometry.js';
function fixture(){
  const events=[],stage={dispatchEvent:event=>events.push(event.detail)},nodes=new Map([['root',{data:{m_Children:[{m_PathID:'front'},{m_PathID:'body'}]}}],['front',{data:{}}],['body',{data:{}}]]);
  const layer=id=>({instance:{id,transform:id},skeleton:{findBone:()=>null,data:{findAnimation:name=>({name,duration:2})}},state:{tracks:[],getCurrent(index){return this.tracks[index];},setAnimation(index,name,loop){const entry={animation:{name,duration:2},loop,trackTime:0};this.tracks[index]=entry;return entry;},clearTrack(index){this.tracks[index]=null;}}});
  const group={id:'group',nodes,transforms:new Map([['root-go',{id:'root'}]]),layers:[layer('body'),layer('front')],isActiveTransform:()=>true,presentation:{hotspots:[]}};
  const root=new InteractionRoot(stage,group,{id:'controller',gameObject:'root-go',data:{skin_id:301619402}});return {root,group,events};
}
test('box and polygon colliders retain offsets and include polygon edges',()=>{
  assert.equal(colliderContains({type:'BoxCollider2D',data:{m_Size:{x:2,y:4},m_Offset:{x:3,y:1}}},3,1),true);
  assert.equal(colliderContains({type:'BoxCollider2D',data:{m_Enabled:0,m_Size:{x:2,y:4}}},0,0),false);
  const points=[{x:0,y:0},{x:2,y:0},{x:0,y:2}];assert.equal(polygonContains(points,1,0),true);assert.equal(polygonContains(points,1.5,1.5),false);
  const matrix=objectTransform({x:4,y:5,scale:2,rotation:37,flipX:true}),world=point(matrix,3,2),local=inversePoint(matrix,world.x,world.y);assert.ok(Math.abs(local.x-3)<1e-10&&Math.abs(local.y-2)<1e-10);
});
test('controller event source follows hierarchy rather than render sorting',()=>{const {root}=fixture();assert.equal(root.primary.instance.id,'front');});
test('stage changes coordinate skeletons, lock clicks, and use exact event target',()=>{
  const {root,group}=fixture(),hit={id:'hit',event:100,track:0,animation:'transition'};
  assert.equal(root.click(hit).accepted,true);assert.ok(group.layers.every(layer=>layer.state.getCurrent(0).animation.name==='transition'));
  assert.equal(root.click(hit).accepted,false);
  root.onEvent(root.primary,root.primary.state.getCurrent(0),{data:{name:'changeto_animation_1dati'}});
  assert.equal(root.value.playing,false);assert.ok(group.layers.every(layer=>layer.state.getCurrent(0).animation.name==='animation_1dati'));
});
test('nonautomatic interaction alternates variants without clearing its overlay',()=>{
  const {root}=fixture(),hit={event:5,track:3,animation:'shoes'};
  root.click(hit);root.onEvent(root.primary,root.primary.state.getCurrent(3),{data:{name:'end'}});
  assert.equal(root.primary.state.getCurrent(3).animation.name,'shoes');root.click(hit);assert.equal(root.primary.state.getCurrent(3).animation.name,'shoes_02');
});
test('foot transitions change idle and ordinary click variants',()=>{
  const {root}=fixture();root.click({event:4,track:0,animation:''});root.onEvent(root.primary,root.primary.state.getCurrent(0),{data:{name:'end'}});
  assert.equal(root.primary.state.getCurrent(0).animation.name,'animation2');assert.equal(root.value.names[1],'click_01_2');
  root.click({event:4,track:0,animation:''});root.onEvent(root.primary,root.primary.state.getCurrent(0),{data:{name:'end'}});assert.equal(root.value.names[1],'click_01');
});
test('sound timeline events work in idle but only from the controller primary',()=>{
  const {root,group,events}=fixture();root.onEvent(group.layers[0],{}, {data:{name:'sound_ignored'}});assert.equal(events.length,0);
  root.onEvent(root.primary,{}, {data:{name:'sound_301619402_caidan_Rshoes02'}});assert.equal(events[0].name,'301619402_caidan_Rshoes_02');
});
test('saved controller state preserves scheduled actions and rejects invalid task data',()=>{
  const {root}=fixture();root.value.tasks=[{kind:'card-result',due:3,card:1}];assert.deepEqual(validateInteraction(root.snapshot()),root.snapshot());
  const bad=root.snapshot();bad.tasks[0].card=4;assert.throws(()=>validateInteraction(bad),/card result/);
});
test('a missing source variant does not trap subsequent clicks on that variant',()=>{
  const {root}=fixture();for(const layer of root.layers)layer.skeleton.data.findAnimation=name=>name==='robot_02'?null:{name,duration:2};
  const hit={event:5,track:1,animation:'robot'};
  root.click(hit);root.onEvent(root.primary,root.primary.state.getCurrent(1),{data:{name:'end'}});
  assert.equal(root.click(hit).accepted,false);assert.equal(root.value.playing,false);
  assert.equal(root.click(hit).accepted,true);assert.equal(root.value.animation,'robot');
});
test('card sequence pauses input, advances scheduled stages and restores interaction',()=>{
  const {root}=fixture();root.value.state=3;
  root.click({event:18,track:4,animation:''});root.onEvent(root.primary,root.primary.state.getCurrent(4),{data:{name:'card'}});
  assert.equal(root.value.cardClickable,false);assert.equal(root.click({event:19,track:4,animation:''}).accepted,false);
  const saved=root.snapshot();assert.equal(validateInteraction(saved).tasks[0].kind,'card-reveal');
  root.advance(2);assert.match(root.value.animation,/^qipao_[ABC]$/);assert.equal(root.value.track,3);
  root.advance(2);assert.match(root.value.animation,/^exp_(win|lose)$/);assert.equal(root.value.rounds,1);
  root.advance(2);assert.equal(root.value.cardClickable,true);assert.equal(root.value.playing,false);assert.equal(root.primary.state.getCurrent(0).animation.name,'animation4_1');
});
test('paused evaluation does not execute scheduled controller actions',()=>{
  const {root}=fixture();root.value.tasks=[{kind:'card-reveal',due:0}];root.advance(0);assert.equal(root.value.tasks.length,1);assert.equal(root.value.clock,0);
});
test('missing interaction diagnostics include unavailable initial and alternate source names',()=>{
  const {root}=fixture();root.hotspots=[{name:'first',event:100,animation:'missing'},{name:'duplicate',event:100,animation:'missing'},{name:'toggle',event:5,animation:'overlay'}];
  for(const layer of root.layers)layer.skeleton.data.findAnimation=name=>name==='missing'||name==='overlay_02'?null:{name,duration:2};
  assert.deepEqual(root.missingAnimations(),[{hit:'first',animation:'missing'},{hit:'toggle',animation:'overlay_02'}]);
});
