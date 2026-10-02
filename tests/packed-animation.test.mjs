import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {animationPathHash,compilePackedChannel,PackedAnimation} from '../src/engine/packed-animation.js';
import {createNativeVisuals,preflightNativeAnimations} from '../src/engine/native-visuals.js';

function fixture(){
  const node=(id,type,data)=>({id,type,data}),root=node('rt','RectTransform',{m_GameObject:{m_PathID:'r'},m_Children:[{m_FileID:0,m_PathID:'it'}]}),child=node('it','RectTransform',{m_GameObject:{m_PathID:'i'},m_Children:[],m_LocalScale:{x:1,y:1,z:1},m_LocalPosition:{x:3,y:10},m_AnchoredPosition:{x:0,y:0}});
  const nodes=new Map([root,child,node('i','GameObject',{m_Name:'Image',m_IsActive:true})].map(n=>[n.id,n]));
  const image={source:{gameObject:'i',data:{m_Script:{m_PathID:'script'}}},color:{a:1}};
  const channel=(typeID,attribute,component=0,value=2)=>({binding:{path:animationPathHash('Image'),typeID,attribute,script:{m_PathID:'script'}},component,kind:'constant',value});
  const clip={id:'clip',data:{packedCurves:{schema:1,start:0,stop:1,loop:false,channels:[channel(4,3,0),channel(4,4,2,90),channel(224,animationPathHash('m_AnchoredPosition.y'),0,7),channel(114,animationPathHash('m_Color.a'),0,.3),channel(1,animationPathHash('m_IsActive'),0,0)]}}};
  return {group:{nodes,transforms:new Map([['r',root],['i',child]]),nativeImages:[image]},source:{id:'animator',data:{m_GameObject:{m_PathID:'r'}}},clip};
}

test('packed polynomial coefficients retain curves and stepped boundaries without resampling',()=>{
  const sample=compilePackedChannel({kind:'polynomial',initial:2,keys:[{time:0,coeff:[1,2,3,4]},{time:1,coeff:[0,0,0,10]}]});
  assert.equal(sample(-1),2);assert.equal(sample(.5),6.125);assert.equal(sample(1),10);assert.equal(sample(1.5),10);assert.throws(()=>sample(NaN),/sample time/);
  assert.equal(compilePackedChannel({kind:'polynomial',initial:3,keys:[]})(1),3);
  const dense=compilePackedChannel({kind:'dense',begin:0,rate:1,values:[0,2,4]});assert.equal(dense(.5),1);assert.equal(dense(-1),0);assert.equal(dense(8),4);
  assert.equal(compilePackedChannel({kind:'constant',value:7})(9),7);
  assert.throws(()=>compilePackedChannel({kind:'polynomial',keys:[{time:0,coeff:[0,0,0,1]},{time:0,coeff:[0,0,0,2]}]}),/key/);
  assert.throws(()=>compilePackedChannel({kind:'dense',begin:0,rate:0,values:[1]}),/dense/);
});

test('packed targets update source scale, planar rotation, visibility, position and image opacity',()=>{
  const {group,source,clip}=fixture(),original=structuredClone(clip),model=new PackedAnimation(group,source,clip);model.play();
  const data=group.nodes.get('it').data;assert.equal(data.m_LocalScale.x,2);assert.equal(data.m_LocalPosition.y,17);assert.equal(data.m_AnchoredPosition.y,7);assert.ok(Math.abs(data.m_LocalRotation.z-Math.SQRT1_2)<1e-12);assert.equal(group.nodes.get('i').data.m_IsActive,false);assert.equal(group.nativeImages[0].color.a,.3);
  model.advance(2);assert.equal(model.time,2);model.playing=false;model.advance(.5);assert.equal(model.time,2);assert.deepEqual(clip,original);
  assert.equal(animationPathHash('Image_1/Image'),2167539220);
});

test('packed playback checkpoints replay independently and unsupported properties fail before mutation',()=>{
  const f=fixture(),model=new PackedAnimation(f.group,f.source,f.clip);model.play();model.advance(.5);const saved=model.snapshot(),other=fixture(),restored=new PackedAnimation(other.group,other.source,other.clip);restored.restore(saved);assert.deepEqual(restored.snapshot(),saved);assert.deepEqual(other.group.nodes,f.group.nodes);
  assert.throws(()=>restored.restore({...saved,clip:'wrong'}),/source/);assert.deepEqual(restored.snapshot(),saved);
  const bad=fixture(),before=structuredClone(bad.group.nodes);bad.clip.data.packedCurves.channels.push({kind:'constant',value:4,component:0,binding:{path:animationPathHash('Image'),typeID:999,attribute:1}});assert.throws(()=>new PackedAnimation(bad.group,bad.source,bad.clip),/unsupported/);assert.deepEqual(bad.group.nodes,before);
});

