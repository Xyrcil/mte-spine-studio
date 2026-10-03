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
  assert.equal(colliderContains({type:'BoxCollider2D',data:{m_Enabled:false,m_Size:{x:2,y:4}}},0,0),false);
  const points=[{x:0,y:0},{x:2,y:0},{x:0,y:2}];assert.equal(polygonContains(points,1,0),true);assert.equal(polygonContains(points,1.5,1.5),false);
  const matrix=objectTransform({x:4,y:5,scale:2,rotation:37,flipX:true}),world=point(matrix,3,2),local=inversePoint(matrix,world.x,world.y);assert.ok(Math.abs(local.x-3)<1e-10&&Math.abs(local.y-2)<1e-10);
});
test('controller event source follows hierarchy rather than render sorting',()=>{const {root}=fixture();assert.equal(root.primary.instance.id,'front');});
test('missing variants expose their source state change for recording without playing audio or animation',()=>{
  for(const event of [5,102]){
    const {root,events}=fixture();for(const layer of root.layers)layer.skeleton.data.findAnimation=name=>name==='overlay'?{name,duration:2}:null;
    assert.equal(root.click({event,track:1,animation:'overlay'}).accepted,true);root.unlocked();
    const saved=root.snapshot(),count=events.length;assert.equal(saved.variants.overlay,true);
    assert.deepEqual(root.click({event,track:1,animation:'overlay'}),{accepted:false,reason:'Animation unavailable: overlay_02',unavailable:true,animation:'overlay_02'});assert.equal(root.value.variants.overlay,false);assert.equal(events.length,count+1);assert.equal(events.at(-1).unavailable,true);assert.equal(root.value.playing,false);
    assert.equal(root.click({event,track:1,animation:'overlay'}).accepted,true);
  }
});
test('disabled click receivers do not intercept active regions on the same object',()=>{
  const {root,group}=fixture();group.world=()=>[1,0,0,1,0,0];group.scale=1;group.x=0;group.y=0;const collider={type:'BoxCollider2D',data:{m_Size:{x:2,y:2}}};root.hotspots=[{id:'disabled',event:100,enabled:false,colliders:[collider]},{id:'active',event:100,enabled:1,colliders:[collider]}];assert.equal(root.hitAt(0,0).id,'active');root.hotspots[0].enabled=0;assert.equal(root.hitAt(0,0).id,'active');delete root.hotspots[0].enabled;assert.equal(root.hitAt(0,0).id,'disabled');
});
test('controller rebinding follows explicit skeleton visibility without changing its checkpoint',()=>{
  const {root,group}=fixture();root.value.clock=4;const before=root.snapshot();group.layers.find(layer=>layer.instance.id==='front').active=false;root.rebind();assert.equal(root.primary.instance.id,'body');assert.deepEqual(root.snapshot(),before);
  group.isActiveTransform=()=>false;group.layers.find(layer=>layer.instance.id==='front').active=true;root.rebind();assert.equal(root.primary.instance.id,'front');assert.deepEqual(root.layers.map(layer=>layer.instance.id),['front','body']);
});
test('dynamic bone binding includes non-click helper transforms such as drag range markers',()=>{
  const {root,group}=fixture();group.scale=1;group.x=0;group.y=0;group.world=()=>[1,0,0,1,0,0];root.source.data.openStaticLoadName=0;
  group.nodes.get('root').data.m_Children.push({m_PathID:'clickT'});group.nodes.set('clickT',{id:'clickT',data:{m_GameObject:{m_PathID:'clickGO'},m_Children:[{m_PathID:'scopeT'}]}});group.nodes.set('clickGO',{data:{m_Name:'SpineClick'}});
  group.nodes.set('scopeT',{id:'scopeT',data:{m_GameObject:{m_PathID:'scopeGO'},m_Father:{m_PathID:'clickT'},m_LocalPosition:{x:100,y:100},m_LocalScale:{x:1,y:1}}});group.nodes.set('scopeGO',{data:{m_Name:'HitArea_scope1'}});
  for(const layer of group.layers){layer.transform=[1,0,0,1,0,0];layer.skeleton.findBone=name=>name==='HitArea_scope1'?{worldX:5,worldY:7}:null;}
  root.rebind();assert.equal(root.hotspots.length,0);assert.equal(root.transformBindings.has('scopeT'),true);assert.deepEqual(point(root.matrixForTransform('scopeT'),0,0),{x:5,y:7});
});
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
test('finished card results retain overlays until the next click dismisses them',()=>{
  const {root,events}=fixture();root.value.state=3;root.value.cardStage=true;root.value.cardClickable=false;root.value.selectedCard=1;root.value.rounds=1;root.value.wins=1;
  root.play('card_B',4,false);root.play('qipao_B',3,false);root.runTask({kind:'card-result',card:1});
  assert.equal(root.value.animation,'game_win_1');assert.equal(root.primary.state.getCurrent(0).loop,false);assert.equal(root.value.rounds,0);
  root.runTask({kind:'card-return',finished:true});assert.equal(root.primary.state.getCurrent(3).animation.name,'qipao_B');assert.equal(root.primary.state.getCurrent(4).animation.name,'card_B');assert.equal(root.value.cardClickable,true);
  for(const layer of root.layers)layer.skeleton.data.findAnimation=()=>null;
  const accepted=root.click({id:'cancel',event:18,track:4,animation:'card_A',audio:'explicit_voice'});assert.equal(accepted.accepted,true);assert.equal(accepted.animation,'');assert.equal(root.value.cardStage,false);for(const layer of root.layers)for(const track of [2,3,4])assert.equal(layer.state.getCurrent(track),null);
  assert.ok(events.some(event=>event.explicit==='explicit_voice'));assert.ok(events.some(event=>event.name==='30161940201_cm_card_click'));
});
test('card loss resets scores and returns to the current clothing variant',()=>{
  const {root}=fixture();root.value.state=3;root.clothing(2);root.value.cardStage=true;root.value.cardClickable=false;root.value.selectedCard=1;root.value.rounds=2;root.value.wins=0;
  root.runTask({kind:'card-result',card:0});assert.equal(root.value.animation,'game_lose_2');assert.equal(root.value.rounds,0);assert.equal(root.value.wins,0);root.runTask({kind:'card-return',finished:true});assert.equal(root.primary.state.getCurrent(0).animation.name,'animation4_2');assert.equal(root.value.playing,false);assert.equal(root.value.cardStage,true);
});
test('paused evaluation does not execute scheduled controller actions',()=>{
  const {root}=fixture();root.value.tasks=[{kind:'card-reveal',due:0}];root.advance(0);assert.equal(root.value.tasks.length,1);assert.equal(root.value.clock,0);
});
test('approach timing follows the first matching skeleton in source hierarchy order',()=>{
  const {root}=fixture();root.value.state=1;
  for(const [index,layer] of root.layers.entries())layer.skeleton.data.findAnimation=name=>({name,duration:index===0?1.5:4});
  const result=root.click({event:8,track:2});assert.equal(result.accepted,true);assert.equal(result.animation,'stand_down1');
  assert.equal(root.value.tasks[0].due,1.5);root.advance(1.49);assert.equal(root.value.playing,true);
  root.advance(.01);assert.equal(root.value.playing,false);assert.equal(root.value.isBig,true);
  assert.ok(root.layers.every(layer=>layer.state.getCurrent(0).animation.name==='animation3_1'));
});
test('approach timing skips missing first-layer animations and retains zero-length source clips',()=>{
  const {root}=fixture();root.value.state=2;root.layers[0].skeleton.data.findAnimation=name=>name==='kaoji_01'?null:{name,duration:3};
  root.layers[1].skeleton.data.findAnimation=name=>({name,duration:0});
  assert.equal(root.click({event:8,track:1}).accepted,true);assert.equal(root.value.tasks[0].due,0);
  root.advance(.001);assert.equal(root.value.playing,false);assert.equal(root.value.names[8],'kaoji_02');
});
test('missing interaction diagnostics include unavailable initial and alternate source names',()=>{
  const {root}=fixture();root.hotspots=[{name:'first',event:100,animation:'missing'},{name:'duplicate',event:100,animation:'missing'},{name:'toggle',event:5,animation:'overlay'}];
  for(const layer of root.layers)layer.skeleton.data.findAnimation=name=>name==='missing'||name==='overlay_02'?null:{name,duration:2};
  assert.deepEqual(root.missingAnimations(),[{hit:'first',animation:'missing'},{hit:'toggle',animation:'overlay_02'}]);
});
test('missing diagnostics resolve controller defaults and current state without changing playback',()=>{
  const {root,group}=fixture();root.hotspots=[{name:'hand',event:2,animation:'click2_1'},{name:'head',event:2,animation:'animation3to2'},{name:'approach',event:8},{name:'rope',event:12},{name:'inactive',event:1,transform:'inactive'},{name:'disabled',event:3,enabled:false}];group.isActiveTransform=id=>id!=='inactive';
  for(const layer of root.layers)layer.skeleton.data.findAnimation=name=>['click_02','kaoji_04','stand_down2','rope_up','click_01','click_03'].includes(name)?null:{name,duration:2};
  const before=root.snapshot();assert.deepEqual(root.missingAnimations(),[{hit:'hand',animation:'click_02'}]);assert.deepEqual(root.snapshot(),before);assert.equal(root.click(root.hotspots[0]).reason,'Animation unavailable: click_02');
  root.value.names[8]='kaoji_04';root.value.names[12]='rope_up';assert.deepEqual(root.missingAnimations(),[{hit:'hand',animation:'click_02'},{hit:'approach',animation:'kaoji_04'}]);
  root.value.state=2;assert.deepEqual(root.missingAnimations(),[{hit:'hand',animation:'click_02'}]);root.value.state=1;root.value.names[6]='click_01_down_02';assert.deepEqual(root.animationRequest(root.hotspots[2]),{name:'stand_down2',track:0});assert.deepEqual(root.missingAnimations(),[{hit:'hand',animation:'click_02'},{hit:'approach',animation:'stand_down2'}]);
  root.value.cardStage=true;assert.deepEqual(root.missingAnimations(),[]);
});
