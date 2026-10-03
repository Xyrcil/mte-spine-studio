import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {standaloneInstances,completeSkeletonInstances,materialOrdering,skeletonDisplaySettings} from '../tools/presentation_helpers.mjs';
test('unassigned source components do not block available artwork and unbound assets remain selectable',()=>{
  const entries=[{id:'one',name:'Bound',status:'parsed',skins:['default'],animations:[{name:'animation'}]},{id:'two',name:'Alternative',status:'parsed',skins:['default'],animations:[{name:'idle'}]}];
  const bound={id:'component',skeletonId:'one',status:'parsed',active:true},empty={id:'empty',skeletonId:null,status:'unassigned',name:'role2'};
  const result=completeSkeletonInstances([bound,empty],entries);assert.deepEqual(result.unassignedInstances,[empty]);assert.equal(result.instances[0],bound);assert.equal(result.instances[1].skeletonId,'two');assert.equal(result.instances[1].active,false);
  assert.deepEqual(completeSkeletonInstances([empty],[]),{instances:[],unassignedInstances:[empty]});
  const missing={id:'external',skeletonId:null,status:'missing-reference'};assert.equal(completeSkeletonInstances([missing],[]).instances[0],missing);
  assert.equal(completeSkeletonInstances([],entries).instances.filter(instance=>instance.active).length,1);
});
test('UI skeletons preserve Canvas pixel units and their own starting animation settings',()=>{
  assert.deepEqual(skeletonDisplaySettings('SkeletonGraphic',{startingAnimation:'source-start',startingLoop:false,loop:true}),{renderType:'SkeletonGraphic',canvasPixelsPerUnit:100,animation:'source-start',loop:false});
  assert.equal(skeletonDisplaySettings('SkeletonGraphic',{startingAnimation:'animation'},80).canvasPixelsPerUnit,80);
  assert.deepEqual(skeletonDisplaySettings('SkeletonAnimation',{_animationName:'idle',loop:true}),{renderType:'SkeletonAnimation',animation:'idle',loop:true});
  assert.throws(()=>skeletonDisplaySettings('SkeletonGraphic',{},0),/Canvas/);
});
test('standalone asset bundles expose every skeleton without layering variants together',()=>{
  const entries=[{id:'1',name:'Body',skins:['default'],animations:[{name:'Idle'}],status:'parsed'},{id:'2',name:'Alternative',skins:['skin'],animations:[{name:'Expression'}],status:'parsed'}];
  const instances=standaloneInstances(entries);assert.equal(instances.length,2);assert.equal(instances[0].animation,'Idle');assert.equal(instances[1].skin,'skin');assert.equal(instances.filter(instance=>instance.active).length,1);assert.equal(instances[0].transform,null);
});
test('material ordering preserves shared queues but does not guess mixed or missing materials',()=>{
  const materials=[{id:'one',renderQueue:3004},{id:'two',renderQueue:3004}];assert.deepEqual(materialOrdering({materials,errors:[]}),{renderQueue:3004,renderMaterials:materials});
  assert.equal(materialOrdering({materials:[...materials,{id:'three',renderQueue:3000}],errors:[]}).renderOrderStatus,'mixed-queues');assert.equal(materialOrdering({materials:[],errors:[{}]}).renderOrderStatus,'missing-material');assert.equal(materialOrdering({materials:[{renderQueue:null}],errors:[]}).renderOrderStatus,'unresolved');assert.deepEqual(materialOrdering(),{});
});
test('original renderer metadata covers every extracted bundle and retains mixed material queues',t=>{
  if(!fs.existsSync('public/assets/extraction.json')){t.skip('Local game resources are not installed');return;}
  const bundles=JSON.parse(fs.readFileSync('public/assets/extraction.json')).bundles;assert.equal(bundles.filter(bundle=>bundle.id.startsWith('Spines/')).length,464);assert.ok(bundles.every(bundle=>Array.isArray(bundle.renderers)));
  const presentations=JSON.parse(fs.readFileSync('public/assets/presentations.json')).presentations;assert.deepEqual(presentations.map(row=>row.id).sort(),bundles.filter(row=>row.path).map(row=>row.id).sort());
  const renderers=bundles.flatMap(bundle=>bundle.renderers);assert.equal(renderers.length,917);assert.ok(renderers.every(renderer=>renderer.errors.length===0));assert.equal(renderers.filter(renderer=>materialOrdering(renderer).renderOrderStatus==='mixed-queues').length,3);
  const instances=JSON.parse(fs.readFileSync('public/assets/presentations.json')).presentations.find(p=>p.id==='Spines/painting/3016009_spine').instances;
  assert.deepEqual(Object.fromEntries(instances.map(instance=>[instance.name,instance.renderQueue])),{role2:3003,fg1:3004,fg2:3005,bg1:3000,role1:3002});
});