test('native scene pipeline loads packed image textures and preserves checkpoints',()=>{
  const {group,source,clip}=fixture(),data=group.nodes.get('it').data;data.m_AnchorMin={x:.5,y:.5};data.m_AnchorMax={x:.5,y:.5};
  const image={id:'image',gameObject:'i',transform:'it',status:'extracted',sprite:{path:'heart.png'},data:{m_Script:{m_PathID:'script'},m_Color:{r:1,g:1,b:1,a:1},m_Type:0}};
  source.type='Animation';source.data.m_Animation={m_PathID:clip.id};source.data.m_PlayAutomatically=true;clip.type='AnimationClip';group.presentation={images:[image],visualAnimations:[source,clip]};const urls=[];createNativeVisuals(group,'/assets/',{loadTexture:url=>urls.push(url)});
  const native=group.nativeAnimations[0];assert.equal(native.reason,undefined);assert.ok(native.model instanceof PackedAnimation);assert.deepEqual(urls,['/assets/heart.png']);native.model.advance(.4);preflightNativeAnimations(group,[native.model.snapshot()]);assert.equal(native.model.time,.4);assert.equal(group.nativeImages[0].used,true);
});

test('packed one-shot and looping clips sample exact boundaries and restart deterministically',()=>{
  const f=fixture();f.clip.data.packedCurves.channels[0]={...f.clip.data.packedCurves.channels[0],kind:'polynomial',keys:[{time:0,coeff:[0,0,1,1]},{time:1,coeff:[0,0,0,2]}]};
  const model=new PackedAnimation(f.group,f.source,f.clip);model.play();model.advance(1.5);assert.equal(f.group.nodes.get('it').data.m_LocalScale.x,2);model.restore({...model.snapshot(),time:.5});assert.equal(f.group.nodes.get('it').data.m_LocalScale.x,1.5);model.play();assert.equal(f.group.nodes.get('it').data.m_LocalScale.x,1);
  f.clip.data.packedCurves.loop=true;const loop=new PackedAnimation(f.group,f.source,f.clip);loop.play();loop.advance(1);assert.equal(f.group.nodes.get('it').data.m_LocalScale.x,1);loop.advance(.5);assert.equal(f.group.nodes.get('it').data.m_LocalScale.x,1.5);
});

test('packed unsupported out-of-plane rotation and ambiguous paths remain explicit',()=>{
  const f=fixture();f.clip.data.packedCurves.channels[1].component=0;assert.throws(()=>new PackedAnimation(f.group,f.source,f.clip),/Non-planar/);
  const other=fixture(),duplicate=structuredClone(other.group.nodes.get('it'));duplicate.id='duplicate';other.group.nodes.set(duplicate.id,duplicate);other.group.nodes.get('rt').data.m_Children.push({m_PathID:duplicate.id});assert.throws(()=>new PackedAnimation(other.group,other.source,other.clip),/Ambiguous/);
});

test('all ten source hot spring clips resolve and restore their original channels',t=>{
  const path='private/hot-spring-ui/spines/UI/Prefab/Onsen/hierarchy.json';if(!fs.existsSync(path)){t.skip('Local hot spring interface resources are not installed');return;}
  const hierarchy=JSON.parse(fs.readFileSync(path)),extraction=JSON.parse(fs.readFileSync('private/hot-spring-ui/extraction.json')).bundles[0],root=hierarchy.find(n=>n.type==='GameObject'&&n.data.m_Name==='OnsenLove'),source=hierarchy.find(n=>n.type==='Animator'&&n.data.m_GameObject.m_PathID===root.id),clips=hierarchy.filter(n=>n.type==='AnimationClip'&&n.data.m_Name.startsWith('ani_love'));
  assert.equal(clips.length,10);let count=0;
  const load=()=>{const nodes=new Map(structuredClone(hierarchy).map(n=>[n.id,n])),transforms=new Map([...nodes.values()].filter(n=>n.type==='RectTransform').map(n=>[n.data.m_GameObject.m_PathID,n])),group={nodes,transforms,presentation:{images:extraction.images.map(image=>({...image,transform:transforms.get(image.gameObject)?.id})),visualAnimations:[]}};createNativeVisuals(group,'/',{loadTexture(){}});return group;};
  for(const clip of clips){const group=load(),model=new PackedAnimation(group,source,clip);count+=model.channels.length;model.play();for(let i=0;i<101;i++){model.time=model.duration*i/100;model.apply();}model.time=model.duration*.37;model.apply();const saved=model.snapshot(),other=load(),restored=new PackedAnimation(other,source,clip);restored.restore(saved);assert.deepEqual(other.nodes,group.nodes);assert.deepEqual(other.nativeImages.map(x=>x.color),group.nativeImages.map(x=>x.color));model.playing=false;model.advance(1);assert.deepEqual(model.snapshot(),{...saved,playing:false});model.play();assert.equal(model.time,0);}
  assert.equal(count,526);
});
