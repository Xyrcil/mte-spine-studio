import test from 'node:test';
import assert from 'node:assert/strict';
import {interactionExportProvider} from '../src/engine/interaction-export.js';

const library={voices:[{resourceName:'Voice_123456701_Touch_Head',targetId:'123456701',text:'Skin line'}],storyVoices:[]};
const audio={base:'/assets/',language:'a_sound_voiceeff',resolve(name,language){return name==='Voice_123456701_Touch_Head'?{path:`audio/${language}/head.m4a`}:null;},soundInfo(name){return name==='effect'?{name,category:'a_sound_ui',clip:{path:'effect.m4a'}}:{clip:null};}};
test('source caption-only export does not resolve or substitute audio',()=>{
  const data={...library,mainViewVoices:{captions:{shield:'Visible source words'}}},bus={resolve(){throw new Error('Audio must not be requested');},soundInfo(){throw new Error('Effects must not be requested');}},request={captionOnly:true,name:'shield',duration:3};
  assert.deepEqual(interactionExportProvider(data,bus,{})(request),{caption:{text:'Visible source words',duration:3,includeSubtitles:true},warnings:[]});
  assert.equal(interactionExportProvider(data,bus,{}, {includeSubtitles:false})(request).caption.includeSubtitles,false);
});
test('source interaction export preserves original audio and captions when a newer row reuses its ID',()=>{
  const source={id:'reused',resourceName:'original',text:'Original line'},data={voices:[{id:'reused',resourceName:'replacement',text:'Replacement line'}],storyVoices:[],mainViewVoices:{voices:[source],favorVoices:[]}},calls=[];
  const bus={...audio,resolve(name,language,exact){calls.push({name,language,exact});return {path:exact?'original.m4a':'replacement.m4a'};}};
  const result=interactionExportProvider(data,bus,{audio:{language:'a_sound_voiceeff_ch'}})({sourceVoiceId:'reused'});
  assert.equal(result.voice.url,'/assets/original.m4a');assert.equal(result.voice.text,'Original line');
  assert.deepEqual(calls,[{name:'original',language:'a_sound_voiceeff_ch',exact:true},{name:'original',language:'a_sound_voiceeff_ch',exact:true}]);
  const missing=interactionExportProvider(data,{...bus,resolve:()=>null},{})({sourceVoiceId:'reused',voiceId:'reused'});
  assert.equal(missing.voice,null);assert.deepEqual(missing.warnings,['Source voice unavailable (a_sound_voiceeff): original']);
});
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
test('missing recorded-language tracks are reported without substituting another line',()=>{
  const missing={...audio,resolve:()=>null},provider=interactionExportProvider(library,missing,{audio:{language:'a_sound_voiceeff_ch'}}),result=provider({skinId:'123456701',event:2});
  assert.equal(result.voice,null);assert.deepEqual(result.warnings,['Voice unavailable (a_sound_voiceeff_ch): Voice_123456701_Touch_Head']);
  assert.deepEqual(interactionExportProvider(library,missing,{}, {includeAudio:false,includeSubtitles:false})({skinId:'123456701',event:2}).warnings,[]);
  assert.deepEqual(provider({skinId:'0',event:100}).warnings,[]);
});
