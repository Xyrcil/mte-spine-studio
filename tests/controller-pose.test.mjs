import test from 'node:test';
import assert from 'node:assert/strict';
import {invalidControllerPose} from '../tools/controller_pose.mjs';
const fields=['a','b','c','d','worldX','worldY','x','y','rotation','scaleX','scaleY','shearX','shearY','arotation','ax','ay','ascaleX','ascaleY','ashearX','ashearY'];
const bone=name=>({...Object.fromEntries(fields.map(key=>[key,0])),data:{name},parent:null});
const layer=(name,bones)=>({instance:{name},skeleton:{bones}});
const reference=group=>group.layers.flatMap(layer=>layer.skeleton.bones.filter(bone=>fields.some(key=>!Number.isFinite(bone[key]))).map(bone=>({layer:layer.instance.name,bone:bone.data.name,parent:bone.parent?.data.name,local:[bone.x,bone.y,bone.scaleX,bone.scaleY],parentMatrix:bone.parent&&[bone.parent.a,bone.parent.b,bone.parent.c,bone.parent.d],applied:[bone.ax,bone.ay,bone.arotation]})));
test('controller pose checks accept finite zero and signed numeric fields',()=>{
  const root=bone('root');for(const [index,key]of fields.entries())root[key]=index%2?-index:index;assert.deepEqual(invalidControllerPose({layers:[layer('body',[root])]}),[]);assert.deepEqual(invalidControllerPose({layers:[]}),[]);
});
test('direct pose checks retain all twenty legacy fields and diagnostic values',()=>{
  for(const key of fields)for(const value of [NaN,Infinity,-Infinity,undefined,null,'3',{}]){
    const root=bone('root');root[key]=value;const group={layers:[layer('body',[root])]};assert.equal(invalidControllerPose(group).length,1,`${key}: ${String(value)}`);assert.deepEqual(invalidControllerPose(group),reference(group));
  }
});
test('invalid pose reports retain layer, bone and parent ordering',()=>{
  const parent=bone('parent'),first=bone('first'),second=bone('second');first.parent=parent;first.scaleX=NaN;second.ax=Infinity;const group={layers:[layer('foreground',[parent,first]),layer('background',[second])]};assert.deepEqual(invalidControllerPose(group),reference(group));assert.deepEqual(invalidControllerPose(group).map(row=>[row.layer,row.bone,row.parent]),[['foreground','first','parent'],['background','second',undefined]]);
});
