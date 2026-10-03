import test from 'node:test';
import assert from 'node:assert/strict';
import {BoneDragMotion,inSourceDragRange} from '../src/engine/bone-drag.js';

test('source drag bounds exclude their edges and ignore out-of-range input rather than clamping',()=>{
  const left={x:-2,y:3},right={x:2,y:-3},model=new BoneDragMotion({x:0,y:0},.5);assert.equal(model.move({x:1,y:1},left,right),false);model.begin();assert.equal(model.move({x:1,y:1},left,right),true);
  for(const point of [{x:2,y:0},{x:-2,y:0},{x:0,y:3},{x:0,y:-3},{x:100,y:100}])assert.equal(model.move(point,left,right),false);assert.deepEqual(model.current,{x:1,y:1});assert.equal(inSourceDragRange({x:0,y:0},{x:0,y:0},{x:0,y:0}),false);
});
test('bone return follows OutQuad timing, pauses and restores independently',()=>{
  const model=new BoneDragMotion({x:0,y:0},.5);model.begin();model.move({x:1,y:2},{x:-3,y:3},{x:3,y:-3});model.release();model.advance(.25);assert.deepEqual(model.current,{x:.25,y:.5});const saved=model.snapshot();model.advance(0);assert.deepEqual(model.snapshot(),saved);const copy=new BoneDragMotion({x:0,y:0},.5);copy.restore(saved);model.advance(.25);copy.advance(.25);assert.deepEqual(copy.snapshot(),model.snapshot());assert.deepEqual(model.current,{x:0,y:0});assert.equal(model.returning,false);
});
test('a new pointer press does not cancel the existing source return tween',()=>{
  const model=new BoneDragMotion({x:0,y:0},.5);model.current={x:2,y:0};model.release();model.advance(.1);model.begin();assert.equal(model.returning,true);model.advance(.1);assert.ok(model.current.x<2);model.release();assert.equal(model.elapsed,0);assert.deepEqual(model.from,model.current);
});
test('bone drag checkpoints and immediate returns reject invalid values',()=>{
  const model=new BoneDragMotion({x:0,y:0},0);model.current={x:1,y:2};model.release();assert.deepEqual(model.current,{x:0,y:0});assert.throws(()=>model.restore({...model.snapshot(),returning:true}),/checkpoint/);assert.throws(()=>model.advance(-1),/delta/);assert.throws(()=>new BoneDragMotion({x:NaN,y:0},.5),/position/);
});
