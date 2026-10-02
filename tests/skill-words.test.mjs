import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SkillWordReveal,skillLetterWidths} from '../src/engine/skill-words.js';

test('source word coroutine reveals half then full opacity and advances at most once per frame',()=>{
  const words=new SkillWordReveal(2);assert.deepEqual([words.alpha(0),words.alpha(1)],[0,0]);words.play();assert.deepEqual([words.alpha(0),words.alpha(1)],[.5,0]);assert.equal(words.delay,Math.fround(Math.fround(.33)/3));const saved=words.snapshot();words.advance(0);assert.deepEqual(words.snapshot(),saved);words.advance(words.delay*.5);assert.equal(words.step,1);words.advance(1);assert.equal(words.step,2);assert.deepEqual([words.alpha(0),words.alpha(1)],[1,.5]);words.advance(1);assert.equal(words.step,3);assert.equal(words.playing,true);assert.deepEqual([words.alpha(0),words.alpha(1)],[1,1]);words.advance(words.delay+.00001);assert.equal(words.playing,false);
});
test('source word checkpoints retain their next wait and reject incompatible counts before mutation',()=>{
  const words=new SkillWordReveal(4);words.play(.4);words.advance(.1);const saved=words.snapshot(),copy=new SkillWordReveal(4);copy.restore(saved);words.advance(.003);copy.advance(.003);assert.deepEqual(words.snapshot(),copy.snapshot());assert.throws(()=>copy.restore({...saved,count:5}),/checkpoint/);assert.throws(()=>copy.restore({...saved,nextUpdate:saved.clock-1}),/checkpoint/);assert.throws(()=>copy.play(),/concurrent/);assert.throws(()=>words.advance(-1),/time/);assert.throws(()=>new SkillWordReveal(4097),/count/);
});
test('empty source names still retain the coroutine final wait without inventing letters',()=>{
  const words=new SkillWordReveal(0);words.play();assert.equal(words.step,1);assert.equal(words.playing,true);words.advance(.34);assert.equal(words.playing,false);assert.throws(()=>words.alpha(0),/index/);
});
test('preferred-width letter layout preserves source parent pivot and constrained widths',()=>{
  assert.deepEqual(skillLetterWidths([10,20,30],60),[{x:-25,width:10},{x:-10,width:20},{x:15,width:30}]);assert.deepEqual(skillLetterWidths([10,20],15),[{x:-5,width:5},{x:2.5,width:10}]);assert.deepEqual(skillLetterWidths([],0),[]);assert.throws(()=>skillLetterWidths([NaN],1),/layout/);
});
test('all original English skill lengths complete at browser frame cadences and round-trip their checkpoints',t=>{
  if(!fs.existsSync('public/assets/library.json')){t.skip('Local game resources are not installed');return;}
  const names=JSON.parse(fs.readFileSync('public/assets/library.json')).skillDisplay.skills.map(row=>row.englishName);assert.equal(names.length,1005);
  for(const name of names)for(const fps of [30,60,120]){const words=new SkillWordReveal(name.length);words.play();for(let frame=0;frame<300&&words.playing;frame++){words.advance(1/fps);const restored=new SkillWordReveal(name.length);restored.restore(words.snapshot());assert.deepEqual(restored.snapshot(),words.snapshot());}assert.equal(words.playing,false);assert.ok(name.split('').every((_,index)=>words.alpha(index)===1));}
});
