import test from 'node:test';
import assert from 'node:assert/strict';
import {interactionEffects,resolveInteractionVoice,explicitInteractionEffect,eventLateness} from '../src/engine/interaction-audio.js';
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
test('timeline sounds recover event timestamps across scaled tracks and loop boundaries',()=>{
  const layer={instance:{timeScale:.5},state:{timeScale:1}},track={getAnimationTime:()=>.075,timeScale:1,loop:false};assert.ok(Math.abs(eventLateness(layer,track,{time:.066})-.018)<1e-12);
  assert.ok(Math.abs(eventLateness(layer,{...track,loop:true,animationStart:0,animationEnd:2,getAnimationTime:()=>.01},{time:1.99})-.04)<1e-12);
  assert.equal(eventLateness(layer,{...track,timeScale:0},{time:.066}),0);
});
test('a configured skin line does not fall back when its selected-language track is absent',()=>{
  const skin='123456789',primary=`Voice_${skin}_Touch_Head`,base='Voice_1234567_Touch_Head';
  const library={voices:[{targetId:skin,resourceName:primary,text:'Skin line'},{targetId:'1234567',resourceName:base,text:'Base line'}],storyVoices:[]};
  const calls=[],audio={resolve:(name,language)=>{calls.push(name);return name===base||name===primary&&language==='original'?{}:null;}};
  assert.equal(resolveInteractionVoice({skinId:skin,event:2},library,audio,'ch'),null);
  assert.ok(!calls.includes(base));
  assert.equal(resolveInteractionVoice({skinId:skin,event:2},library,audio,'original').text,'Skin line');
  assert.equal(resolveInteractionVoice({skinId:skin,event:2},{...library,voices:library.voices.slice(1)},audio,'ch').text,'Base line');
});
test('a sound-table entry without an extracted voice row still prevents unrelated fallback',()=>{
  const library={voices:[{resourceName:'Voice_1234567_Touch_Hand',text:'Base'}],storyVoices:[],soundResources:[{name:'Voice_123456789_Touch_Hand',resource:'SoundRes/a_sound_voiceeff/Missing'}]};
  const audio={resolve:name=>name==='Voice_1234567_Touch_Hand'?{}:null};
  assert.equal(resolveInteractionVoice({skinId:'123456789',event:1},library,audio,'original'),null);
});
test('configured aliases retain the selected line even when only the base audio is available',()=>{
  const library={voices:[{resourceName:'ActualSkinHead',alias:'Voice_123456789_Touch_Head',text:'Skin'},{resourceName:'Voice_1234567_Touch_Head',text:'Base'}],storyVoices:[]};
  const audio={resolve:name=>name==='Voice_1234567_Touch_Head'?{}:null};
  assert.equal(resolveInteractionVoice({skinId:'123456789',event:2},library,audio,'ch'),null);
});
test('unavailable callbacks distinguish missing configured speech from unvoiced interactions',()=>{
  const library={voices:[{resourceName:'Voice_1234567_Touch_Head',text:'Base'}],storyVoices:[]},audio={resolve:()=>null},warnings=[];
  resolveInteractionVoice({skinId:'123456789',event:2},library,audio,'ch',{onUnavailable:warning=>warnings.push(warning)});
  assert.deepEqual(warnings,['Voice unavailable (ch): Voice_1234567_Touch_Head']);
  resolveInteractionVoice({skinId:'123456789',event:100},library,audio,'ch',{onUnavailable:warning=>warnings.push(warning)});assert.equal(warnings.length,1);
});
test('source conversation IDs resolve their own subtitles and selected-language tracks',()=>{
  const library={voices:[{id:'11',resourceName:'SourceConversation',text:'Source line'}],storyVoices:[]},audio={resolve:(name,language)=>name==='SourceConversation'&&language==='original'?{}:null},warnings=[];
  assert.equal(resolveInteractionVoice({voiceId:'11'},library,audio,'original').text,'Source line');assert.equal(resolveInteractionVoice({voiceId:'11'},library,audio,'ch',{onUnavailable:warning=>warnings.push(warning)}),null);assert.deepEqual(warnings,['Voice unavailable (ch): SourceConversation']);
});
