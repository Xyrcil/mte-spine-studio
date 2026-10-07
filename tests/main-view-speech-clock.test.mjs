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
test('subtitle-only completion reopens clicks without rearming the main-view idle timer',()=>{
  const hides=[],clock=new MainViewSpeechClock({onHideWords:late=>hides.push(late)});clock.show();clock.finish();hides.length=0;
  clock.requestClick();assert.equal(clock.shieldStarted(3016119,'Voice_3016119_Touch_Head',3),true);clock.advance(3.25);
  assert.equal(clock.value.canClick,true);assert.equal(clock.value.wordsRemaining,null);assert.equal(clock.value.idleRemaining,116.75);assert.deepEqual(hides,[.25]);assert.equal(clock.shieldTimers.length,0);
});
test('independent subtitle-only timers can hide newer words without canceling their normal timer',()=>{
  let hides=0;const clock=new MainViewSpeechClock({onHideWords:()=>hides++});clock.show();clock.requestClick();clock.shieldStarted(3016119,'old',3);clock.advance(1);clock.soundStarted(5);clock.advance(2);
  assert.equal(hides,1);assert.equal(clock.value.canClick,true);assert.equal(clock.value.wordsRemaining,3);assert.equal(clock.value.idleRemaining,null);
  clock.advance(3);assert.equal(hides,2);assert.equal(clock.value.idleRemaining,120);
});
test('same-player replacement cancels only that timer and duplicate names suppress the replacement',()=>{
  const clock=new MainViewSpeechClock();clock.shieldStarted(1,'first',3);clock.shieldStarted(2,'other',3);clock.advance(.5);
  assert.equal(clock.shieldStarted(1,'second',3),true);assert.deepEqual(clock.shieldTimers,[{player:2,name:'other',remaining:2.5},{player:1,name:'second',remaining:3}]);
  clock.soundStarted(4);assert.equal(clock.shieldStarted(1,'second',3),false);assert.equal(clock.value.wordsRemaining,null);assert.deepEqual(clock.shieldTimers,[{player:2,name:'other',remaining:2.5}]);assert.equal(clock.lastShieldPlayer,1);
});
test('stopping words cancels the latest subtitle-only timer rather than all player timers',()=>{
  let hides=0;const clock=new MainViewSpeechClock({onHideWords:()=>hides++});clock.shieldStarted(1,'first',3);clock.shieldStarted(2,'second',3);clock.soundStarted(4);clock.stopWords();
  assert.deepEqual(clock.shieldTimers,[{player:1,name:'first',remaining:3}]);assert.equal(clock.value.wordsRemaining,null);assert.equal(clock.lastShieldPlayer,undefined);clock.advance(3);assert.equal(hides,2);
  clock.shieldStarted(1,'new',3);clock.clearShields();assert.equal(clock.active,false);
});
test('subtitle-only snapshots are isolated and restore timers without emitting callbacks',()=>{
  let hides=0;const clock=new MainViewSpeechClock({onHideWords:()=>hides++});clock.requestClick();clock.shieldStarted(3016119,'line',3);clock.advance(1);const saved=clock.snapshot();assert.deepEqual(validateMainViewSpeechClock(saved),saved);
  const changed=clock.snapshot();changed.shieldTimers[0].remaining=100;assert.equal(clock.shieldTimers[0].remaining,2);clock.advance(2);assert.equal(hides,1);clock.restore(saved);assert.equal(hides,1);clock.advance(2);assert.equal(hides,2);
  for(const row of [{player:1,name:'',remaining:3},{player:1,name:'line',remaining:-1},{player:2147483648,name:'line',remaining:3}])assert.throws(()=>clock.restore({...saved,shieldTimers:[row]}),/subtitle-only/);
  assert.throws(()=>clock.restore({...saved,shieldTimers:[saved.shieldTimers[0],saved.shieldTimers[0]]}),/subtitle-only/);
});
test('a subtitle callback can cancel other expired timers without firing stale callbacks',()=>{
  let hides=0;const clock=new MainViewSpeechClock({onHideWords:()=>{hides++;clock.clearShields();}});clock.shieldStarted(1,'first',3);clock.shieldStarted(2,'second',3);clock.advance(3);assert.equal(hides,1);assert.equal(clock.active,false);
});
