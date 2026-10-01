import test from 'node:test';
import assert from 'node:assert/strict';
import {interactionExportProvider} from '../src/engine/interaction-export.js';

const library={voices:[{resourceName:'Voice_123456701_Touch_Head',targetId:'123456701',text:'Skin line'}],storyVoices:[]};
const audio={base:'/assets/',language:'a_sound_voiceeff',resolve(name,language){return name==='Voice_123456701_Touch_Head'?{path:`audio/${language}/head.m4a`}:null;},soundInfo(name){return name==='effect'?{name,category:'a_sound_ui',clip:{path:'effect.m4a'}}:{clip:null};}};
test('interaction export uses the recorded language and skin subtitle, not live audio settings',()=>{
  const provider=interactionExportProvider(library,audio,{audio:{language:'a_sound_voiceeff_ch'}}),result=provider({skinId:'123456701',event:2});
  assert.equal(result.voice.url,'/assets/audio/a_sound_voiceeff_ch/head.m4a');assert.equal(result.voice.text,'Skin line');assert.equal(result.voice.includeAudio,true);
});
test('caption-only interaction export retains speech references and separates explicit effects',()=>{
  const provider=interactionExportProvider(library,audio,{}, {includeAudio:false,includeSubtitles:true}),result=provider({skinId:'123456701',event:2,explicit:'effect',effects:[]});
  assert.equal(result.voice.includeAudio,false);assert.equal(result.voice.includeSubtitles,true);assert.deepEqual(result.effect,{name:'effect',category:'a_sound_ui'});
  assert.equal(provider({skinId:'123456701',event:2,explicit:'effect',effects:['effect']}).effect,null);
});
test('unknown voice routes stay absent and disabling speech does not create placeholder voices',()=>{
  assert.equal(interactionExportProvider(library,audio,{})({skinId:'0',event:100}).voice,null);
  assert.equal(interactionExportProvider(library,audio,{}, {includeAudio:false,includeSubtitles:false})({skinId:'123456701',event:2}).voice,null);
});
