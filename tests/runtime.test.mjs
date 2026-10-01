import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({console,Float32Array,Int16Array,Uint16Array,Uint8Array,ArrayBuffer,Math});
vm.runInContext(fs.readFileSync('public/vendor/spine-webgl.js','utf8'),context);
const spine=context.spine;
test('atlas preserves source coordinates when texture density is reduced',()=>{
  const text='\npage.png\nsize: 100,100\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nregion\n  rotate: false\n  xy: 10,10\n  size: 80,80\n  orig: 80,80\n  offset: 0,0\n  index: -1\n';
  const atlas=new spine.TextureAtlas(text,()=>new spine.FakeTexture({width:50,height:50}));
  const region=atlas.findRegion('region');
  assert.equal(region.u,.1);assert.equal(region.u2,.9);
  const mesh=new spine.MeshAttachment('mesh');mesh.region=region;mesh.regionUVs=[0,0,1,1];mesh.updateUVs();
  assert.ok(Math.abs(mesh.uvs[0]-.1)<1e-6);assert.ok(Math.abs(mesh.uvs[2]-.9)<1e-6);
});
test('collapsed parent bones keep single and two-bone IK finite without altering zero scales',()=>{
  for(const count of [1,2]){
    const data=new spine.SkeletonJson({}).readSkeletonData({bones:[{name:'root'},{name:'collapsed',parent:'root',scaleX:0,scaleY:0},{name:'upper',parent:'collapsed',x:2,length:10},{name:'lower',parent:'upper',x:10,length:10},{name:'target',parent:'root',x:15,y:20}],ik:[{name:'aim',bones:count===1?['upper']:['upper','lower'],target:'target',mix:1}]});
    const skeleton=new spine.Skeleton(data),parent=skeleton.findBone('collapsed'),upper=skeleton.findBone('upper');skeleton.updateWorldTransform();
    assert.equal(parent.scaleX,0);assert.equal(parent.scaleY,0);upper.appliedValid=false;upper.updateAppliedTransform();
    for(const bone of skeleton.bones)for(const key of ['a','b','c','d','arotation','ax','ay'])assert.ok(Number.isFinite(bone[key]),`${count} bones: ${bone.data.name}.${key}`);
    parent.scaleX=parent.scaleY=1;skeleton.updateWorldTransform();assert.ok(Math.abs(upper.arotation)>1);
    for(const bone of skeleton.bones)for(const key of ['a','b','c','d','arotation','ax','ay'])assert.ok(Number.isFinite(bone[key]));
  }
});
