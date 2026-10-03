import test from 'node:test';
import assert from 'node:assert/strict';
import {cardOutcomeSeeds} from '../tools/controller_branches.mjs';
import {InteractionRoot} from '../src/engine/interaction.js';

const draw=seed=>InteractionRoot.prototype.randomCard.call({value:{random:seed}});
test('controller exploration exercises each card outcome through a valid random checkpoint',()=>{
  const branches=cardOutcomeSeeds(draw);assert.deepEqual(branches.map(row=>row.outcome),[0,1,2]);assert.equal(new Set(branches.map(row=>row.seed)).size,3);
  for(const row of branches){assert.ok(row.seed>0&&row.seed<=4294967295);assert.equal(draw(row.seed),row.outcome);}assert.deepEqual(cardOutcomeSeeds(draw),branches);
});
test('controller exploration does not report a partial random branch set as complete',()=>{
  assert.throws(()=>cardOutcomeSeeds(()=>0),/incomplete/);assert.throws(()=>cardOutcomeSeeds(()=>3),/Invalid/);
});
