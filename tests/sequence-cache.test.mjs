import test from 'node:test';
import assert from 'node:assert/strict';
import {capturedSoundUrls} from '../src/engine/sequence-cache.js';

test('recorded audio resources use captured categories and include muted or pending speech',()=>{
  const calls=[],audio={resolve(name,category){calls.push([name,category]);return name==='missing'?null:{path:`audio/${category}/${name}.m4a`};}},snapshot={muted:true,voiceTrack:{name:'voice',category:'a_sound_voiceeff_ch'},effectTracks:[{name:'click',category:'a_sound_ui'},{name:'missing',category:'a_sound_ui'}],ambientTracks:[{name:'ambient',category:'a_sound_ui',enabled:true},{name:'unused',category:'a_sound_bgm',enabled:false}]};
  const warnings=new Set(),urls=capturedSoundUrls(snapshot,audio,'https://example.test/studio/',warnings);assert.deepEqual(urls,['https://example.test/studio/assets/audio/a_sound_voiceeff_ch/voice.m4a','https://example.test/studio/assets/audio/a_sound_ui/click.m4a','https://example.test/studio/assets/audio/a_sound_ui/ambient.m4a']);assert.ok(!calls.some(([name])=>name==='unused'));assert.deepEqual([...warnings],['Recorded sound unavailable: missing']);
  assert.deepEqual(capturedSoundUrls(undefined,audio,'https://example.test/'),[]);
});
