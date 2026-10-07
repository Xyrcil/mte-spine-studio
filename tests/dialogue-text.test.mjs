import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutDialogueGlyphs,advanceDialogueTypewriter,DialogueTextLayer} from '../src/engine/dialogue-text.js';

test('dialogue prepares measured name width before any graphics are drawn',()=>{
  const node={data:{m_SizeDelta:{x:30,y:43}}},root={value:{phase:'dialogue'},source:{id:'hot-spring'},dialogueDisplay:()=>({name:'Long name'})},context={measureText:text=>({width:text.length*10})};
  const group={controllers:[root],nodes:new Map([['name',node]])},layer=new DialogueTextLayer({},group);
  layer.slots=[{name:'tv_name',source:{transform:'name',data:{m_fontSize:24}},font:{family:'original'},context}];
  layer.prepare();assert.equal(node.data.m_SizeDelta.x,90);assert.equal(context.font,'24px "original"');
  layer.prepare();assert.equal(node.data.m_SizeDelta.x,90);root.value.phase='idle';node.data.m_SizeDelta.x=30;layer.prepare();assert.equal(node.data.m_SizeDelta.x,30);
});

test('dialogue layout remains fixed as visible characters advance and retains Unicode indices',()=>{
  const flow=layoutDialogueGlyphs('甲乙丙\n丁😀',()=>10,20,true);assert.deepEqual(flow.glyphs.map(row=>[row.character,row.x,row.line,row.index]),[['甲',0,0,0],['乙',10,0,1],['丙',0,1,2],['丁',0,2,4],['😀',10,2,5]]);assert.equal(flow.characters,6);assert.equal(flow.lines,3);assert.throws(()=>layoutDialogueGlyphs('x',()=>NaN,10,true),/advance/);
});
test('source typewriter advances toward elapsed-time goals and waits its configured delay between updates',()=>{
  const state={start:1,typed:0,nextUpdate:1};advanceDialogueTypewriter(state,1.01,50,20);assert.equal(state.typed,1);advanceDialogueTypewriter(state,1.02,50,20);assert.equal(state.typed,1);advanceDialogueTypewriter(state,1.035,50,20);assert.equal(state.typed,2);const saved=structuredClone(state);advanceDialogueTypewriter(state,1.8,50,20);assert.equal(state.typed,20);const restored=structuredClone(saved);advanceDialogueTypewriter(restored,1.8,50,20);assert.deepEqual(restored,state);
});
test('dialogue backs up to source punctuation and word boundaries without changing typewriter indices',()=>{
  const rules={leading:'（「',following:'，。）」'},lines=text=>layoutDialogueGlyphs(text,()=>10,30,true,rules).glyphs.reduce((result,row)=>{result[row.line]=(result[row.line]||'')+row.character;return result;},[]);
  assert.deepEqual(lines('甲乙丙，丁'),['甲乙','丙，丁']);
  assert.deepEqual(lines('甲乙（丙丁'),['甲乙','（丙丁']);
  assert.deepEqual(lines('ab cde'),['ab ','cde']);
  assert.deepEqual(lines('abcdef'),['abc','def']);
  const flow=layoutDialogueGlyphs('甲乙丙，丁',()=>10,30,true,rules);assert.deepEqual(flow.glyphs.map(row=>row.index),[0,1,2,3,4]);assert.equal(flow.width,30);
  assert.equal(layoutDialogueGlyphs('ab cde',()=>10,30,false,rules).lines,1);
  assert.throws(()=>layoutDialogueGlyphs('x',()=>10,30,true,{leading:[]}),/rules/);
});
test('hard line breaks, oversized glyphs and narrow punctuation runs always terminate',()=>{
  const rules={leading:'（',following:'，'};
  assert.equal(layoutDialogueGlyphs('\n甲\n',()=>10,1,true,rules).lines,3);
  const flow=layoutDialogueGlyphs('（甲，，乙',()=>10,1,true,rules);assert.equal(flow.glyphs.length,5);assert.equal(flow.characters,5);assert.ok(flow.lines<=5);
  let calls=0;layoutDialogueGlyphs('甲乙丙丁',()=>{calls++;return 10;},20,true,rules);assert.equal(calls,4);
});
