import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AudioBus} from '../src/engine/audio.js';
test('voice aliases resolve to actual resources without crossing language tracks',()=>{
  const previous=globalThis.Audio;
  globalThis.Audio=class extends EventTarget {};
  try {
    const bus=new AudioBus({entries:[
      {name:'Voice_Base_Notification',category:'a_sound_voiceeff',errors:[],clips:[{path:'original.m4a'}]},
      {name:'Voice_Base_Notification',category:'a_sound_voiceeff_ch',errors:[],clips:[{path:'chinese.m4a'}]},
      {name:'Broken',category:'a_sound_voiceeff',errors:['decode failed'],clips:[]},
    ]},[{name:'Voice_Costume_Notification',resource:'SoundRes/Voice_Base_Notification'}],'/assets/');
    assert.equal(bus.resolve('Voice_Costume_Notification','a_sound_voiceeff').path,'original.m4a');
    assert.equal(bus.resolve('Voice_Costume_Notification','a_sound_voiceeff_ch').path,'chinese.m4a');
    assert.equal(bus.resolve('SoundRes/a_sound_voiceeff/Voice_Costume_Notification','a_sound_voiceeff').path,'original.m4a');
    assert.equal(bus.resolve('a_sound_voiceeff/Voice_Base_Notification','a_sound_voiceeff_ch').path,'chinese.m4a');
    assert.equal(bus.resolve('Voice_Costume_Notification','missing-track'),null);
    assert.equal(bus.resolve('Broken'),null);
  }finally{globalThis.Audio=previous;}
});
