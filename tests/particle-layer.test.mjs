import test from 'node:test';
import assert from 'node:assert/strict';
import {createParticleLayers,particleOrder,hierarchyOrder,compareHierarchy,preflightParticles} from '../src/engine/particle-layer.js';

const constant=scalar=>({minMaxState:0,scalar});
function effect(id,shader='Legacy Shaders/Particles/Alpha Blended'){
  return {id,gameObject:'child',transform:'childT',status:'extracted',sprites:[{path:'petal.png'}],materials:[{shader,properties:{}}],renderer:{m_RenderMode:0,m_SortingOrder:1},data:{lengthInSec:1,simulationSpeed:1,looping:true,moveWithTransform:0,startDelay:constant(0),InitialModule:{enabled:true,startLifetime:constant(1),startSpeed:constant(0),startSize:constant(1),startRotation:constant(0),startColor:{minMaxState:0,maxColor:{r:1,g:1,b:1,a:1}},maxNumParticles:10},EmissionModule:{enabled:true,rateOverTime:constant(2),rateOverDistance:constant(0),m_Bursts:[]}}};
}
function group(effects=[]){
  const root={id:'rootT',data:{m_GameObject:{m_PathID:'root'},m_Children:[{m_PathID:'childT'},{m_PathID:'otherT'}]}},child={id:'childT',data:{m_GameObject:{m_PathID:'child'},m_Father:{m_PathID:'rootT'}}},other={id:'otherT',data:{m_GameObject:{m_PathID:'other'},m_Father:{m_PathID:'rootT'}}};
  return {presentation:{effects,sortingGroups:[]},scale:1,x:0,y:0,world:()=>[1,0,0,1,0,0],nodes:new Map([root,child,other].map(node=>[node.id,node])),transforms:new Map([['root',root],['child',child],['other',other]])};
}
test('supported sprite textures load once while custom materials retain an explicit limitation',()=>{
  const requested=[],value=group([effect('one'),effect('two'),effect('custom','AOI/Effect/AOI_Effect_UrpV2')]);
  value.effects=createParticleLayers(value,'/assets/',{loadTexture:url=>requested.push(url)});
  assert.deepEqual(requested,['/assets/petal.png']);assert.equal(value.effects[0].reason,undefined);assert.ok(value.effects[2].reason.includes('not supported'));assert.ok(value.effects[2].model);assert.deepEqual(value.effects[2].textures,[]);
});
test('particle sorting inherits the nearest enabled sorting group',()=>{
  const value=group(),source=effect('one');value.presentation.sortingGroups=[{data:{m_Enabled:false,m_GameObject:{m_PathID:'child'},m_SortingOrder:99}},{data:{m_Enabled:1,m_GameObject:{m_PathID:'root'},m_SortingOrder:4}}];
  assert.equal(particleOrder(value,source),4);value.presentation.sortingGroups=[];assert.equal(particleOrder(value,source),1);
  value.nodes.get('rootT').data.m_Father={m_PathID:'childT'};assert.throws(()=>particleOrder(value,source),/Cyclic/);
});
test('equal draw orders follow original sibling hierarchy and reject cycles',()=>{
  const value=group();assert.deepEqual(hierarchyOrder(value,'childT'),[0]);assert.deepEqual(hierarchyOrder(value,'otherT'),[1]);assert.ok(compareHierarchy([0],[1])<0);assert.ok(compareHierarchy([0],[0,1])<0);
  value.nodes.get('rootT').data.m_Father={m_PathID:'childT'};assert.throws(()=>hierarchyOrder(value,'childT'),/Cyclic/);
});
test('particle restore preflight accepts legacy scenes but rejects missing and repeated sources',()=>{
  const value=group([effect('one'),effect('two')]);value.effects=createParticleLayers(value,'/assets/',{loadTexture(){}});const saved=value.effects.map(layer=>layer.model.snapshot());
  preflightParticles(value,undefined);preflightParticles(value,saved);assert.throws(()=>preflightParticles(value,[]),/count/);assert.throws(()=>preflightParticles(value,[saved[0],saved[0]]),/Duplicate/);
  const bad=structuredClone(saved);bad[1].id='unknown';assert.throws(()=>preflightParticles(value,bad),/unavailable/);assert.deepEqual(value.effects.map(layer=>layer.model.snapshot()),saved);
});
