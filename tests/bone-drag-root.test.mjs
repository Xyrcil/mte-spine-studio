import test from 'node:test';
import assert from 'node:assert/strict';
import {BoneDragRoot,validateBoneDragState} from '../src/engine/bone-drag-root.js';
import {objectTransform,point} from '../src/engine/geometry.js';

const ref=id=>({m_FileID:0,m_PathID:id});
function fixture(){
  const transform=(id,parent,children=[])=>({id,type:'Transform',data:{m_Father:ref(parent),m_Children:children.map(ref),m_LocalPosition:{x:0,y:0},m_LocalScale:{x:1,y:1}}});
  const nodes=new Map([transform('root','0',['a','b','target','left','right']),transform('a','root'),transform('b','root'),transform('target','root'),transform('left','root'),transform('right','root')].map(row=>[row.id,row]));
  const layers=['b','a'].map((id,index)=>{const bone={x:0,y:0,worldX:index,worldY:0};return {instance:{transform:id},bone,skeleton:{findBone:()=>bone,updateWorldTransform(){}}};});
  const group={x:10,y:20,scale:2,visible:true,nodes,transforms:new Map([['owner',nodes.get('root')]]),layers,isActiveTransform:()=>true,world:()=>[1,0,0,1,0,0],controllers:[{transformBindings:new Map([['left',true],['right',true]]),matrixForTransform:id=>[1,0,0,1,id==='left'?6:14,id==='left'?24:16]}]};
  const root=new BoneDragRoot(group,{id:'drag',gameObject:'owner',data:{dragBone:'leg_move',dragBoneTra:ref('target'),dragRange_LeftTop:ref('left'),dragRange_RightDown:ref('right'),ShowBackMoveTime:.5},dragColliders:[{type:'BoxCollider2D',data:{m_Enabled:1,m_Size:{x:1,y:1}}}]});
  return {root,group,layers};
}
test('drag receiver uses hierarchy order, world bounds and target parent coordinates',()=>{
  const {root,layers}=fixture();assert.deepEqual(root.motion.center,{x:0,y:0});assert.equal(root.contains(10,20),true);assert.equal(root.contains(14,20),false);
  root.begin();assert.equal(root.move({x:12,y:22}),true);assert.deepEqual(root.motion.current,{x:1,y:1});assert.equal(root.move({x:14,y:22}),false);
  root.advance(0);for(const layer of layers)root.apply(layer);assert.ok(layers.every(layer=>layer.bone.x===1&&layer.bone.y===1));
});
test('return checkpoints preserve the final write and release animated pose next frame',()=>{
  const {root,layers}=fixture();root.begin();root.move({x:12,y:22});root.release();root.advance(.25);const saved=root.snapshot(),copy=fixture().root;copy.restore(saved);assert.deepEqual(copy.snapshot(),saved);
  root.apply(layers[0]);assert.equal(layers[0].bone.x,.25);root.advance(.25);root.apply(layers[0]);assert.equal(layers[0].bone.x,0);layers[0].bone.x=7;root.advance(.1);root.apply(layers[0]);assert.equal(layers[0].bone.x,7);
  assert.throws(()=>root.restore({...saved,motion:{...saved.motion,elapsed:1}}),/checkpoint/);assert.throws(()=>validateBoneDragState({...saved,writing:'yes'}),/state/);
});
test('disabled hierarchy ignores input and pauses the source return',()=>{
  const {root,group}=fixture();root.begin();root.move({x:12,y:22});root.release();group.visible=false;root.advance(.25);assert.equal(root.motion.elapsed,0);assert.equal(root.begin(),false);assert.equal(root.move({x:11,y:21}),false);group.visible=true;root.advance(.25);assert.equal(root.motion.elapsed,.25);
});
test('held input follows moving bounds and stops overriding bones outside the source range',()=>{
  const {root,layers}=fixture();root.begin();root.move({x:12,y:22});root.advance(.1);root.apply(layers[0]);assert.equal(layers[0].bone.x,1);
  root.move({x:40,y:22});root.advance(.1);layers[0].bone.x=8;root.apply(layers[0]);assert.equal(layers[0].bone.x,8);const saved=root.snapshot(),copy=fixture().root;copy.restore(saved);assert.deepEqual(copy.pointer,{x:40,y:22});assert.equal(copy.motion.dragging,true);
});
test('editor rotation and mirroring transport the source drag range without widening it',()=>{
  for(const pose of [{rotation:37,flipX:false,flipY:false},{rotation:0,flipX:true,flipY:false},{rotation:-53,flipX:true,flipY:true}]){
    const {root,group}=fixture();Object.assign(group,pose,{x:7,y:-4,scale:.6});
    group.controllers[0].matrixForTransform=id=>{const p=point(objectTransform(group),id==='left'?-2:2,id==='left'?2:-2);return [1,0,0,1,p.x,p.y];};
    root.begin();assert.equal(root.move(point(objectTransform(group),1,1)),true,JSON.stringify(pose));
    assert.ok(Math.abs(root.motion.current.x-1)<1e-10&&Math.abs(root.motion.current.y-1)<1e-10);
    assert.equal(root.move(point(objectTransform(group),3,0)),false);
    for(const edge of [{x:2,y:0},{x:-2,y:0},{x:0,y:2},{x:0,y:-2}])assert.equal(root.move(point(objectTransform(group),edge.x,edge.y)),false,'Source edges remain excluded');
    root.release();root.advance(.5);assert.deepEqual(root.motion.current,root.motion.center);
  }
});
