import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioBus} from '../src/engine/audio.js';
import {validateSoundScene} from '../src/engine/sound-scene.js';
class FakeAudio extends EventTarget{
  constructor(src=''){super();this.src=src;this.currentSrc='';this.currentTime=0;this.duration=8;this.paused=true;this.ended=false;this.playCalls=0;}
  async play(){this.currentSrc=this.src;this.paused=false;this.playCalls++;this.dispatchEvent(new Event('loadedmetadata'));}
  pause(){this.paused=true;}
  removeAttribute(){this.src='';this.currentSrc='';}
  load(){this.currentTime=0;this.ended=false;}
}
const voices=[{id:'1',resourceName:'spoken',title:'Voice',text:'Original source subtitle'}];
function setup(){const bus=new AudioBus({entries:[{name:'spoken',category:'a_sound_voiceeff_ch',errors:[],clips:[{path:'spoken.m4a'}]}]},[],'/assets/',voices),group={id:'actor',visible:true};bus.syncAmbients([group],[]);return {bus,group};}
test('caption-only playback leaves prior audio running and survives its end and resume',async()=>{
  const previous=globalThis.Audio;globalThis.Audio=FakeAudio;
  try{const {bus,group}=setup();await bus.play(voices[0],'a_sound_voiceeff_ch',{group:group.id});const calls=bus.element.playCalls;bus.showSourceCaption(group.id,'Only captions');assert.equal(bus.element.paused,false);assert.equal(bus.element.playCalls,calls);
    bus.element.ended=true;bus.element.dispatchEvent(new Event('ended'));assert.equal(bus.currentSubtitle.text,'Only captions');await bus.resume();assert.equal(bus.currentSubtitle.text,'Only captions');bus.hideSourceSubtitle(group.id);assert.equal(bus.currentSubtitle,null);bus.dispose();
  }finally{globalThis.Audio=previous;}
});
test('prior audio errors do not clear independent source captions or leave failed voice state',async()=>{
  const previous=globalThis.Audio;globalThis.Audio=FakeAudio;
  try{const {bus,group}=setup();await bus.play(voices[0],'a_sound_voiceeff_ch',{group:group.id});bus.showSourceCaption('caption-owner','Independent words');bus.element.error={code:3};bus.element.dispatchEvent(new Event('error'));
    assert.equal(bus.currentVoice,null);assert.equal(bus.element.hasAttribute?.('src')??Boolean(bus.element.src),false);assert.equal(bus.currentSubtitle.text,'Independent words');await bus.resume();assert.equal(bus.currentSubtitle.text,'Independent words');bus.hideSourceSubtitle('caption-owner');assert.equal(bus.currentSubtitle,null);bus.dispose();
  }finally{globalThis.Audio=previous;}
});
test('failed media resume retains independent captions and explicit stop still clears them',async()=>{
  const previous=globalThis.Audio;globalThis.Audio=FakeAudio;
  try{const {bus,group}=setup();await bus.play(voices[0],'a_sound_voiceeff_ch',{group:group.id});bus.showSourceCaption(group.id,'Independent words');bus.pause();bus.element.play=async()=>{throw new DOMException('Decode failed','NotSupportedError');};await assert.rejects(bus.resume(),{name:'NotSupportedError'});
    assert.equal(bus.currentVoice,null);assert.equal(bus.currentSubtitle.text,'Independent words');bus.stop();assert.equal(bus.currentSubtitle,null);assert.equal(bus.externalCaption,null);bus.dispose();
  }finally{globalThis.Audio=previous;}
});
test('voice and caption visibility belong to their own objects and caption hiding notifies persistence',async()=>{
  const previous=globalThis.Audio;globalThis.Audio=FakeAudio;
  try{const {bus,group}=setup(),captionOwner={id:'caption-owner',visible:true};await bus.play(voices[0],'a_sound_voiceeff_ch',{group:group.id});bus.showSourceCaption(captionOwner.id,'Independent words');group.visible=false;bus.syncAmbients([group,captionOwner],[]);assert.equal(bus.currentVoice,null);assert.equal(bus.currentSubtitle.text,'Independent words');
    let changed=0;bus.addEventListener('voice-state',()=>changed++);captionOwner.visible=false;bus.syncAmbients([group,captionOwner],[]);assert.equal(bus.currentSubtitle,null);assert.equal(bus.externalCaption,null);assert.equal(changed,1);bus.dispose();
  }finally{globalThis.Audio=previous;}
});
test('source subtitle hiding preserves native speech and stays hidden across pause and restore',async()=>{
  const previous=globalThis.Audio;globalThis.Audio=FakeAudio;
  try{const {bus,group}=setup();bus.voiceRows=bus.voiceRows.map(row=>({...row,mainViewText:'Source caption'}));await bus.play({...voices[0],sourceMainView:true,text:'Source caption'},'a_sound_voiceeff_ch',{group:group.id});bus.hideSourceSubtitle(group.id);assert.equal(bus.element.paused,false);assert.ok(bus.currentVoice);assert.equal(bus.currentSubtitle,null);
    bus.pause();const saved=validateSoundScene(bus.snapshot(),[group]);assert.equal(saved.voiceTrack.subtitleHidden,true);bus.restore(saved,[group],[],true);assert.equal(bus.currentSubtitle,null);await bus.resume();assert.equal(bus.currentSubtitle,null);assert.equal(bus.exportVoice(saved,[group]).subtitleHidden,true);bus.dispose();
  }finally{globalThis.Audio=previous;}
});
test('exact source voices cannot be redirected by newer sound aliases during capture or restore',async()=>{
  const previous=globalThis.Audio;globalThis.Audio=FakeAudio;
  try{const source={id:'1',resourceName:'original',title:'Source',text:'Source subtitle',exactResource:true},modern={id:'1',resourceName:'replacement',alias:'original',text:'New subtitle'},bus=new AudioBus({entries:['original','replacement'].map(name=>({name,category:'a_sound_voiceeff',errors:[],clips:[{path:name+'.m4a'}]}))},[{name:'original',resource:'SoundRes/a_sound_voiceeff/replacement'}],'/assets/',[modern,source]);
    assert.equal(bus.resolve('original').path,'replacement.m4a');assert.equal(bus.resolve('original','a_sound_voiceeff',true).path,'original.m4a');
    await bus.play(source);assert.equal(bus.element.src,'/assets/original.m4a');bus.pause();const saved=validateSoundScene(bus.snapshot(),[]);assert.equal(saved.voiceTrack.exactResource,true);
    assert.equal(bus.exportVoice(saved,[]).url,'/assets/original.m4a');assert.equal(bus.exportVoice(saved,[]).text,'Source subtitle');bus.restore(saved,[],[],true);assert.equal(bus.element.src,'/assets/original.m4a');assert.equal(bus.currentSubtitle.text,'Source subtitle');
    assert.throws(()=>validateSoundScene({...saved,voiceTrack:{...saved.voiceTrack,exactResource:'yes'}},[]),/exact voice/);bus.dispose();
  }finally{globalThis.Audio=previous;}
});
test('paused speech retains its position when the media backend resets its clock',async()=>{
  const previous=globalThis.Audio;globalThis.Audio=FakeAudio;
  try{const {bus}=setup();await bus.play(voices[0],'a_sound_voiceeff_ch');bus.element.readyState=1;bus.element.currentTime=2.3;
    bus.pause();bus.element.currentTime=0;assert.equal(bus.snapshot().voiceTrack.time,2.3);bus.pause();assert.equal(bus.snapshot().voiceTrack.time,2.3);
    await bus.resume();assert.equal(bus.element.currentTime,2.3);assert.equal(bus.currentVoice.pauseTime,undefined);
    bus.element.currentTime=3.5;assert.equal(bus.snapshot().voiceTrack.time,3.5);bus.pause();bus.element.currentTime=0;assert.equal(bus.snapshot().voiceTrack.time,3.5);
    const saved=bus.snapshot();bus.restore(saved,[],[],true);assert.equal(bus.currentVoice.pauseTime,3.5);bus.element.currentTime=0;assert.equal(bus.snapshot().voiceTrack.time,3.5);await bus.resume();assert.equal(bus.element.currentTime,3.5);
    await bus.play(voices[0],'a_sound_voiceeff_ch');assert.equal(bus.currentVoice.pauseTime,undefined);bus.dispose();
  }finally{globalThis.Audio=previous;}
});
test('resource-only voice requests receive their catalog identity before capture',async()=>{const previous=globalThis.Audio;globalThis.Audio=FakeAudio;try{const {bus}=setup();await bus.play({resourceName:'spoken'},'a_sound_voiceeff_ch');assert.equal(bus.snapshot().voiceTrack.id,'1');assert.equal(bus.currentSubtitle.text,voices[0].text);bus.dispose();}finally{globalThis.Audio=previous;}});
test('voice checkpoints restore language, position and catalog subtitle without embedded text',async()=>{const previous=globalThis.Audio;globalThis.Audio=FakeAudio;try{const {bus,group}=setup();await bus.play(voices[0],'a_sound_voiceeff_ch',{group:group.id});bus.element.currentTime=2.3;bus.pause();const saved=validateSoundScene(bus.snapshot(),[group]);assert.equal(JSON.stringify(saved).includes(voices[0].text),false);bus.restore(saved,[group],[],true);assert.deepEqual(bus.snapshot(),saved);assert.equal(bus.element.paused,true);assert.equal(bus.currentSubtitle.text,voices[0].text);await bus.resume();assert.equal(bus.element.currentTime,2.3);assert.equal(bus.element.paused,false);group.visible=false;bus.syncAmbients([group],[]);assert.equal(bus.snapshot().voiceTrack,null);assert.equal(bus.currentSubtitle,null);bus.dispose();}finally{globalThis.Audio=previous;}});
test('captured voice descriptors retain saved settings and omit hidden objects',async()=>{const previous=globalThis.Audio;globalThis.Audio=FakeAudio;try{const {bus,group}=setup();await bus.play(voices[0],'a_sound_voiceeff_ch',{group:group.id});bus.element.currentTime=1;bus.setVolume(.4);const saved=bus.snapshot();bus.setVolume(.9);assert.deepEqual(bus.exportVoice(saved,[group]),{url:'/assets/spoken.m4a',text:voices[0].text,position:1,gain:.4,scene:true,repeat:false});assert.equal(bus.exportVoice(saved,[{...group,visible:false}]),null);bus.element.ended=true;bus.element.dispatchEvent(new Event('ended'));assert.equal(bus.snapshot().voiceTrack,null);await bus.resume();assert.equal(bus.element.playCalls,1);bus.dispose();}finally{globalThis.Audio=previous;}});
test('voice checkpoints reject unrelated objects, invalid times and nonvoice categories',async()=>{const previous=globalThis.Audio;globalThis.Audio=FakeAudio;try{const {bus,group}=setup();await bus.play(voices[0],'a_sound_voiceeff_ch');const saved=bus.snapshot();assert.throws(()=>validateSoundScene({...saved,voiceTrack:{...saved.voiceTrack,group:'other'}},[group]),/voice object/);assert.throws(()=>validateSoundScene({...saved,voiceTrack:{...saved.voiceTrack,time:NaN}},[group]),/voice time/);assert.throws(()=>validateSoundScene({...saved,voiceTrack:{...saved.voiceTrack,category:'a_sound_ui'}},[group]),/voice category/);bus.dispose();}finally{globalThis.Audio=previous;}});
test('late completion from replaced speech cannot overwrite the current subtitle',async()=>{const previous=globalThis.Audio,completions=[];globalThis.Audio=class extends FakeAudio{play(){super.play();return new Promise(resolve=>completions.push(resolve));}};try{const {bus}=setup();const first=bus.play({...voices[0],text:'First'},'a_sound_voiceeff_ch'),second=bus.play({...voices[0],text:'Second'},'a_sound_voiceeff_ch');completions[0]();await first;assert.equal(bus.currentSubtitle,null);completions[1]();await second;assert.equal(bus.currentSubtitle.text,'Second');bus.dispose();}finally{globalThis.Audio=previous;}});
test('failed voice playback clears captured speech and subtitles, then permits a fresh retry',async()=>{
  const previous=globalThis.Audio;globalThis.Audio=FakeAudio;
  try{const {bus}=setup();bus.element.play=async()=>{throw new DOMException('Unsupported audio','NotSupportedError');};
    await assert.rejects(bus.play(voices[0],'a_sound_voiceeff_ch'),{name:'NotSupportedError'});assert.equal(bus.snapshot().voiceTrack,null);assert.equal(bus.currentSubtitle,null);
    bus.element.play=FakeAudio.prototype.play;await bus.play(voices[0],'a_sound_voiceeff_ch');assert.equal(bus.currentSubtitle.text,voices[0].text);
    bus.element.error={code:3};bus.element.dispatchEvent(new Event('error'));assert.equal(bus.snapshot().voiceTrack,null);assert.equal(bus.currentSubtitle,null);bus.dispose();
  }finally{globalThis.Audio=previous;}
});
test('autoplay rejection retains a retryable voice, while obsolete resume errors cannot stop new speech',async()=>{
  const previous=globalThis.Audio;globalThis.Audio=FakeAudio;
  try{const {bus}=setup();bus.element.play=async()=>{throw new DOMException('User gesture required','NotAllowedError');};
    await assert.rejects(bus.play(voices[0],'a_sound_voiceeff_ch'),{name:'NotAllowedError'});assert.ok(bus.snapshot().voiceTrack);assert.equal(bus.currentSubtitle,null);
    bus.element.play=FakeAudio.prototype.play;await bus.resume();assert.equal(bus.currentSubtitle.text,voices[0].text);
    let reject;bus.element.play=()=>new Promise((_,failure)=>reject=failure);const resume=bus.resume();
    bus.element.play=FakeAudio.prototype.play;await bus.play({...voices[0],text:'Replacement'},'a_sound_voiceeff_ch');reject(new DOMException('Old request aborted','AbortError'));
    await resume;assert.equal(bus.currentSubtitle.text,'Replacement');assert.ok(bus.currentVoice);bus.dispose();
  }finally{globalThis.Audio=previous;}
});
