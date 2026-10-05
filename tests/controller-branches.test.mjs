import test from 'node:test';
import assert from 'node:assert/strict';
import {cardOutcomeSeeds,ControllerCheckpoint} from '../tools/controller_branches.mjs';
import {InteractionRoot} from '../src/engine/interaction.js';
import {mkdtemp,appendFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const draw=seed=>InteractionRoot.prototype.randomCard.call({value:{random:seed}});
test('controller exploration exercises each card outcome through a valid random checkpoint',()=>{
  const branches=cardOutcomeSeeds(draw);assert.deepEqual(branches.map(row=>row.outcome),[0,1,2]);assert.equal(new Set(branches.map(row=>row.seed)).size,3);
  for(const row of branches){assert.ok(row.seed>0&&row.seed<=4294967295);assert.equal(draw(row.seed),row.outcome);}assert.deepEqual(cardOutcomeSeeds(draw),branches);
});
test('controller exploration does not report a partial random branch set as complete',()=>{
  assert.throws(()=>cardOutcomeSeeds(()=>0),/incomplete/);assert.throws(()=>cardOutcomeSeeds(()=>3),/Invalid/);
});
test('controller checkpoints retain unfinished states, recover a torn final record and continue at a larger limit',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mte-controller-check-')),path=join(directory,'states.jsonl');
  try{const first=new ControllerCheckpoint(path,'runtime');await first.open();await first.begin('role','resources');await first.enqueue('role','a',{values:[1,2]},1);assert.equal((await first.enqueue('role','b',{values:[3]},1)).limited,true);assert.equal(first.next('role').key,'a');first.next('role').scene.values[0]=99;assert.equal(first.next('role').scene.values[0],1);
    await appendFile(path,'{"kind":"state"');const resumed=new ControllerCheckpoint(path,'runtime');await resumed.open();assert.equal(resumed.next('role').key,'a');await resumed.begin('role','resources');await resumed.enqueue('role','b',{values:[3]},2);await resumed.finish('role','a',{explored:1});
    const again=new ControllerCheckpoint(path,'runtime');await again.open();assert.deepEqual(again.status('role'),{states:2,pending:1,progress:{explored:1}});assert.equal(again.next('role').key,'b');await again.finish('role','b',{explored:2});assert.equal(again.next('role'),null);
    await assert.rejects(new ControllerCheckpoint(path,'changed runtime').open(),/runtime changed/);await assert.rejects(again.begin('role','changed resources'),/resources changed/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
