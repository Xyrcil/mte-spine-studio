import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {expandHotSpringPresentations,HotSpringRoot,validateHotSpringState,hotSpringAnimatorStates} from '../src/engine/hot-spring.js';
import {unityTransform,multiply,objectTransform,point} from '../src/engine/geometry.js';
function focusFixture(){
  const events=[],transform={id:'root',data:{m_LocalPosition:{x:0,y:0},m_LocalScale:{x:1,y:1}}},roleTransform={id:'role-transform',data:{m_LocalPosition:{x:100,y:200},m_LocalScale:{x:1,y:1},m_SizeDelta:{x:60,y:80},m_Pivot:{x:.25,y:.75}}},role={id:'role',focus:{position:[-56,-163],zoom:1.62},levels:[{level:1,voiceIds:['11','12']}]};
  const group={id:'object',x:3,y:4,scale:2,rotation:19,flipX:true,nodes:new Map([['root',transform],['role-transform',roleTransform],['role-go',{id:'role-go',type:'GameObject',data:{m_Name:'role'}}]]),transforms:new Map([['role-go',roleTransform]]),isActiveTransform:()=>true,presentation:{hotSpringHouse:{rootTransform:'root',roles:[role],backgroundOffset:[-10,20],defaultZoom:.5}}};
  group.world=id=>id==='root'?unityTransform(transform.data):multiply(unityTransform(transform.data),unityTransform(roleTransform.data));const root=new HotSpringRoot({dispatchEvent:event=>events.push({type:event.type,...event.detail})},group);return {root,group,events};
}
test('source UI rectangles include pivot and object transforms, not arbitrary canvas taps',()=>{
  const {root,group}=focusFixture(),matrix=multiply(objectTransform(group),group.world('role-transform')),inside=point(matrix,0,0),outside=point(matrix,100,0);
  assert.equal(root.hitAt(inside.x,inside.y).id,'role');assert.equal(root.hitAt(outside.x,outside.y),null);root.click(root.hotspots[0]);assert.equal(root.hitAt(inside.x,inside.y),null);
});
test('one-second focus, selected pool and return survive a mid-transition checkpoint',()=>{
  const {root,events}=focusFixture();root.click(root.hotspots[0]);root.advance(.5);const checkpoint=root.snapshot();assert.equal(root.value.phase,'focusing');assert.ok(Math.abs(root.pose().x-(-44.5))<1e-9);
  root.advance(.5);const final=root.snapshot();assert.equal(final.phase,'dialogue');assert.ok(['11','12'].includes(final.voiceId));assert.equal(events.filter(event=>event.type==='voice-request').length,1);
  root.restore(checkpoint);root.advance(.5);assert.deepEqual(root.snapshot(),final);root.click(root.hotspots.find(hit=>hit.id==='continue'));assert.equal(root.value.phase,'returning');root.advance(1);assert.equal(root.value.phase,'idle');assert.deepEqual(root.pose(),root.defaults());assert.ok(events.some(event=>event.type==='voice-stop-request'));
});
test('hot spring state validation rejects foreign roles, voices and invalid levels',()=>{
  const {root}=focusFixture(),saved=root.snapshot();assert.deepEqual(validateHotSpringState(saved),saved);
  assert.throws(()=>root.restore({...saved,phase:'focusing'}),/role/);assert.throws(()=>root.restore({...saved,roleId:'other'}),/role/);assert.throws(()=>root.restore({...saved,roleId:'role',voiceId:'other'}),/voice/);assert.throws(()=>validateHotSpringState({...saved,levels:{role:0}}),/level/);assert.throws(()=>validateHotSpringState({...saved,random:0}),/random/);
});

