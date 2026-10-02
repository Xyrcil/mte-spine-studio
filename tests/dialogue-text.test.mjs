import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutDialogueGlyphs,advanceDialogueTypewriter} from '../src/engine/dialogue-text.js';

test('dialogue layout remains fixed as visible characters advance and retains Unicode indices',()=>{
  const flow=layoutDialogueGlyphs('甲乙丙\n丁😀',()=>10,20,true);assert.deepEqual(flow.glyphs.map(row=>[row.character,row.x,row.line,row.index]),[['甲',0,0,0],['乙',10,0,1],['丙',0,1,2],['丁',0,2,4],['😀',10,2,5]]);assert.equal(flow.characters,6);assert.equal(flow.lines,3);assert.throws(()=>layoutDialogueGlyphs('x',()=>NaN,10,true),/advance/);
});
test('source typewriter advances toward elapsed-time goals and waits its configured delay between updates',()=>{
  const state={start:1,typed:0,nextUpdate:1};advanceDialogueTypewriter(state,1.01,50,20);assert.equal(state.typed,1);advanceDialogueTypewriter(state,1.02,50,20);assert.equal(state.typed,1);advanceDialogueTypewriter(state,1.035,50,20);assert.equal(state.typed,2);const saved=structuredClone(state);advanceDialogueTypewriter(state,1.8,50,20);assert.equal(state.typed,20);const restored=structuredClone(saved);advanceDialogueTypewriter(restored,1.8,50,20);assert.deepEqual(restored,state);
});
