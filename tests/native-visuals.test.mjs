import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createNativeVisuals,preflightNativeAnimations,validateNativeAnimation,viewportDecorationMatrix,nativeImageBounds} from '../src/engine/native-visuals.js';

test('trimmed sprite content preserves source padding, pivot and rounded canvas dimensions',()=>{
  const sprite={rect:{width:256,height:256},contentRect:{x:4,y:24,width:243,height:205}};
  assert.deepEqual(nativeImageBounds({x:256,y:256},{x:.5,y:.5},sprite),{left:-124,bottom:-104,right:119,top:101});
  assert.deepEqual(nativeImageBounds({x:512,y:128},{x:.25,y:.75},sprite),{left:-120,bottom:-84,right:366,top:18.5});
  assert.deepEqual(nativeImageBounds({x:10,y:20},{x:0,y:1},{}),{left:-0,bottom:-20,right:10,top:0});
  assert.throws(()=>nativeImageBounds({x:1,y:1},{x:.5,y:.5},{...sprite,contentRect:{...sprite.contentRect,width:999}}),/Invalid/);
});

test('source Expand canvas scaling keeps decorations in the captured viewport during crop',()=>{
  const scaler={m_UiScaleMode:1,m_ScreenMatchMode:1,m_ReferenceResolution:{x:1920,y:1080}};
  assert.deepEqual(viewportDecorationMatrix({x:3,y:4,width:1920,height:1080},scaler),[1,0,0,1,3,4]);
  assert.deepEqual(viewportDecorationMatrix({x:3,y:4,width:960,height:1080},scaler),[.5,0,0,.5,3,4]);
  assert.deepEqual(viewportDecorationMatrix({x:3,y:4,width:3840,height:1080},scaler),[1,0,0,1,3,4]);
  assert.throws(()=>viewportDecorationMatrix({x:0,y:0,width:0,height:1},scaler),/Unsupported/);
});
test('cross-bundle native images use the app asset root rather than the character bundle',()=>{
  const presentation=fixture();presentation.images[0].assetPath='spines/interfaces/UI/Prefab/Onsen/heart.png';const {group}=load(presentation),urls=[];
  createNativeVisuals(group,'/project/assets/spines/ui/Onsen/',{loadTexture:url=>urls.push(url)},'/project/assets/');
  assert.deepEqual(urls,['/project/assets/spines/interfaces/UI/Prefab/Onsen/heart.png']);
});

function fixture(){
  const image={id:'image',gameObject:'child',transform:'childT',status:'extracted',sprite:{path:'smoke.png'},data:{m_Color:{r:1,g:1,b:1,a:1},m_Type:0,m_Script:{m_PathID:'script'}}};
  const key=(time,value)=>({time,value,inSlope:1,outSlope:1});
  const curve=(attribute,classID)=>({path:'Image',attribute,classID,script:{m_PathID:'script'},curve:{m_Curve:[key(0,0),key(2,2)]}});
  return {images:[image],visualAnimations:[{id:'animation',type:'Animation',data:{m_GameObject:{m_PathID:'root'},m_Animation:{m_PathID:'clip'},m_PlayAutomatically:true}},{id:'clip',type:'AnimationClip',data:{m_Legacy:true,m_WrapMode:2,m_FloatCurves:[curve('m_Color.a',114),curve('m_AnchoredPosition.y',224)]}}],hierarchy:[{id:'child',type:'GameObject',data:{m_Name:'Image'}},{id:'rootT',type:'RectTransform',data:{m_GameObject:{m_PathID:'root'},m_Children:[{m_PathID:'childT'}]}},{id:'childT',type:'RectTransform',data:{m_GameObject:{m_PathID:'child'},m_AnchorMin:{x:.5,y:.5},m_AnchorMax:{x:.5,y:.5},m_LocalPosition:{x:0,y:10},m_AnchoredPosition:{x:0,y:0}}}]};
}
function load(presentation){const nodes=new Map(structuredClone(presentation.hierarchy).map(node=>[node.id,node])),group={presentation,nodes,transforms:new Map([...nodes.values()].filter(node=>node.type.includes('Transform')).map(node=>[String(node.data.m_GameObject?.m_PathID),node]))},urls=[];createNativeVisuals(group,'/assets/',{loadTexture:url=>urls.push(url)});return {group,urls};}
test('native float channels follow authored time, loop and preserve anchored-position offsets',()=>{
  const source=fixture(),original=structuredClone(source),{group,urls}=load(source),model=group.nativeAnimations[0].model;
  assert.deepEqual(urls,['/assets/smoke.png']);model.advance(.5);assert.equal(group.nativeImages[0].color.a,.5);assert.equal(group.nodes.get('childT').data.m_LocalPosition.y,10.5);
  model.advance(2);assert.equal(group.nativeImages[0].color.a,.5);for(let i=0;i<100;i++)model.advance(0);assert.equal(group.nodes.get('childT').data.m_LocalPosition.y,10.5);assert.deepEqual(source,original);
});
test('native checkpoints restore independently and reject source mismatches before mutation',()=>{
  const {group}=load(fixture()),model=group.nativeAnimations[0].model;model.advance(.7);const saved=model.snapshot(),other=load(fixture()).group.nativeAnimations[0].model;other.restore(saved);assert.deepEqual(other.snapshot(),saved);
  const bad={...saved,clip:'other'};assert.throws(()=>preflightNativeAnimations(group,[bad]),/source/);assert.deepEqual(model.snapshot(),saved);assert.throws(()=>validateNativeAnimation({...saved,time:NaN}),/checkpoint/);preflightNativeAnimations(group,undefined);assert.throws(()=>preflightNativeAnimations(group,[]),/count/);
});
test('unsupported native events remain explicit and do not expose partially rendered images',()=>{
  const source=fixture();source.visualAnimations[1].data.m_Events=[{time:0,functionName:'PlaySpine'}];const {group,urls}=load(source);assert.match(group.nativeAnimations[0].reason,/events/);assert.deepEqual(urls,[]);assert.equal(group.nativeImages[0].used,false);
});
test('real smoke clips bind both image layers while the skill event clip stays unavailable',t=>{
  if(!fs.existsSync('public/assets/presentations.json')){t.skip('Local game resources are not installed');return;}
  const presentations=JSON.parse(fs.readFileSync('public/assets/presentations.json')).presentations;
  const {group,urls}=load(presentations.find(p=>p.id==='Spines/ui/Onsen'));assert.equal(urls.length,1);assert.equal(group.nativeImages.filter(image=>image.used).length,4);assert.equal(group.nativeAnimations.length,2);
  for(const layer of group.nativeAnimations){assert.equal(layer.reason,undefined);assert.equal(layer.model.duration,2.5);layer.model.advance(1.25);for(const channel of layer.model.channels)assert.equal(channel.kind==='color'?channel.target.color.a:channel.target.data.m_AnchoredPosition.y,channel.sample(1.25));}
  const skill=load(presentations.find(p=>p.id==='Spines/ui/fight')).group;assert.ok(skill.nativeAnimations.every(layer=>layer.reason));
});
