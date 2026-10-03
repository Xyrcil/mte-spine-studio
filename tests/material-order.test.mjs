import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {compileMaterialMapping,skeletonDrawSegments,drawSkeletonSlots,materialTint,materialVertexColorPower,materialEffectLimitations} from '../src/engine/material-order.js';

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
  draws.length=0;skeleton.color.set(.5,.75,.25,.6);skeleton.slots[2].color.set(.5,.25,.75,.8);
  drawSkeletonSlots({skeletonRenderer:renderer,drawSkeleton(){renderer.draw({setBlendMode(){},draw(_texture,vertices){draws.push(Array.from(vertices));}},skeleton);}},skeleton,[2],undefined,2.5);
  assert.equal(draws.length,1);for(let i=0;i<draws[0].length;i+=8){for(const [channel,value] of [[2,.25**2.5],[3,(.75*.25)**2.5],[4,(.25*.75)**2.5],[5,.6*.8]])assert.ok(Math.abs(draws[0][i+channel]-value)<1e-6);}
  assert.equal(renderer.vertexEffect,null);assert.equal(renderer.clipper.isClipping(),false);
});
test('source HDR tint applies to non-mixed material pages without changing their queue',()=>{
  const layer=fixture(),color={r:4,g:4,b:4,a:.5};delete layer.instance.renderOrderStatus;layer.instance.renderQueue=3017;layer.entry.materialBindings.pages[0].materials.multiply={id:'multiply',renderQueue:3000,shader:'Spine/Blend Modes/Skeleton PMA Multiply',properties:{m_Colors:[['_Color',color]]}};
  const before=JSON.stringify(layer.entry);layer.materialMapping=compileMaterialMapping(layer);assert.equal(layer.materialMapping.tinted,true);assert.equal(layer.materialMapping.mixed,false);assert.deepEqual(skeletonDrawSegments(layer)[1],{material:'multiply',queue:3017,slots:[1],tint:color});assert.equal(JSON.stringify(layer.entry),before);
  assert.throws(()=>materialTint({...layer.entry.materialBindings.pages[0].materials.multiply,shader:'Unknown'}),/shader/);assert.throws(()=>materialTint({shader:'Spine/Blend Modes/Skeleton PMA Additive',properties:{m_Colors:[['_Color',{...color,r:Infinity}]]}}),/invalid/);
});
test('non-mixed source binding errors are reported even without resolved material pages',()=>{
  const layer=fixture();delete layer.instance.renderOrderStatus;layer.entry.materialBindings={pages:[],errors:[{atlas:0,error:'null Unity reference'}]};assert.match(compileMaterialMapping(layer).reason,/bindings are unavailable/);
});
test('material tint changes only selected draw colors and restores them even when drawing fails',()=>{
  const color={r:.2,g:.3,b:.4,a:.5},other={r:.1,g:.1,b:.1,a:1},skeleton={slots:[{color},{color:other}]},previous=()=>true,renderer={skeletonRenderer:{slotFilter:previous},drawSkeleton(){assert.deepEqual(color,{r:.8,g:1.2,b:1.6,a:.25});assert.deepEqual(other,{r:.1,g:.1,b:.1,a:1});throw new Error('draw failed');}};
  assert.throws(()=>drawSkeletonSlots(renderer,skeleton,[0],{r:4,g:4,b:4,a:.5}),/draw failed/);assert.deepEqual(color,{r:.2,g:.3,b:.4,a:.5});assert.equal(renderer.skeletonRenderer.slotFilter,previous);assert.equal(skeleton.slots[0].color,color);
});
test('vertex color power requires the active source keyword and preserves metadata and non-mixed queues',()=>{
  const layer=fixture(),material={id:'normal',renderQueue:3004,shader:'Spine/Skeleton',keywords:['_VERTEX_COLOR_POW_ON'],properties:{m_Floats:[['_VertexColorPow',2.5]]}};delete layer.instance.renderOrderStatus;layer.instance.renderQueue=3017;layer.entry.materialBindings.pages[0].materials.normal=material;
  const before=JSON.stringify(layer.entry);layer.materialMapping=compileMaterialMapping(layer);assert.equal(layer.materialMapping.colorPowered,true);assert.deepEqual(skeletonDrawSegments(layer)[0],{material:'normal',queue:3017,slots:[0],vertexColorPower:2.5});assert.equal(JSON.stringify(layer.entry),before);
  assert.equal(materialVertexColorPower({...material,keywords:[]}),undefined);assert.throws(()=>materialVertexColorPower({...material,shader:'Unknown'}),/shader/);assert.throws(()=>materialVertexColorPower({...material,properties:{m_Floats:[['_VertexColorPow',Infinity]]}}),/invalid/);
});
test('vertex color power retains alpha, chains previous effects and restores the renderer after failure',()=>{
  let previousCalls=0;const previousEffect={transform(_p,_u,color){previousCalls++;color.r*=.5;}},target={vertexEffect:previousEffect,slotFilter:null},light={r:.5,g:.25,b:.75,a:.8},renderer={skeletonRenderer:target,drawSkeleton(){target.vertexEffect.transform({}, {},light,{});throw new Error('draw failed');}};
  assert.throws(()=>drawSkeletonSlots(renderer,{},[],undefined,2.5),/draw failed/);assert.equal(previousCalls,1);assert.equal(light.r,.25**2.5);assert.equal(light.g,.25**2.5);assert.equal(light.b,.75**2.5);assert.equal(light.a,.8);assert.equal(target.vertexEffect,previousEffect);assert.equal(target.slotFilter,null);
});
test('unimplemented material effects follow source keywords without treating disabled saved settings as active',()=>{
  const entry={materialBindings:{pages:[{materials:{normal:{keywords:['_FLOW_MAP_ON','_NOISE_TEX_ON']},additive:{keywords:['_FLOW_MAP_ON']}}},{materials:{normal:{keywords:[],properties:{m_Floats:[['_NoiseTexON',1]]}}}}]}};
  assert.deepEqual(materialEffectLimitations(entry),['Flow-map distortion','Noise-texture distortion']);assert.deepEqual(materialEffectLimitations({}),[]);
});
