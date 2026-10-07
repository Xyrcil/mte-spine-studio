import test from 'node:test';
import assert from 'node:assert/strict';
import {MainViewSpeechClock,sourceSpeechDelay,validateMainViewSpeechClock} from '../src/engine/main-view-speech-clock.js';

test('source speech delays use float multiplication and ties-even milliseconds',()=>{
  assert.equal(sourceSpeechDelay(.0025),.002);assert.equal(sourceSpeechDelay(.0035),.004);assert.equal(sourceSpeechDelay(4.33859395980835),4.339);
  for(const value of [-1,Infinity,NaN,'1'])assert.throws(()=>sourceSpeechDelay(value),/length/);
});
test('word hiding reopens the source click gate and arms idle only after speech completion',()=>{
  const events=[],clock=new MainViewSpeechClock({onHideWords:()=>events.push('hide'),onIdle:index=>events.push(index)});clock.show();
  assert.equal(clock.requestClick(),true);assert.equal(clock.requestClick(),false);clock.soundStarted(2);clock.advance(1.9);assert.equal(clock.value.canClick,false);
  clock.advance(.1);assert.equal(clock.value.canClick,true);assert.equal(clock.value.wordsRemaining,null);assert.equal(clock.value.idleRemaining,120);assert.deepEqual(events,['hide']);
  clock.advance(119.9);assert.deepEqual(events,['hide']);clock.advance(.1);assert.equal(events.length,2);assert.ok([1,2].includes(events[1]));assert.equal(clock.active,false);
});
test('game-clock checkpoints preserve pending delay and random idle choice without replaying callbacks',()=>{
  const events=[],clock=new MainViewSpeechClock({onHideWords:()=>events.push('hide'),onIdle:index=>events.push(index)});clock.show();clock.requestClick();clock.soundStarted(1);clock.advance(.4);const saved=clock.snapshot();
  clock.advance(120.6);const expected=events.slice();events.length=0;clock.restore(saved);assert.deepEqual(events,[]);clock.advance(120.6);assert.deepEqual(events,expected);
  assert.deepEqual(validateMainViewSpeechClock(saved),saved);assert.throws(()=>clock.restore({...saved,wordsRemaining:-1}),/clock/);
});
test('source timers retain residual time across rearmed voices and hide removes the main-view timer',()=>{
  let hides=0,idles=0;const clock=new MainViewSpeechClock({onHideWords:()=>hides++,onIdle:()=>{idles++;clock.soundStarted(2);}});clock.show();clock.soundStarted(1);clock.advance(245);
  assert.equal(hides,3);assert.equal(idles,2);assert.equal(clock.value.idleRemaining,120);
  clock.hide();clock.advance(500);assert.equal(idles,2);assert.equal(clock.active,false);clock.stopWords();assert.equal(clock.value.canClick,true);
});
test('new speech keeps the older idle timer until completion replaces it',()=>{
  const events=[],clock=new MainViewSpeechClock({onHideWords:()=>events.push('hide'),onIdle:()=>{events.push('idle');clock.soundStarted(3);}});clock.show();clock.soundStarted(1);clock.advance(119);assert.equal(clock.value.idleRemaining,2);
  clock.requestClick();clock.soundStarted(5);clock.advance(2);assert.deepEqual(events,['hide','idle']);assert.equal(clock.value.wordsRemaining,3);assert.equal(clock.value.canClick,false);
  clock.advance(3);assert.deepEqual(events,['hide','idle','hide']);assert.equal(clock.value.canClick,true);assert.equal(clock.value.idleRemaining,120);
});
