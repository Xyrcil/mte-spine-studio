import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {standaloneInstances,completeSkeletonInstances,materialOrdering,skeletonDisplaySettings} from '../tools/presentation_helpers.mjs';
test('indexed bundle paths match directory casing on case-sensitive web hosts',t=>{
  if(!fs.existsSync('public/assets/extraction.json')){t.skip('Local game resources are not installed');return;}
  for(const bundle of JSON.parse(fs.readFileSync('public/assets/extraction.json')).bundles){
    if(!bundle.path)continue;
    let directory='public/assets';
    for(const segment of bundle.path.split('/')){
      assert.ok(fs.readdirSync(directory).includes(segment),`${bundle.id}: incorrect directory casing in ${bundle.path}`);
      directory=path.join(directory,segment);
    }
  }
});
test('original CG external skeleton pointers resolve to the exported source asset',t=>{
  if(!fs.existsSync('public/assets/presentations.json')){t.skip('Local game resources are not installed');return;}
  const presentation=JSON.parse(fs.readFileSync('public/assets/presentations.json')).presentations.find(row=>row.id==='Spines/storyCG/by_1_by/by_1_by/original');
  if(!presentation){t.skip('Original external-skeleton CG is not installed');return;}
  const nodes=JSON.parse(fs.readFileSync(path.join('public/assets',presentation.path,'hierarchy.json'))),role=presentation.instances.find(instance=>instance.name==='role1'),node=nodes.find(node=>node.id===role.id);
  assert.equal(presentation.instances.length,3);assert.ok(node.data.skeletonDataAsset.m_FileID>0);
  assert.equal(role.status,'parsed');assert.equal(role.skeletonId,node.skeletonReference.assetId);
  assert.ok(nodes.find(target=>target.id===role.skeletonId)?.data.skeletonJSON);
  const entry=JSON.parse(fs.readFileSync('public/assets/runtime-index.json')).entries.find(entry=>entry.bundle===presentation.id&&entry.id===role.skeletonId);
  assert.equal(entry.status,'parsed');assert.ok(fs.existsSync(path.join('public/assets',entry.path,entry.skeleton)));
});
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
  const bundles=JSON.parse(fs.readFileSync('public/assets/extraction.json')).bundles,legacy=bundles.filter(bundle=>bundle.origin!=='original-archive');assert.equal(legacy.filter(bundle=>bundle.id.startsWith('Spines/')).length,464);assert.ok(bundles.every(bundle=>Array.isArray(bundle.renderers)));
  const presentations=JSON.parse(fs.readFileSync('public/assets/presentations.json')).presentations;assert.deepEqual(presentations.map(row=>row.id).sort(),bundles.filter(row=>row.path).map(row=>row.id).sort());
  const renderers=legacy.flatMap(bundle=>bundle.renderers);assert.equal(renderers.length,917);assert.ok(bundles.flatMap(bundle=>bundle.renderers).every(renderer=>renderer.errors.length===0));assert.equal(renderers.filter(renderer=>materialOrdering(renderer).renderOrderStatus==='mixed-queues').length,3);
  const instances=JSON.parse(fs.readFileSync('public/assets/presentations.json')).presentations.find(p=>p.id==='Spines/painting/3016009_spine').instances;
  assert.deepEqual(Object.fromEntries(instances.map(instance=>[instance.name,instance.renderQueue])),{role2:3003,fg1:3004,fg2:3005,bg1:3000,role1:3002});
});
test('station drawing catalogue preserves exact assets, source pairs and template colliders',t=>{
  if(!fs.existsSync('public/assets/library.json')){t.skip('Local game resources are not installed');return;}
  const catalogue=JSON.parse(fs.readFileSync('public/assets/library.json')).stationDrawings;
  if(!catalogue){t.skip('Local resource catalogue predates station drawing metadata');return;}
  const entries=JSON.parse(fs.readFileSync('public/assets/runtime-index.json')).entries;
  assert.equal(catalogue.schema,1);assert.equal(catalogue.drawings.length,93);
  assert.equal(new Set(catalogue.drawings.map(row=>row.id)).size,93);
  const interactive=catalogue.drawings.filter(row=>row.pairs.length);
  assert.equal(interactive.length,5);
  for(const row of catalogue.drawings){
    const entry=entries.find(entry=>entry.id===row.skeleton?.id&&entry.bundle===row.skeleton?.bundle);
    assert.ok(entry);assert.equal(entry.name,row.resource+'_SkeletonData');
    assert.equal(entry.bundle.toLowerCase(),('Spines/story/'+row.resource.replace('ui_jq_lihui_','')).toLowerCase());
    assert.equal(row.interactionStatus,row.pairs.length?'configured':'not-configured');
    assert.deepEqual(row.warnings,[]);assert.deepEqual(row.missingAnimations,[]);
    const names=new Set(entry.animations.map(animation=>animation.name));
    assert.ok(names.has('stand'));if(row.defaultExpression)assert.ok(names.has(row.defaultExpression));
    for(const pair of row.pairs){assert.ok(names.has(pair.action));assert.ok(names.has(pair.expression));}
  }
  const presentations=JSON.parse(fs.readFileSync('public/assets/presentations.json')).presentations;
  const template=presentations.find(row=>row.id===catalogue.template);
  const receiver=template.nativeBehaviours.find(row=>row.class==='StationDrawingAnim');
  assert.ok(receiver);assert.equal(receiver.data.id,0);assert.equal(receiver.data.m_Enabled,1);
  assert.equal(template.instances.length,0);assert.equal(template.unassignedInstances.length,1);
  assert.equal(template.unassignedInstances[0].gameObject,receiver.gameObject);
  assert.equal(template.unassignedInstances[0].transform,receiver.transform);
  const raw=JSON.parse(fs.readFileSync('public/assets/'+template.path+'/hierarchy.json'));
  assert.deepEqual(receiver.colliders,raw.filter(row=>row.type.endsWith('Collider2D')&&String(row.data.m_GameObject.m_PathID)===receiver.gameObject).map(({id,type,data})=>({id,type,data})));
  assert.equal(receiver.colliders.length,1);assert.equal(receiver.colliders[0].type,'BoxCollider2D');
  assert.ok(presentations.filter(row=>row.origin!=='original-archive'&&row.id!==catalogue.template).every(row=>!row.nativeBehaviours.some(receiver=>receiver.class==='StationDrawingAnim')));
  const originalTemplate=presentations.find(row=>row.id==='Spines/drawing/spinedrawprefab');if(originalTemplate){assert.equal(originalTemplate.instances.length,0);assert.equal(originalTemplate.unassignedInstances.length,1);}
});
