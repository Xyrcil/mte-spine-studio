import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolveSkillDisplay,skillPortraitSize,prepareSkillArtwork} from '../src/engine/skill-display.js';

function fixture(){return {skillDisplay:{sourceVersion:'legacy',skills:[{id:'11',name:'雷罚恶曜之眼',englishName:'EYE OF THUNDER'}],roles:[{id:'1',skillIds:['11','missing']}],stands:[{id:'1',status:'available',position:{x:.1,y:.09,z:-25},scale:{x:.2,y:.3,z:.4}}]},appearances:[{portraitResource:'UI/Image/lihui/1_lihui',portrait:{id:'portrait',path:'portraits/1.png'}}]};}
function artworkFixture(){
  return {nativeBehaviours:[{id:'receiver',class:'FightSkillUIShow',data:{imgRole:{m_FileID:0,m_PathID:'lower'},imgRoleU:{m_FileID:0,m_PathID:'upper'}}}],images:['lower','upper'].map((id,index)=>({id,transform:id+'-rect',data:{m_Color:{r:1,g:1,b:1,a:index?0:1}},sprite:null})),hierarchy:['lower','upper'].map(id=>({id:id+'-rect',type:'RectTransform',data:{m_LocalPosition:{x:90,y:101,z:0},m_AnchoredPosition:{x:95,y:104},m_AnchorMin:{x:.5,y:.5},m_AnchorMax:{x:.5,y:.5},m_LocalScale:{x:1,y:1,z:1},m_SizeDelta:{x:1,y:1}}})),skillArtwork:{receiverId:'receiver',referencePixelsPerUnit:100,portrait:{id:'portrait',path:'portraits/real.png',width:300,height:400,rect:{width:500,height:800},contentRect:{x:25,y:50,width:300,height:400},pixelsPerUnit:50},transform:{position:{x:10,y:20,z:0},scale:{x:2,y:3,z:4}}}};
}
test('skill portrait native size uses logical sprite bounds and the original canvas pixel ratio',()=>{
  const {portrait}=artworkFixture().skillArtwork;assert.deepEqual(skillPortraitSize(portrait,100),{x:1000,y:1600});assert.deepEqual(skillPortraitSize(portrait,50),{x:500,y:800});
  for(const key of ['rect','contentRect','pixelsPerUnit']){const bad=structuredClone(portrait);delete bad[key];assert.throws(()=>skillPortraitSize(bad,100),/unavailable/);}
  assert.throws(()=>skillPortraitSize(portrait,0),/unavailable/);assert.throws(()=>skillPortraitSize({...portrait,contentRect:{x:400,y:0,width:300,height:400}},100),/bounds/);
});
test('paired skill artwork binds scene-local images while retaining upper-layer animation defaults',()=>{
  const source=artworkFixture(),before=structuredClone(source),prepared=prepareSkillArtwork(source),lower=prepared.hierarchy[0].data;
  assert.deepEqual(source,before);assert.deepEqual(lower.m_SizeDelta,{x:1000,y:1600});assert.deepEqual(lower.m_LocalPosition,{x:10,y:20,z:0});assert.deepEqual(lower.m_AnchoredPosition,{x:15,y:23});assert.deepEqual(lower.m_LocalScale,{x:2,y:3,z:4});
  assert.deepEqual(prepared.hierarchy[1].data,{...before.hierarchy[1].data,m_SizeDelta:{x:1000,y:1600}});assert.equal(prepared.images[1].data.m_Color.a,0);
  for(const image of prepared.images){assert.equal(image.assetPath,'portraits/real.png');assert.equal(image.sprite.id,'portrait');assert.equal(image.status,'extracted');}
  assert.notEqual(prepared.images[0].sprite,prepared.images[1].sprite);assert.deepEqual(prepareSkillArtwork(prepared),prepared);
  assert.equal(prepareSkillArtwork({id:'ordinary'}).id,'ordinary');
});
test('dynamic skill artwork rejects unresolved receivers, external pointers and unsupported anchors',()=>{
  for(const mutate of [value=>value.skillArtwork.receiverId='absent',value=>value.nativeBehaviours[0].data.imgRole.m_FileID=1,value=>value.hierarchy[0].data.m_AnchorMax.x=1,value=>value.skillArtwork.transform.scale.x=NaN]){const source=artworkFixture();mutate(source);assert.throws(()=>prepareSkillArtwork(source));}
});
test('skill text and artwork transforms use original source rules without mutating their catalogue',()=>{
  const library=fixture(),original=structuredClone(library),value=resolveSkillDisplay(library,'1','11');assert.equal(value.firstCharacter,'雷');assert.equal(value.remainingName,'罚恶曜之眼');assert.equal(value.englishName,'EYE OF THUNDER');assert.equal(value.transform.position.x,53.800000000000004);assert.deepEqual(value.transform.position,{x:.1*538,y:0,z:0});assert.deepEqual(value.transform.scale,{x:.2*5.4,y:.3*5.4,z:.4*5.4});assert.deepEqual(value.warnings,[]);value.portrait.path='changed';assert.deepEqual(library,original);
});
test('skill display rejects unrelated skills and incompatible versions and reports missing art explicitly',()=>{
  const library=fixture();assert.throws(()=>resolveSkillDisplay(library,'1','unrelated'),/not configured/);assert.throws(()=>resolveSkillDisplay(library,'1','missing'),/text/);library.appearances=[];library.skillDisplay.stands=[];const value=resolveSkillDisplay(library,'1','11');assert.equal(value.portrait,null);assert.equal(value.transform,null);assert.equal(value.warnings.length,2);library.skillDisplay.sourceVersion='v2';assert.throws(()=>resolveSkillDisplay(library,'1','11'),/refresh/);
});
test('real legacy skill names, explicit role references and stand data remain reachable',t=>{
  if(!fs.existsSync('public/assets/library.json')){t.skip('Local game resources are not installed');return;}
  const library=JSON.parse(fs.readFileSync('public/assets/library.json')),source=library.skillDisplay;assert.equal(source.sourceVersion,'legacy');assert.equal(source.skills.length,1005);assert.equal(source.stands.length,198);
  const skills=new Set(source.skills.map(row=>row.id));let checked=0,artwork=0,transforms=0;
  for(const role of source.roles){if(role.parentId)assert.ok(source.roles.some(parent=>parent.id===role.parentId));for(const id of role.skillIds){if(!skills.has(id)){assert.ok(role.missingSkillIds.includes(id));continue;}const value=resolveSkillDisplay(library,role.id,id),name=source.skills.find(row=>row.id===id).name;assert.equal(value.firstCharacter+value.remainingName,name);assert.ok(value.transform===null||Object.values(value.transform.position).every(Number.isFinite));checked++;if(value.portrait){const size=skillPortraitSize(value.portrait,100);assert.ok(size.x>0&&size.y>0);artwork++;}if(value.transform)transforms++;}}
  assert.ok(checked>300);assert.ok(artwork>100);assert.ok(transforms>100);
});
