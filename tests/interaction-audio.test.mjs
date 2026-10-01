import test from 'node:test';
import assert from 'node:assert/strict';
import {interactionEffects,resolveInteractionVoice,explicitInteractionEffect} from '../src/engine/interaction-audio.js';
const state={isBig:false,state:1,cardStage:false,names:{4:'stand_down',6:'click_01_down',8:'kaoji_01',12:'rope_down',17:'game_down1'}};
test('special click sound branches retain state-dependent source names',()=>{
  assert.deepEqual(interactionEffects(6,'123',state),['12301_cm_click_01_down']);assert.deepEqual(interactionEffects(14,'123',{...state,isBig:true}),['12301_cm_click_03_down']);assert.deepEqual(interactionEffects(8,'123',state),['12301_cm_stand_down']);assert.deepEqual(interactionEffects(9,'123',{...state,state:2}),['12301_cm_door_down']);assert.deepEqual(interactionEffects(11,'123',state),['12301_cm_click_lleg']);assert.deepEqual(interactionEffects(18,'123',{...state,cardStage:true}),['12301_cm_card_click']);assert.deepEqual(interactionEffects(4,'301400901',state),[]);assert.deepEqual(interactionEffects(1,'0',state),[]);
});
test('interaction voices resolve aliases and skin target subtitles before unrelated rows',()=>{
  const library={voices:[{targetId:'other',resourceName:'Actual',alias:'Voice_123456789_Touch_Head',text:'Wrong target'},{targetId:'123456789',resourceName:'Actual',alias:'Voice_123456789_Touch_Head',text:'Skin line'}],storyVoices:[]},audio={resolve:(name,language)=>name==='Actual'&&language==='ch'?{}:null};
  assert.equal(resolveInteractionVoice({skinId:'123456789',event:2},library,audio,'ch').text,'Skin line');assert.equal(resolveInteractionVoice({skinId:'123456789',event:2},library,audio,'original'),null);
});
test('explicit paths and base-character fallback retain their own source text',()=>{
  const library={voices:[{resourceName:'Voice_1234567_Touch_Hand',text:'Base'}],storyVoices:[{resourceName:'Story',text:'Story subtitle'}]},audio={resolve:name=>['Voice_1234567_Touch_Hand','Story'].includes(name)?{}:null};
  assert.equal(resolveInteractionVoice({skinId:'123456789',event:1},library,audio,'original').text,'Base');assert.equal(resolveInteractionVoice({explicit:'SoundRes/a_sound_voiceeff/Story'},library,audio,'original').text,'Story subtitle');assert.equal(resolveInteractionVoice({event:100,skinId:'123'},library,audio,'original'),null);
});
test('hotspot effect references do not replace voices or play the same effect twice',()=>{
  const library={voices:[{resourceName:'Voice_1234567_Touch_Head',text:'Head voice'}],storyVoices:[]},audio={soundInfo:name=>({name,category:'a_sound_ui',clip:{path:'effect.m4a'}}),resolve:name=>name==='Voice_1234567_Touch_Head'?{}:null};
  const request={skinId:'123456789',event:2,explicit:'click_effect'};assert.equal(resolveInteractionVoice(request,library,audio,'original').text,'Head voice');assert.equal(explicitInteractionEffect(request,audio).name,'click_effect');assert.equal(explicitInteractionEffect({...request,effects:['SoundRes/a_sound_ui/click_effect']},audio),null);
  assert.equal(resolveInteractionVoice({...request,explicit:'missing_effect'},library,{resolve:audio.resolve},'original').text,'Head voice');
});
