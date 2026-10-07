import test from 'node:test';
import assert from 'node:assert/strict';
import {Stage} from '../src/engine/stage.js';
import {MainViewSpeech,validateMainViewSpeech} from '../src/engine/main-view-speech.js';
import {MainViewSpeechClock} from '../src/engine/main-view-speech-clock.js';
import {InteractionRecorder,InteractionPlayer,validateSequence} from '../src/engine/interaction-sequence.js';
import {validateScene} from '../src/engine/scene.js';

function setup(){
  const stage=Object.setPrototypeOf(new EventTarget(),Stage.prototype),group={id:'actor',kind:'image',appearanceId:'12',name:'Actor',x:0,y:0,scale:1,rotation:0,opacity:1,flipX:false,flipY:false,visible:true,locked:false,width:1,height:1,src:'data:image/png;base64,AA==',layers:[],controllers:[]};
  Object.assign(stage,{groups:[group],camera:{x:0,y:0,width:10,height:10},background:'#191b20',speed:1,paused:false,materialTime:0});
  stage.mainViewSpeech=new MainViewSpeech(stage);stage.mainViewSpeechClock=new MainViewSpeechClock({onHideWords:late=>stage.mainViewSpeech.hideWords(late),onIdle:(index,late)=>stage.mainViewSpeech.idle(index,late)});
  const library={appearances:[{id:'12',characterId:'2',ownVoice:false,bundle:'painting'}],voices:[],storyVoices:[],mainViewVoices:{touchRules:[],captions:{touch:'Visible caption'},voices:[{id:'1',type:3,targetId:'2',resourceName:'touch',exactResource:true},{id:'2',type:3,targetId:'2',resourceName:'touch_chest',exactResource:true}]}};
  stage.mainViewSpeech.configure(library,{resolve:name=>({path:name+'.m4a',duration:2.25})});return {stage,group,library};
}
test('source speech gates clicks, hides words without stopping audio and schedules idle in game time',()=>{
  const {stage}=setup(),voices=[],hides=[],stops=[];stage.addEventListener('voice-request',event=>voices.push(event.detail));stage.addEventListener('voice-caption-hide-request',event=>hides.push(event.detail));stage.addEventListener('voice-stop-request',event=>stops.push(event.detail));
  assert.equal(stage.triggerMainViewSpeech('actor','touch',{language:'a_sound_voiceeff_ch',localized:true}).animation,'touch');
  assert.equal(voices[0].sourceVoiceId,'1');assert.equal(voices[0].language,'a_sound_voiceeff_ch');assert.equal(voices[0].sourceCaption,true);
  assert.equal(stage.triggerMainViewSpeech('actor','touch').accepted,false);stage.evaluateFrame(2.5);assert.equal(hides.length,1);assert.equal(hides[0].lateness,.25);assert.equal(stops.length,0);assert.equal(stage.mainViewSpeechClock.value.canClick,true);assert.equal(stage.mainViewSpeechClock.value.idleRemaining,119.75);
  stage.evaluateFrame(120);assert.equal(voices.length,2);assert.match(voices[1].sourceResource,/Voice_2_Greetings_Idel_0[12]/);assert.equal(voices[1].lateness,.25);assert.equal(stage.mainViewSpeechClock.value.wordsRemaining,2);
});
test('station pools filter source entries before falling back and localization does not filter favor lines',()=>{
  const {stage,library,group}=setup();group.appearanceId='station';library.appearances.push({id:'station',stationDrawingId:'draw'});library.stationDrawings={drawings:[{id:'draw',gospelId:'2',skinId:'',peopleId:'',voiceIds:['missing','2']}]};
  stage.mainViewSpeech.value.localized=true;assert.deepEqual(stage.mainViewSpeech.pool(group).map(row=>row.id),['1']);
  library.stationDrawings.drawings[0].gospelId='12';library.mainViewVoices.hotSpringProfiles=[{id:'12',tiers:[['favor_chest']]}];library.mainViewVoices.favorVoices=[{id:'favor:line',resourceName:'favor_chest'}];assert.deepEqual(stage.mainViewSpeech.pool(group).map(row=>row.id),['favor:line']);group.hotSpringFavorLevel=0;assert.deepEqual(stage.mainViewSpeech.pool(group),[]);
});
test('source Spine touch rules disable only the main-view UI button, not portrait or station commands',()=>{
  const {stage,group,library}=setup();group.kind='spine';group.presentation={id:'painting',appearanceId:'12'};library.mainViewVoices.touchRules=[{id:'12',spineTouch:1}];assert.equal(stage.mainViewSpeech.touchAllowed(group),false);assert.equal(stage.triggerMainViewSpeech('actor','touch').accepted,false);
  group.kind='image';assert.equal(stage.mainViewSpeech.touchAllowed(group),true);group.kind='spine';group.appearanceId='station';library.appearances.push({id:'station',stationDrawingId:'draw'});library.stationDrawings={drawings:[{id:'draw',gospelId:'2',voiceIds:[]}]};assert.equal(stage.mainViewSpeech.touchAllowed(group),true);
});
test('speech state and independent timers round-trip without embedding source words',()=>{
  const {stage}=setup();stage.triggerMainViewSpeech('actor','touch');stage.evaluateFrame(.5);const saved=validateScene(stage.snapshot());assert.equal(saved.mainViewSpeech.group,'actor');assert.equal(saved.mainViewSpeechClock.wordsRemaining,1.75);assert.equal(JSON.stringify(saved).includes('Visible caption'),false);
  stage.mainViewSpeechClock.advance(200);stage.mainViewSpeech.restore(saved.mainViewSpeech);stage.mainViewSpeechClock.restore(saved.mainViewSpeechClock);assert.deepEqual(stage.snapshot(),saved);
  assert.throws(()=>validateScene({...saved,mainViewSpeech:{...saved.mainViewSpeech,group:'other'}}),/speaker/);assert.throws(()=>validateMainViewSpeech({...saved.mainViewSpeech,random:0}),/speech state/);
});
test('recorded speech commands reproduce source choices and idle timers for portraits',()=>{
  const {stage}=setup(),recorder=new InteractionRecorder(stage);recorder.start();stage.triggerMainViewSpeech('actor','start');stage.evaluate(1);stage.triggerMainViewSpeech('actor','touch',{localized:true});stage.evaluate(3);const recorded=recorder.stop(),expected=stage.mainViewSpeech.snapshot(),clock=stage.mainViewSpeechClock.snapshot();recorder.dispose();
  assert.deepEqual(recorded.actions.map(row=>row.type),['main-view-speech','main-view-speech']);assert.equal(recorded.actions[1].language,'a_sound_voiceeff');
  stage.mainViewSpeech.reset();stage.mainViewSpeechClock.reset();const player=new InteractionPlayer(stage,recorded,{notifyEnd:false});player.advance(recorded.duration,delta=>stage.evaluateFrame(delta));assert.deepEqual(stage.mainViewSpeech.snapshot(),expected);assert.ok(Math.abs(stage.mainViewSpeechClock.value.idleRemaining-clock.idleRemaining)<1e-8);
  assert.throws(()=>validateSequence({...recorded,actions:[{...recorded.actions[0],group:'absent'}]}),/main-view speech/);
});
test('missing audio is reported without inventing a duration or retrying another selected line',()=>{
  const {stage}=setup(),warnings=[];stage.mainViewSpeech.audio.resolve=()=>null;stage.addEventListener('speech-unavailable',event=>warnings.push(event.detail));assert.equal(stage.triggerMainViewSpeech('actor','touch',{localized:true}).accepted,false);assert.equal(warnings.length,1);assert.equal(stage.mainViewSpeechClock.value.wordsRemaining,null);assert.equal(stage.mainViewSpeechClock.value.canClick,true);
});
test('removing the selected speaker clears its reference while retaining the random stream',()=>{
  const {stage}=setup();stage.release=()=>{};stage.triggerMainViewSpeech('actor','touch');const random=stage.mainViewSpeech.value.random;stage.remove('actor');assert.equal(stage.mainViewSpeech.value.group,'');assert.equal(stage.mainViewSpeech.value.random,random);assert.equal(stage.mainViewSpeechClock.active,false);assert.equal(validateScene(stage.snapshot()).objects.length,0);
});
