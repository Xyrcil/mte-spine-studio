import test from 'node:test';
import assert from 'node:assert/strict';
import {GallerySpeech,galleryEntryVoice,speechPreferences,defaultSpeechPreferences} from '../src/gallery-speech.js';
import {resolveInteractionVoice} from '../src/engine/interaction-audio.js';
import {MainViewSpeech} from '../src/engine/main-view-speech.js';
import {MainViewSpeechClock} from '../src/engine/main-view-speech-clock.js';
import {Stage} from '../src/engine/stage.js';

function fixture(){
  const group={id:'actor',kind:'spine',visible:true,presentation:{id:'bundle'},layers:[],controllers:[]},stage=Object.setPrototypeOf(new EventTarget(),Stage.prototype),library={appearances:[{id:'skin',kind:'skin',bundle:'bundle',characterId:'12',ownVoice:false}],voices:[{id:'login',resourceName:'Voice_12_Login',text:'Source greeting'}],mainViewVoices:{touchRules:[],captions:{touch:'Source words'},voices:[{id:'head',type:3,targetId:'12',resourceName:'touch'}]}};
  library.appearances[0].id='1201';
  Object.assign(stage,{groups:[group],paused:false,hitTest:()=>group});
  stage.mainViewSpeech=new MainViewSpeech(stage);stage.mainViewSpeechClock=new MainViewSpeechClock({onIdle:index=>stage.mainViewSpeech.idle(index)});
  const audio={language:'a_sound_voiceeff',resolve:()=>({path:'voice.m4a',duration:2}),async play(voice,language,{group}){this.currentVoice={voice,category:language,group,time:0};},async resume(){}};
  stage.mainViewSpeech.configure(library,audio);let view='gallery';const speech=new GallerySpeech({stage,library,audio,getView:()=>view});
  stage.addEventListener('voice-request',event=>{const voice=resolveInteractionVoice(event.detail,library,audio,event.detail.language);if(voice)audio.play(voice,event.detail.language,{group:event.detail.group}).then(()=>speech.playbackReady(event.detail.group,voice.resourceName)).catch(error=>error.name==='NotAllowedError'?speech.playbackBlocked():speech.onError(error.message));});
  return {speech,stage,group,audio,library,setView:value=>view=value};
}
test('entry respects the source own-voice policy and automatically arms idle speech',async()=>{
  const {speech,stage,group,library,audio}=fixture();assert.equal(galleryEntryVoice(library,group).resourceName,'Voice_12_Login');
  await speech.enter(group);assert.equal(audio.currentVoice.voice.resourceName,'Voice_12_Login');assert.equal(stage.mainViewSpeech.value.group,'actor');assert.equal(stage.mainViewSpeechClock.value.visible,true);assert.equal(stage.mainViewSpeechClock.value.wordsRemaining,2);
  assert.equal(audio.currentVoice.voice.sourceMainView,true);
  library.appearances[0].ownVoice=true;assert.equal(galleryEntryVoice(library,group).resourceName,'Voice_1201_Login');
});
test('ordinary artwork taps use source dialogue but disabled dedicated Spine targets stay disabled',async()=>{
  const {speech,stage,group,library}=fixture();await speech.enter(group,{entry:false});
  const voices=[];stage.addEventListener('voice-request',e=>voices.push(e.detail));assert.equal(speech.touchAt(1,2).accepted,true);assert.equal(voices[0].sourceVoiceId,'head');
  stage.mainViewSpeechClock.finish();library.mainViewVoices.touchRules=[{id:'1201',spineTouch:1}];assert.equal(speech.touchAt(1,2),null);
  speech.setPreference('touch',false);assert.equal(speech.touchAt(1,2),null);
});
test('idle follows scene view and local preference without changing a saved audio language',async()=>{
  const {speech,stage,group,audio,setView}=fixture();await speech.enter(group,{entry:false});const before=stage.mainViewSpeechClock.snapshot();setView('studio');speech.sync();assert.equal(stage.suspendMainViewSpeech,true);assert.deepEqual(stage.mainViewSpeechClock.snapshot(),before);
  setView('gallery');audio.language='a_sound_voiceeff_ch';speech.sync();assert.equal(stage.suspendMainViewSpeech,false);assert.equal(stage.mainViewSpeechClock.value.idleRemaining,120);assert.equal(stage.mainViewSpeech.value.language,'a_sound_voiceeff_ch');speech.setPreference('idle',false);assert.equal(stage.mainViewSpeechClock.value.visible,false);
  assert.deepEqual(speechPreferences({entry:false,touch:'false'}),{...defaultSpeechPreferences,entry:false});
});
test('autoplay rejection is recoverable and does not silently enable idle behind its prompt',async()=>{
  const {speech,stage,group,audio}=fixture();let blocked=0;speech.onBlocked=()=>blocked++;audio.play=async()=>{throw new DOMException('Blocked','NotAllowedError');};
  await speech.enter(group);await Promise.resolve();assert.equal(blocked,1);assert.equal(speech.blocked,true);speech.sync();assert.equal(stage.mainViewSpeechClock.value.visible,false);assert.equal(stage.suspendMainViewSpeech,true);
  await speech.unlock();assert.equal(speech.blocked,false);assert.equal(stage.mainViewSpeechClock.value.visible,true);
});
test('station arrivals and accepted drawing actions use their source main-view speaker',async()=>{
  const {speech,stage,group,library,audio}=fixture();group.appearanceId='station';group.presentation={id:'station',stationDrawing:{id:'draw'}};
  library.appearances.push({id:'station',kind:'story',stationDrawingId:'draw'});library.stationDrawings={drawings:[{id:'draw',peopleId:'12',skinId:'',voiceIds:[]}]};
  assert.equal(speech.eligible(group),true);await speech.enter(group);assert.equal(audio.currentVoice.voice.resourceName,'Voice_12_Login');
  stage.mainViewSpeechClock.finish();stage.interact=()=>({accepted:true,animation:'smile',group:group.id,controller:'station',hit:'station-touch'});
  assert.equal(speech.interactAt(0,0).animation,'smile');assert.equal(audio.currentVoice.voice.resourceName,'touch');
});
test('entry and explicit birthday previews honor Chinese caption-only rules without inventing audio',()=>{
  const {speech,stage,group,library,audio}=fixture(),captions=[];audio.language='a_sound_voiceeff_ch';audio.resolve=()=>null;
  library.mainViewVoices.chineseCaptions={players:[12],duration:3};library.mainViewVoices.captions.Voice_12_Login='Greeting';library.mainViewVoices.captions.Voice_12_Birthday='Birthday';
  stage.addEventListener('source-caption-request',event=>captions.push(event.detail));
  assert.equal(speech.enter(group).accepted,true);assert.equal(audio.currentVoice,undefined);assert.equal(captions[0].text,'Greeting');
  speech.setPreference('birthday',true);assert.equal(speech.enter(group).accepted,true);assert.equal(captions[1].text,'Birthday');assert.equal(stage.mainViewSpeechClock.shieldTimers[0].remaining,3);
});
test('automatic preferences do not override manual speech stop or a recorded player clock',async()=>{
  const {speech,stage,group}=fixture();await speech.enter(group,{entry:false});stage.triggerMainViewSpeech(group.id,'stop');speech.sync();assert.equal(stage.mainViewSpeechClock.value.visible,false);
  stage.triggerMainViewSpeech(group.id,'start');stage.mainViewSpeechClock.hide();stage.sequenceBusy=true;speech.sync();assert.equal(stage.mainViewSpeechClock.value.visible,false);
});
