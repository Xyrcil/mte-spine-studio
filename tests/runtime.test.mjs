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
