import {test} from 'node:test';
import assert from 'node:assert/strict';
import {multiply,unityTransform} from '../src/engine/stage.js';
test('parent rotation and scale also transform child position',()=>{
  const r=Math.sqrt(.5);
  const parent=unityTransform({m_LocalRotation:{x:0,y:0,z:r,w:r},m_LocalScale:{x:2,y:2},m_LocalPosition:{x:10,y:20}});
  const result=multiply(parent,[1,0,0,1,3,4]);
  assert.ok(Math.abs(result[4]-2)<1e-10);assert.ok(Math.abs(result[5]-26)<1e-10);
});
