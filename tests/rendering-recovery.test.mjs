import test from 'node:test';
import assert from 'node:assert/strict';
import {Stage} from '../src/engine/stage.js';
test('interrupted rendering exposes an isolated scene checkpoint rather than empty rebuild state',()=>{const checkpoint={schema:1,name:'Original',paused:false,objects:[{id:'actor',x:3}]},stage={recoveryPending:true,recoverySnapshot:checkpoint,groups:[]};const snapshot=Stage.prototype.snapshot.call(stage,'Saved name');assert.equal(snapshot.name,'Saved name');assert.equal(snapshot.objects[0].x,3);snapshot.objects[0].x=99;assert.equal(checkpoint.objects[0].x,3);});
test('recovery waits for an available browser context without consuming the checkpoint',async()=>{const checkpoint={schema:1,objects:[]},stage={recoveryPending:true,contextLost:true,recoverySnapshot:checkpoint};await assert.rejects(Stage.prototype.recoverRendering.call(stage),/browser has not restored/);assert.equal(stage.recoverySnapshot,checkpoint);});
