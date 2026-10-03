import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createNativeVisuals,preflightNativeAnimations,validateNativeAnimation,viewportDecorationMatrix,nativeImageBounds,compileNativeVectorCurve,NativeAnimation} from '../src/engine/native-visuals.js';

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
test('native receiver events preserve their cursor across restore and never fire on paused redraws',()=>{
  const source=fixture(),{group}=load(source),animation=source.visualAnimations[0],clip=structuredClone(source.visualAnimations[1]),calls=[];clip.data.m_Events=[{time:0,functionName:'Start',data:'',intParameter:0,floatParameter:0,objectReferenceParameter:{m_FileID:0,m_PathID:'0'}},{time:1,functionName:'Word',data:'original',intParameter:7,floatParameter:.5,objectReferenceParameter:{m_FileID:0,m_PathID:'0'}}];group.nativeEventHandlers=new Map([['root',new Map([['Start',event=>calls.push(event)],['Word',event=>calls.push(event)]])]]);const model=new NativeAnimation(group,animation,clip);model.advance(0);assert.equal(calls.length,0);model.advance(.5);assert.equal(calls.length,1);model.advance(.6);assert.equal(calls.length,2);assert.equal(calls[1].data,'original');assert.equal(calls[1].intParameter,7);assert.equal(calls[1].floatParameter,.5);const saved=model.snapshot();assert.equal(saved.eventCursor,2);model.restore(saved);model.advance(0);assert.equal(calls.length,2);model.advance(1);assert.equal(calls.length,3);assert.equal(calls[2].occurrence,2);const before=model.snapshot();assert.throws(()=>model.restore({...saved,eventCursor:99}),/checkpoint/);assert.deepEqual(model.snapshot(),before);assert.throws(()=>model.restore({...saved,eventCursor:undefined}),/checkpoint/);assert.throws(()=>model.advance(30000),/range/);assert.deepEqual(model.snapshot(),before);
});
test('single-play native clips restore authored defaults, stop and replay without inherited events',()=>{
  const source=fixture();source.visualAnimations[1].data.m_WrapMode=1;const {group}=load(source),model=group.nativeAnimations[0].model;assert.ok(model);model.advance(.5);model.playing=false;const paused=model.snapshot();assert.equal(paused.enabled,true);model.advance(2);assert.equal(model.time,.5);model.restore({...paused,playing:true});model.advance(2);assert.equal(model.time,0);assert.equal(model.playing,false);assert.equal(model.enabled,false);assert.equal(group.nativeImages[0].color.a,1);assert.equal(group.nodes.get('childT').data.m_AnchoredPosition.y,0);assert.equal(group.nodes.get('childT').data.m_LocalPosition.y,10);const stopped=model.snapshot(),other=load(source).group.nativeAnimations[0].model;other.restore(stopped);assert.deepEqual(other.snapshot(),stopped);model.advance(1);assert.deepEqual(model.snapshot(),stopped);model.play();assert.equal(model.enabled,true);assert.equal(model.playing,true);assert.equal(group.nativeImages[0].color.a,0);model.stop();assert.deepEqual(model.snapshot(),stopped);assert.throws(()=>model.restore({...paused,enabled:false}),/lifecycle/);
});
test('clamped native clips retain the last sample and do not turn completion into a stop',()=>{
  const source=fixture();source.visualAnimations[1].data.m_WrapMode=8;const {group}=load(source),model=group.nativeAnimations[0].model;model.advance(3);assert.equal(model.playing,true);assert.equal(group.nativeImages[0].color.a,2);assert.equal(group.nodes.get('childT').data.m_AnchoredPosition.y,2);const saved=model.snapshot(),other=load(source).group.nativeAnimations[0].model;other.restore(saved);assert.deepEqual(other.snapshot(),saved);model.stop();assert.equal(group.nativeImages[0].color.a,1);
});
test('a receiver may stop or restart a single-play native clip while its event callback runs',()=>{
  const source=fixture(),{group}=load(source),animation=source.visualAnimations[0],clip=structuredClone(source.visualAnimations[1]);clip.data.m_WrapMode=1;clip.data.m_Events=[{time:0,functionName:'Start',data:'',intParameter:0,floatParameter:0,objectReferenceParameter:{m_FileID:0,m_PathID:'0'}},{time:2,functionName:'End',data:'',intParameter:0,floatParameter:0,objectReferenceParameter:{m_FileID:0,m_PathID:'0'}}];let model,restart=false;const calls=[];group.nativeEventHandlers=new Map([['root',new Map([['Start',()=>calls.push('Start')],['End',()=>{calls.push('End');if(restart)model.play();else model.stop();}]])]]);model=new NativeAnimation(group,animation,clip);model.advance(2);assert.deepEqual(calls,['Start','End']);assert.equal(model.snapshot().eventCursor,0);assert.equal(model.enabled,false);const stopped=model.snapshot();model.restore(stopped);model.advance(2);assert.equal(calls.length,2);restart=true;model.play();model.advance(2);assert.equal(model.playing,true);assert.equal(model.time,0);assert.equal(model.snapshot().eventCursor,0);model.advance(.1);assert.deepEqual(calls,['Start','End','Start','End','Start']);
});
test('native vector, CanvasGroup and active channels restore without mutating catalogue data',()=>{
  const source=fixture(),child=source.hierarchy.find(row=>row.id==='childT');Object.assign(child.data,{m_LocalScale:{x:1,y:1,z:1},m_LocalPosition:{x:0,y:10,z:0},m_AnchoredPosition:{x:0,y:0},m_Father:{m_PathID:'rootT'}});
  source.canvasGroups=[{id:'canvas',data:{m_GameObject:{m_PathID:'root'},m_Alpha:1}}];
  const data=source.visualAnimations[1].data,vector=(from,to)=>({path:'Image',curve:{m_Curve:[{time:0,value:from,inSlope:{x:0,y:0,z:0},outSlope:{x:0,y:0,z:0}},{time:2,value:to,inSlope:{x:0,y:0,z:0},outSlope:{x:0,y:0,z:0}}]}});
  data.m_ScaleCurves=[vector({x:1,y:1,z:1},{x:3,y:2,z:1})];data.m_PositionCurves=[vector({x:3,y:20,z:0},{x:5,y:24,z:0})];data.m_EulerCurves=[vector({x:0,y:0,z:0},{x:0,y:0,z:90})];
  data.m_FloatCurves.push({path:'',attribute:'m_Alpha',classID:225,curve:{m_Curve:[{time:0,value:1},{time:2,value:0}]}},{path:'Image',attribute:'m_IsActive',classID:1,curve:{m_Curve:[{time:0,value:1},{time:2,value:0}]}});
  const original=structuredClone(source),{group}=load(source),model=group.nativeAnimations[0].model;assert.ok(model,group.nativeAnimations[0].reason);model.advance(1);
  assert.deepEqual(group.nodes.get('childT').data.m_LocalScale,{x:2,y:1.5,z:1});assert.deepEqual(group.nodes.get('childT').data.m_LocalPosition,{x:4,y:22,z:0});assert.deepEqual(group.nodes.get('childT').data.m_AnchoredPosition,{x:4,y:12});assert.equal(group.nativeCanvasGroups[0].data.m_Alpha,.5);assert.ok(Math.abs(group.nodes.get('childT').data.m_LocalRotation.z-Math.sin(Math.PI/8))<1e-9);
  const saved=model.snapshot(),other=load(source).group;other.nativeAnimations[0].model.restore(saved);assert.deepEqual(other.nodes,group.nodes);assert.deepEqual(other.nativeCanvasGroups,group.nativeCanvasGroups);model.advance(.5);assert.equal(group.nodes.get('child').data.m_IsActive,false);assert.notDeepEqual(other.nativeCanvasGroups,group.nativeCanvasGroups);assert.deepEqual(source,original);
});
test('native transform-only animation loads descendant images and rejects non-planar rotations',()=>{
  const source=fixture(),data=source.visualAnimations[1].data;source.hierarchy.find(row=>row.id==='childT').data.m_Father={m_PathID:'rootT'};
  source.hierarchy.find(row=>row.id==='rootT').data.m_LocalScale={x:1,y:1,z:1};data.m_FloatCurves=[];const vector={path:'',curve:{m_Curve:[{time:0,value:{x:1,y:1,z:1}},{time:2,value:{x:2,y:1,z:1}}]}};data.m_ScaleCurves=[vector];const loaded=load(source);assert.deepEqual(loaded.urls,['/assets/smoke.png']);assert.ok(loaded.group.nativeAnimations[0].model);
  data.m_EulerCurves=[vector];assert.match(load(source).group.nativeAnimations[0].reason,/Non-planar/);
});
test('real skill vector curves and dynamic UI component references remain available for restoration',t=>{
  if(!fs.existsSync('public/assets/presentations.json')){t.skip('Local game resources are not installed');return;}
  const skill=JSON.parse(fs.readFileSync('public/assets/presentations.json')).presentations.find(row=>row.id==='Spines/ui/fight'),clip=skill.visualAnimations.find(row=>row.type==='AnimationClip');assert.equal(clip.data.m_ScaleCurves.length,5);
  for(const row of clip.data.m_ScaleCurves){const samples=compileNativeVectorCurve(row.curve);for(const key of row.curve.m_Curve)for(let i=0;i<3;i++)assert.ok(Math.abs(samples[i](key.time)-key.value['xyz'[i]])<1e-6);for(let i=0;i<100;i++)assert.ok(samples.every(sample=>Number.isFinite(sample(i/100*1.22))));}
  assert.equal(skill.nativeText.length,4);const receiver=skill.nativeBehaviours.find(row=>row.class==='FightSkillUIShow');assert.ok(receiver);assert.ok(skill.instances.some(row=>row.id===String(receiver.data.spine.m_PathID)));assert.ok(skill.nativeText.some(row=>row.id===String(receiver.data.txtName.m_PathID)));assert.deepEqual(clip.data.m_Events.map(row=>row.functionName),['PlaySpine','PlayWord','End']);
  assert.deepEqual(skill.nativeFontAssets.map(row=>row.name).sort(),['PERTIBD','SOURCE']);for(const row of skill.nativeText){assert.equal(row.fontReference.assetId,String(row.data.m_FontData.m_Font.m_PathID));const fonts=skill.nativeFontAssets.filter(font=>font.assetId===row.fontReference.assetId&&font.serializedFile===row.fontReference.serializedFile);assert.equal(fonts.length,1);assert.ok(fonts[0].metrics.m_ShouldRoundAdvanceValue);}
});
test('real smoke clips bind both image layers while the skill event clip stays unavailable',t=>{
  if(!fs.existsSync('public/assets/presentations.json')){t.skip('Local game resources are not installed');return;}
  const presentations=JSON.parse(fs.readFileSync('public/assets/presentations.json')).presentations;
  const {group,urls}=load(presentations.find(p=>p.id==='Spines/ui/Onsen'));assert.equal(urls.length,1);assert.equal(group.nativeImages.filter(image=>image.used).length,4);assert.equal(group.nativeAnimations.length,2);
  for(const layer of group.nativeAnimations){assert.equal(layer.reason,undefined);assert.equal(layer.model.duration,2.5);layer.model.advance(1.25);for(const channel of layer.model.channels)assert.equal(channel.kind==='color'?channel.target.color.a:channel.target.data.m_AnchoredPosition.y,channel.sample(1.25));}
  const skill=load(presentations.find(p=>p.id==='Spines/ui/fight')).group;assert.ok(skill.nativeAnimations.every(layer=>layer.reason));
});
