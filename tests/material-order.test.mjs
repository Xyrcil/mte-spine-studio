import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {compileMaterialMapping,skeletonDrawSegments,drawSkeletonSlots} from '../src/engine/material-order.js';

const slot=(index,blend=0)=>({data:{index,blendMode:blend},bone:{active:true},getAttachment:()=>({region:{page:{name:'page-0.png'}}})});
function fixture(){const normal={id:'normal',renderQueue:3005},multiply={id:'multiply',renderQueue:3000};return {instance:{renderOrderStatus:'mixed-queues',renderMaterials:[normal,multiply,normal]},entry:{materialBindings:{pages:[{atlas:0,page:'page-0.png',materials:{normal,multiply}}],errors:[]}},skeleton:{drawOrder:[slot(0),slot(1,2),slot(2)]}};}
test('material segments follow live blend, attachment and draw order rather than stored submesh positions',()=>{
  const layer=fixture();layer.materialMapping=compileMaterialMapping(layer);assert.equal(layer.materialMapping.reason,undefined);assert.deepEqual(skeletonDrawSegments(layer).map(row=>[row.queue,row.slots]),[[3005,[0]],[3000,[1]],[3005,[2]]]);
  layer.skeleton.drawOrder.reverse();assert.deepEqual(skeletonDrawSegments(layer).map(row=>row.slots),[[2],[1],[0]]);layer.skeleton.drawOrder[1].data.blendMode=0;assert.deepEqual(skeletonDrawSegments(layer).map(row=>row.slots),[[2,1,0]]);
  layer.skeleton.drawOrder[1].bone.active=false;assert.deepEqual(skeletonDrawSegments(layer)[0].slots,[2,0]);
});
test('unmatched source materials retain an explicit limitation and slot filters are restored after errors',()=>{
  const layer=fixture();layer.instance.renderMaterials[0]={id:'unknown',renderQueue:3005};assert.match(compileMaterialMapping(layer).reason,/do not match/);
  const previous=()=>true,target={slotFilter:previous},renderer={skeletonRenderer:target,drawSkeleton(){assert.equal(target.slotFilter(slot(1)),true);assert.equal(target.slotFilter(slot(0)),false);throw new Error('draw failed');}};assert.throws(()=>drawSkeletonSlots(renderer,{},[1]),/draw failed/);assert.equal(target.slotFilter,previous);
});
test('filtered skeleton draws preserve clipping attachments outside the selected material segment',()=>{
  const context=vm.createContext({console,Float32Array,Int16Array,Uint16Array,Uint8Array,ArrayBuffer,Math});vm.runInContext(fs.readFileSync('public/vendor/spine-webgl.js','utf8'),context);const s=context.spine;
  const atlas=new s.TextureAtlas('page.png\nsize: 20,20\nformat: RGBA8888\nfilter: Nearest,Nearest\nrepeat: none\nregion\n  rotate: false\n  xy: 0,0\n  size: 20,20\n  orig: 20,20\n  offset: 0,0\n  index: -1\n',()=>new s.FakeTexture({width:20,height:20}));
  const data=new s.SkeletonJson(new s.AtlasAttachmentLoader(atlas)).readSkeletonData({bones:[{name:'root'}],slots:[{name:'clip',bone:'root',attachment:'clip'},{name:'a',bone:'root',attachment:'a'},{name:'b',bone:'root',attachment:'b'},{name:'end',bone:'root'}],skins:[{name:'default',attachments:{clip:{clip:{type:'clipping',end:'end',vertexCount:4,vertices:[-1,-1,1,-1,1,1,-1,1]}},a:{a:{path:'region',width:4,height:4}},b:{b:{path:'region',width:4,height:4}}}}]});
  const skeleton=new s.Skeleton(data);skeleton.updateWorldTransform();const renderer=new s.webgl.SkeletonRenderer({},false),draws=[];renderer.slotFilter=slot=>slot.data.name==='b';renderer.draw({setBlendMode(){},draw(_texture,vertices){draws.push(Array.from(vertices));}},skeleton);
  assert.equal(draws.length,1);for(let i=0;i<draws[0].length;i+=8){assert.ok(Math.abs(draws[0][i])<=1+1e-6);assert.ok(Math.abs(draws[0][i+1])<=1+1e-6);}assert.equal(renderer.clipper.isClipping(),false);
});
