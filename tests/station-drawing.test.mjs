import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {StationDrawingRoot,validateStationDrawingState,expandStationDrawings} from '../src/engine/station-drawing.js';
import {stationVoiceBinding} from '../src/engine/voice-catalog.js';

function fixture(pairs=[{action:'touch',expression:'happy'},{action:'sigh',expression:'sad'}]){
  const calls=[],names=['stand','smile','touch','happy','sigh','sad'];
  const layer={active:true,instance:{id:'layer',gameObject:'role',renderType:'SkeletonAnimation'},skeleton:{data:{findAnimation:name=>names.includes(name)?{name}:null}},state:{setAnimation:(track,name,loop)=>calls.push({track,name,loop})}};
  const source={id:'receiver',gameObject:'role',transform:'transform',data:{id:1,m_Enabled:1},colliders:[{type:'BoxCollider2D',data:{m_Enabled:1,m_Offset:{x:1,y:2},m_Size:{x:4,y:6}}}]};
  const group={visible:true,x:10,y:20,scale:2,rotation:0,flipX:false,flipY:false,layers:[layer],world:()=>[1,0,0,1,0,0],isActiveTransform:()=>true,presentation:{stationDrawing:{id:'1',defaultExpression:'smile',pairs}}};
  return {calls,layer,group,root:new StationDrawingRoot(group,source)};
}
test('station source initializes two independent looping tracks and uses transformed authored collider',()=>{
  const {root,calls,group}=fixture();assert.deepEqual(calls,[{track:0,name:'stand',loop:true},{track:1,name:'smile',loop:true}]);
  assert.equal(root.hitAt(12,24)?.id,'station-touch');assert.equal(root.hitAt(100,100),null);group.visible=false;assert.equal(root.hitAt(12,24),null);
});
test('station actions pair expressions, reject repeated clicks and return only on matching Complete',()=>{
  const {root,calls,layer}=fixture();const hit=root.hotspots[0];assert.equal(root.click(hit).accepted,true);const pair=root.drawing.pairs[root.value.selected];
  assert.deepEqual(calls.slice(-2),[{track:0,name:pair.action,loop:false},{track:1,name:pair.expression,loop:true}]);
  assert.equal(root.click(hit).accepted,false);root.onEvent(layer,{animation:{name:pair.action}},{data:{name:'action01'}});assert.notEqual(root.value.selected,-1);
  root.onComplete(layer,{animation:{name:pair.expression}});assert.notEqual(root.value.selected,-1);root.onComplete({}, {animation:{name:pair.action}});assert.notEqual(root.value.selected,-1);
  root.onComplete(layer,{animation:{name:pair.action}});assert.equal(root.value.selected,-1);assert.equal(calls.at(-1).name,'smile');assert.equal(root.click(hit).accepted,true);
});
test('station checkpoints retain choice stream and reject foreign or malformed choices',()=>{
  const {root,layer}=fixture();root.click(root.hotspots[0]);const saved=root.snapshot();const next=()=>{root.onComplete(layer,{animation:{name:root.drawing.pairs[root.value.selected].action}});root.click(root.hotspots[0]);return root.snapshot();};
  const expected=next();root.restore(saved);assert.deepEqual(next(),expected);
  assert.throws(()=>root.check({...saved,selected:2}),/does not match/);for(const value of [0,-1,NaN,4294967296])assert.throws(()=>validateStationDrawingState({...saved,random:value}),/Invalid/);
  layer.state.getCurrent=()=>({animation:{name:'sigh'},loop:false});root.restoreLegacy();assert.equal(root.value.selected,1);
});
test('station drawings without actions keep idle expression but do not invent a hit region',()=>{
  const {root}=fixture([]);assert.deepEqual(root.hotspots,[]);assert.equal(root.click({id:'station-touch'}).accepted,false);
});
test('station variants use explicit source identities, original resources and the same voice configuration',()=>{
  const {root,layer}=fixture(),bundle='Spines/story/actor',template={id:'Spines/drawing',nativeBehaviours:[{...root.source,class:'StationDrawingAnim'}],unassignedInstances:[layer.instance]},original={id:bundle+'/original',sourceBundle:bundle,sourceVersion:'original',origin:'original-archive'},missing={id:bundle+'/missing',sourceBundle:bundle,sourceVersion:2},ambiguous={id:bundle+'/ambiguous',sourceBundle:bundle,sourceVersion:3},unrelated={id:'unrelated',sourceBundle:'Spines/story/other'};
  const broken={id:bundle+'/broken',sourceBundle:bundle,sourceVersion:4};
  const presentations=[template,original,missing,ambiguous,unrelated,broken],before=structuredClone(presentations),drawing={...root.drawing,skeleton:{bundle,id:'base'},resource:'actor',warnings:[],peopleId:'1',gospelId:'',skinId:'',voiceIds:['line']};
  const base={id:'base',name:'actor_SkeletonData',bundle,path:'base',status:'parsed',animations:['stand','smile','touch','happy','sigh','sad'].map(name=>({name}))};
  const entries=[base,{...base,id:'original',bundle:original.id,path:'original'},{...base,bundle:missing.id,animations:base.animations.filter(row=>row.name!=='happy')},{...base,bundle:ambiguous.id},{...base,id:'duplicate',bundle:ambiguous.id},{...base,bundle:unrelated.id},{...base,bundle:broken.id,status:'error',animations:undefined}];
  const library={stationDrawings:{template:template.id,drawings:[drawing]},characters:[{id:'1',name:'Alice'}],appearances:[]},expanded=expandStationDrawings(presentations,library,entries),stations=expanded.filter(row=>row.stationDrawing),variant=stations.find(row=>row.stationVariant);
  assert.equal(stations.length,2);assert.equal(variant.stationVariant,original.id);assert.equal(variant.resourceBundle,original.id);assert.equal(variant.path,'original');assert.equal(variant.instances[0].skeletonId,'original');assert.equal(variant.stationDrawing.skeleton.id,'original');assert.equal(variant.nativeBehaviours[0].data.id,1);assert.equal(variant.origin,'original-archive');
  assert.deepEqual(stationVoiceBinding(library,{appearanceId:variant.appearanceId}),stationVoiceBinding(library,{appearanceId:'station-1'}));
  assert.ok(expanded.find(row=>row.id===missing.id).stationDrawingWarnings[0].includes('missing animation happy'));
  assert.ok(expanded.find(row=>row.id===ambiguous.id).stationDrawingWarnings[0].includes('could not be resolved'));
  assert.ok(expanded.find(row=>row.id===broken.id).stationDrawingWarnings[0].includes('could not be resolved'));
  assert.equal(expanded.find(row=>row.id===unrelated.id).stationDrawingWarnings,undefined);assert.deepEqual(presentations,before);
  const again=expandStationDrawings(expanded,library,entries);assert.deepEqual(again,expanded);assert.equal(library.appearances.length,2);
});
test('all original station drawings bind isolated templates without altering raw previews',t=>{
  if(!fs.existsSync('public/assets/library.json')){t.skip('Local game resources are not installed');return;}
  const library=JSON.parse(fs.readFileSync('public/assets/library.json')),presentations=JSON.parse(fs.readFileSync('public/assets/presentations.json')).presentations,entries=JSON.parse(fs.readFileSync('public/assets/runtime-index.json')).entries;
  const before=structuredClone(presentations),expanded=expandStationDrawings(presentations,library,entries),station=expanded.filter(row=>row.stationDrawing);
  assert.equal(station.filter(row=>!row.stationVariant).length,93);assert.equal(station.filter(row=>!row.stationVariant&&row.stationDrawing.pairs.length).length,5);assert.deepEqual(presentations,before);
  assert.equal(station.filter(row=>row.stationVariant).length,11);assert.equal(station.filter(row=>row.stationVariant&&row.stationDrawing.pairs.length).length,1);
  assert.ok(expanded.find(row=>row.id==='Spines/story/mu/original').stationDrawingWarnings[0].includes('moren'));
  assert.equal(expandStationDrawings(expanded,library,entries).length,expanded.length);
  for(const row of station){assert.equal(row.instances.length,1);assert.equal(row.resourceBundle,row.stationDrawing.skeleton.bundle);assert.equal(row.instances[0].skeletonId,row.stationDrawing.skeleton.id);assert.equal(row.nativeBehaviours[0].data.id,Number(row.stationDrawing.id));assert.equal(row.instances[0].renderMaterials,undefined);assert.ok(library.appearances.some(appearance=>appearance.id===row.appearanceId&&appearance.bundle===row.id));}
});
