import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolveSkillDisplay} from '../src/engine/skill-display.js';

function fixture(){return {skillDisplay:{sourceVersion:'legacy',skills:[{id:'11',name:'雷罚恶曜之眼',englishName:'EYE OF THUNDER'}],roles:[{id:'1',skillIds:['11','missing']}],stands:[{id:'1',status:'available',position:{x:.1,y:.09,z:-25},scale:{x:.2,y:.3,z:.4}}]},appearances:[{portraitResource:'UI/Image/lihui/1_lihui',portrait:{id:'portrait',path:'portraits/1.png'}}]};}
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
  for(const role of source.roles){if(role.parentId)assert.ok(source.roles.some(parent=>parent.id===role.parentId));for(const id of role.skillIds){if(!skills.has(id)){assert.ok(role.missingSkillIds.includes(id));continue;}const value=resolveSkillDisplay(library,role.id,id),name=source.skills.find(row=>row.id===id).name;assert.equal(value.firstCharacter+value.remainingName,name);assert.ok(value.transform===null||Object.values(value.transform.position).every(Number.isFinite));checked++;if(value.portrait)artwork++;if(value.transform)transforms++;}}
  assert.ok(checked>300);assert.ok(artwork>100);assert.ok(transforms>100);
});
