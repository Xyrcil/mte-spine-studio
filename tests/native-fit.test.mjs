import test from 'node:test';
import assert from 'node:assert/strict';
import {Stage} from '../src/engine/stage.js';

test('scene fit includes trimmed native images and their scene transform',()=>{
  const node={id:'rect',data:{m_SizeDelta:{x:100,y:80},m_Pivot:{x:.5,y:.5}}},group={visible:true,kind:'spine',layers:[],scale:2,x:10,y:20,rotation:0,nodes:new Map([['rect',node]]),world:()=>[1,0,0,1,5,0],isActiveTransform:()=>true,nativeImages:[{used:true,source:{transform:'rect',sprite:{rect:{width:100,height:80},contentRect:{x:10,y:20,width:50,height:40}}}}]},stage={groups:[group],camera:{x:0,y:0,width:1,height:1}};
  Stage.prototype.fit.call(stage);assert.deepEqual(stage.camera,{x:-10,y:20,width:100*1.15,height:80*1.15});
  group.nativeImages[0].source.viewportDecoration=true;const before=structuredClone(stage.camera);Stage.prototype.fit.call(stage);assert.deepEqual(stage.camera,before);
});