test('source decoration variants and early Continue behavior replay without interrupting speech',()=>{
  const {root,events}=focusFixture();root.house.dialogueAnimations=[{name:'ani_love_1',clip:'clip',duration:1.0833333730697632}];root.click(root.hotspots[0]);root.advance(1);
  assert.deepEqual(root.value.dialogueAnimation,{name:'ani_love_1',start:1,duration:1.0833333730697632});const saved=root.snapshot(),continueHit=root.hotspots.find(hit=>hit.id==='continue');
  assert.equal(root.click(continueHit).animation,'advance-dialogue-pending');assert.equal(root.value.phase,'dialogue');assert.equal(root.value.voiceId,'');assert.equal(events.filter(event=>event.type==='voice-stop-request').length,0);
  root.advance(1.1);assert.equal(root.click(continueHit).animation,'next-conversation');assert.equal(events.filter(event=>event.type==='voice-request').length,2);assert.equal(root.value.phase,'dialogue');const final=root.snapshot();root.restore(saved);root.click(continueHit);root.advance(1.1);root.click(continueHit);assert.deepEqual(root.snapshot(),final);
  root.click(root.hotspots.find(hit=>hit.id==='close'));assert.equal(root.value.phase,'returning');assert.equal(root.value.dialogueAnimation,null);assert.throws(()=>root.restore({...saved,dialogueAnimation:{...saved.dialogueAnimation,duration:99}}),/animation/);
});
test('displayed dialogue survives early Continue and restores its source ID and elapsed time independently',()=>{
  const {root,group}=focusFixture();root.roles[0].name='Source role';root.house.dialogueLines=[{id:'11',text:'First source line'},{id:'12',text:'Second source line'}];root.house.dialoguePanel={rootTransform:'panel-transform',typewriters:[{data:{charactersPerSecond:50}}]};group.nodes.set('panel-transform',{data:{m_GameObject:{m_PathID:'panel-go'}}});group.nodes.set('panel-go',{data:{m_IsActive:false}});
  root.house.dialogueAnimations=[{name:'ani_love_1',clip:'clip',duration:1}];
  root.click(root.hotspots[0]);root.advance(1.2);
  const shown=root.dialogueDisplay(),saved=root.snapshot();assert.ok(shown.text);assert.equal(shown.name,'Source role');assert.equal(shown.charactersPerSecond,50);assert.ok(Math.abs(shown.elapsed-.2)<1e-9);
  root.click(root.hotspots.find(hit=>hit.id==='continue'));assert.equal(root.value.voiceId,'');assert.equal(root.value.dialogueText.voiceId,shown.voiceId);assert.deepEqual(root.dialogueDisplay(),shown);
  root.advance(.4);root.restore(saved);assert.deepEqual(root.dialogueDisplay(),shown);
  assert.equal(JSON.stringify(root.snapshot()),JSON.stringify(saved));
  const bad={...saved,dialogueText:{voiceId:'foreign',start:1}};assert.throws(()=>root.check(bad),/displayed dialogue/);assert.throws(()=>root.restore(bad),/displayed dialogue/);assert.deepEqual(root.snapshot(),saved);
  root.click(root.hotspots.find(hit=>hit.id==='close'));assert.equal(root.value.dialogueText,null);
});
test('hidden hot spring objects retain their dialogue clock and visible-character checkpoint',()=>{
  const {root,group}=focusFixture();root.click(root.hotspots[0]);root.advance(1);const saved=root.snapshot();group.visible=false;root.advance(2);assert.deepEqual(root.snapshot(),saved);group.visible=true;root.advance(.1);assert.ok(root.value.clock>saved.clock);
});

test('every original hot spring line and default role name joins its own configured house',t=>{
  if(!fs.existsSync('public/assets/library.json')){t.skip('Local resources are not installed');return;}
  const library=JSON.parse(fs.readFileSync('public/assets/library.json')),presentations=JSON.parse(fs.readFileSync('public/assets/presentations.json')).presentations,houses=expandHotSpringPresentations(presentations,library.hotSpringHouses,library.hotSpringRoles,library.voices,library.characters).filter(row=>row.hotSpringHouse),all=new Set();
  for(const house of houses){const ids=new Set(house.hotSpringHouse.roles.flatMap(role=>role.levels.flatMap(pool=>pool.voiceIds)));assert.equal(house.hotSpringHouse.dialogueLines.length,ids.size);assert.ok(house.hotSpringHouse.roles.every(role=>role.name));for(const line of house.hotSpringHouse.dialogueLines){assert.ok(ids.has(line.id));assert.ok(line.text);all.add(line.id);}}
  assert.equal(all.size,52);
});

test('fractional focus ticks cannot create an animation checkpoint in the future',()=>{
  const {root}=focusFixture();root.house.dialogueAnimations=[{name:'ani_love_1',clip:'clip',duration:1}];root.click(root.hotspots[0]);for(let i=0;i<120;i++)root.advance(1/120);const saved=root.snapshot();assert.equal(saved.phase,'dialogue');assert.ok(saved.dialogueAnimation.start<=saved.clock);assert.deepEqual(root.check(saved),saved);root.restore(saved);
});

test('every source decoration variant can be selected and late focus samples retain the true start',()=>{
  for(const level of [1,2,3,4,5]){const {root}=focusFixture(),count=level===3?2:level>=4?3:1;root.roles[0].levels=[{level,voiceIds:['11']}];root.value.levels.role=level;root.house.dialogueAnimations=Array.from({length:count},(_,i)=>({name:`ani_love_${level}${count>1?'_'+(i+1):''}`,clip:String(i),duration:1}));const seen=new Set();for(let seed=1;seed<=1000;seed++){root.reset();root.value.levels.role=level;root.value.random=seed;root.click(root.hotspots[0]);root.advance(1.3);assert.equal(root.value.dialogueAnimation.start,1);seen.add(root.value.dialogueAnimation.name);}assert.equal(seen.size,count);}
});

