import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SkillDisplayRoot,validateSkillDisplayState} from '../src/engine/skill-receiver.js';
import {bindSkillDisplay,resolveSkillDisplay,prepareSkillArtwork} from '../src/engine/skill-display.js';

function fixture(){
  const calls=[],stage={dispatchEvent:event=>calls.push(event.type)},words={source:{id:'skill-words'},play:()=>calls.push('words'),reset:()=>calls.push('reset-words')},model={play:()=>calls.push('play-native')},group={id:'group',presentation:{skillDisplay:{receiverId:'receiver'},nativeBehaviours:[{id:'receiver',class:'FightSkillUIShow',gameObject:'owner',data:{spine:{m_FileID:0,m_PathID:'spine'}}}],visualAnimations:[{id:'animation',type:'Animation',data:{m_GameObject:{m_PathID:'owner'}}}]},layers:[{instance:{id:'spine'},skeleton:{data:{findAnimation:name=>name==='animation'}},state:{setAnimation:(...args)=>calls.push(args)}}],nativeAnimations:[{source:{id:'animation'},model}],controllers:[words]};
  return {calls,stage,group};
}
test('skill receiver binds only the original methods and restarts its independent lifecycle',()=>{
  const {calls,stage,group}=fixture(),root=new SkillDisplayRoot(stage,group);root.initialize();const handlers=group.nativeEventHandlers.get('owner');assert.deepEqual([...handlers.keys()],['PlaySpine','PlayWord','End']);assert.equal(group.nativeWrapDefaults.get('animation'),1);
  handlers.get('PlaySpine')();handlers.get('PlayWord')();handlers.get('End')();assert.deepEqual(calls,[[0,'animation',false],'words','skill-display-ended']);assert.deepEqual(root.snapshot(),{kind:'skill-display',ended:true});
  root.restore({kind:'skill-display',ended:false});assert.equal(calls.length,3);stage.suppressEvents=true;root.end();assert.equal(calls.length,3);root.play();assert.deepEqual(calls.slice(3),['reset-words','play-native']);assert.equal(root.ended,false);
});
test('skill receiver rejects missing original targets and malformed checkpoints',()=>{
  assert.throws(()=>validateSkillDisplayState({kind:'skill-display',ended:1}),/checkpoint/);assert.throws(()=>validateSkillDisplayState({kind:'other',ended:false}),/checkpoint/);
  const {stage,group}=fixture();group.presentation.nativeBehaviours[0].data.spine.m_FileID=1;assert.throws(()=>new SkillDisplayRoot(stage,group),/receiver/);group.presentation.nativeBehaviours[0].data.spine.m_FileID=0;group.layers=[];const root=new SkillDisplayRoot(stage,group);assert.throws(()=>root.initialize(),/playback/);
});
test('real skill binding keeps source curves and events unchanged and assigns all original texts',t=>{
  if(!fs.existsSync('public/assets/library.json')){t.skip('Local game resources are not installed');return;}
  const library=JSON.parse(fs.readFileSync('public/assets/library.json')),source=JSON.parse(fs.readFileSync('public/assets/presentations.json')).presentations.find(row=>row.id==='Spines/ui/fight'),before=structuredClone(source),role=library.skillDisplay.roles.find(row=>row.id==='3000001'),value=resolveSkillDisplay(library,role.id,role.skillIds[0]),bound=bindSkillDisplay(source,value,100),receiver=bound.nativeBehaviours.find(row=>row.class==='FightSkillUIShow');
  assert.deepEqual(source,before);assert.equal(bound.resourceBundle,source.id);assert.notEqual(bound.id,source.id);assert.deepEqual(bound.visualAnimations,source.visualAnimations);assert.equal(bound.skillWords.text,value.englishName);
  for(const [field,text] of [['txtSingle',value.firstCharacter],['txtName',value.remainingName]])assert.equal(bound.nativeText.find(row=>row.id===receiver.data[field].m_PathID).data.m_Text,text);
  const prepared=prepareSkillArtwork(bound);assert.equal(prepared.images.find(row=>row.id===receiver.data.imgRole.m_PathID).sprite.id,value.portrait.id);assert.throws(()=>bindSkillDisplay(source,{...value,emblem:null},100),/incomplete/);
});
