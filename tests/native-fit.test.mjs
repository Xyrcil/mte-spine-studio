import test from 'node:test';
import assert from 'node:assert/strict';
import {Stage} from '../src/engine/stage.js';
import {sourcePreviewCamera} from '../src/engine/geometry.js';

test('source preview expands narrow viewports instead of fitting offstage geometry',()=>{
  const view={camera:{x:0,y:.09,halfHeight:1,referenceAspect:16/9},position:{x:.177,y:.005},scale:{x:.185,y:.185},offset:1.1},frame=sourcePreviewCamera(view,1.6);
  assert.ok(Math.abs(frame.x+.177/.185)<1e-10);assert.ok(Math.abs(frame.y-.085/.185)<1e-10);assert.ok(Math.abs(frame.height-2*(16/9)/1.6/.185)<1e-10);assert.ok(Math.abs(frame.width-frame.height*1.6)<1e-10);
  const wide=sourcePreviewCamera(view,2340/1080);assert.ok(Math.abs(wide.x+.177*1.1/.185)<1e-10);assert.equal(wide.height,2/.185);
  assert.equal(sourcePreviewCamera({...view,offset:0},2340/1080).x,0);
  for(const update of [{scale:{x:0,y:0}},{offset:NaN},{scale:{x:1,y:2}}])assert.throws(()=>sourcePreviewCamera({...view,...update},1.6),/preview/);
  assert.throws(()=>sourcePreviewCamera({...view,camera:{...view.camera,referenceAspect:2340/1080}},1.6),/preview/);assert.throws(()=>sourcePreviewCamera(view,1e-309),/finite/);
});
test('source preview follows scene transforms and preserves the camera when unavailable',()=>{
  const view={camera:{x:0,y:0,halfHeight:1,referenceAspect:16/9},position:{x:0,y:0},scale:{x:1,y:1},offset:1},group={presentation:{previewView:view},x:3,y:4,scale:2,rotation:90,flipX:true},stage={canvas:{getBoundingClientRect:()=>({width:160,height:90})},camera:{x:0,y:0,width:1,height:1}};
  assert.equal(Stage.prototype.fitPreview.call(stage,group),true);assert.equal(stage.camera.x,3);assert.equal(stage.camera.y,4);assert.ok(Math.abs(stage.camera.width-4)<1e-10);assert.ok(Math.abs(stage.camera.height-64/9)<1e-10);
  const previous={...stage.camera};assert.equal(Stage.prototype.fitPreview.call(stage,{presentation:{}}),false);assert.deepEqual(stage.camera,previous);
  group.presentation.previewView={};assert.equal(Stage.prototype.fitPreview.call(stage,group),false);assert.deepEqual(stage.camera,previous);assert.match(group.previewReason,/configuration/);
});

test('scene fit includes trimmed native images and their scene transform',()=>{
  const node={id:'rect',data:{m_SizeDelta:{x:100,y:80},m_Pivot:{x:.5,y:.5}}},group={visible:true,kind:'spine',layers:[],scale:2,x:10,y:20,rotation:0,nodes:new Map([['rect',node]]),world:()=>[1,0,0,1,5,0],isActiveTransform:()=>true,nativeImages:[{used:true,source:{transform:'rect',sprite:{rect:{width:100,height:80},contentRect:{x:10,y:20,width:50,height:40}}}}]},stage={groups:[group],camera:{x:0,y:0,width:1,height:1}};
  Stage.prototype.fit.call(stage);assert.deepEqual(stage.camera,{x:-10,y:20,width:100*1.15,height:80*1.15});
  group.nativeImages[0].source.viewportDecoration=true;const before=structuredClone(stage.camera);Stage.prototype.fit.call(stage);assert.deepEqual(stage.camera,before);
});