test('source Animator state names bind referenced clips rather than similarly named files',()=>{
  const state={m_NameID:1,m_BlendTreeConstantIndexArray:[0],m_BlendTreeConstantArray:[{data:{m_NodeArray:[{data:{m_ClipID:0,m_ChildIndices:[]}}]}}],m_TransitionConstantArray:[],m_WriteDefaultValues:true,m_Speed:2,m_Loop:false};
  const machine={m_AnyStateTransitionConstantArray:[],m_StateConstantArray:[{data:state}]};
  const controller={id:'controller',type:'AnimatorController',data:{m_TOS:[[1,'ani_love_1']],m_AnimationClips:[{m_FileID:0,m_PathID:'actual-clip'}],m_Controller:{m_LayerArray:[{data:{m_StateMachineIndex:0}}],m_StateMachineArray:[{data:machine}]}}};
  const clip={id:'actual-clip',type:'AnimationClip',data:{m_Name:'different-clip-name',packedCurves:{start:0,stop:2}}},presentation={visualAnimations:[controller,clip]},source={data:{m_Controller:{m_FileID:0,m_PathID:'controller'}}},before=structuredClone(presentation);
  assert.deepEqual(hotSpringAnimatorStates(presentation,source),[{name:'ani_love_1',clip:'actual-clip',speed:2,loop:false,duration:1}]);assert.deepEqual(presentation,before);
  state.m_TransitionConstantArray=[{data:{m_DestinationState:0}}];assert.throws(()=>hotSpringAnimatorStates(presentation,source),/unsupported/);state.m_TransitionConstantArray=[];controller.data.m_AnimationClips[0].m_PathID='missing';assert.throws(()=>hotSpringAnimatorStates(presentation,source),/unavailable/);
});

test('all original love states reference direct nontransitioning clips with source default resets',t=>{
  if(!fs.existsSync('public/assets/presentations.json')){t.skip('Local interface resources are not installed');return;}
  const presentations=JSON.parse(fs.readFileSync('public/assets/presentations.json')).presentations,library=JSON.parse(fs.readFileSync('public/assets/library.json')),houses=expandHotSpringPresentations(presentations,library.hotSpringHouses,library.hotSpringRoles).filter(row=>row.hotSpringHouse),ui=presentations.find(row=>row.id==='UI/Prefab/Onsen');
  if(!ui){t.skip('Local interface resources are not installed');return;}
  for(const house of houses){assert.equal(house.hotSpringHouse.decorationError,undefined);const states=house.hotSpringHouse.decoration.states;assert.equal(states.length,10);for(const state of states){assert.equal(state.speed,1);assert.equal(state.loop,false);assert.equal(ui.visualAnimations.find(row=>row.id===state.clip).data.m_Name,state.name);}}
});
test('hot spring houses select their own hierarchy without mutating the source bundle',()=>{
  const go=(id,name,active=true)=>({id,type:'GameObject',data:{m_Name:name,m_IsActive:active}}),tf=(id,go,children=[])=>({id,type:'RectTransform',data:{m_GameObject:{m_PathID:go},m_Children:children.map(m_PathID=>({m_PathID}))}});
  const source={id:'onsen',path:'assets',hierarchy:[go('a','1'),tf('ta','a',['tr']),go('r','role',false),tf('tr','r'),go('b','2'),tf('tb','b')],instances:[{id:'role',transform:'tr'},{id:'other',transform:'tb'}],hotspots:[],controllers:[],images:[{transform:'ta'},{transform:'tb'}]},before=structuredClone(source);
  const rows=expandHotSpringPresentations([source],[{id:'1',bundle:'onsen',roleIds:['role']},{id:'missing',bundle:'onsen',roleIds:[]}]);
  assert.equal(rows.length,2);assert.equal(rows[1].resourceBundle,'onsen');assert.deepEqual(rows[1].instances,[source.instances[0]]);assert.equal(rows[1].images.length,1);
  assert.equal(rows[1].hierarchy.find(node=>node.id==='r').data.m_IsActive,true);assert.deepEqual(source,before);
});
test('real hot spring tables produce three isolated houses with their declared roles',()=>{
  if(!fs.existsSync('public/assets/library.json'))return;
  const library=JSON.parse(fs.readFileSync('public/assets/library.json')),source=JSON.parse(fs.readFileSync('public/assets/presentations.json')).presentations;
  if(!library.hotSpringHouses)return;
  const rows=expandHotSpringPresentations(source,library.hotSpringHouses).filter(row=>row.hotSpringHouse);assert.equal(rows.length,3);
  for(const row of rows){assert.ok(row.instances.length);const names=row.hierarchy.filter(node=>node.type==='GameObject').map(node=>node.data.m_Name);assert.ok(row.hotSpringHouse.roleIds.every(id=>names.includes(id)));assert.ok(library.hotSpringHouses.filter(house=>house.id!==row.hotSpringHouse.id).every(house=>!names.includes(house.id)));}
});
