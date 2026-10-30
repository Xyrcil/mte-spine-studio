import test from 'node:test';
import assert from 'node:assert/strict';
import {appearancePlaybackProfile,prepareAppearancePlayback} from '../src/engine/appearance-playback.js';
import {InteractionRoot} from '../src/engine/interaction.js';

function fixture({item=123,idle=true,start=true,active=true}={}){
  const calls=[],layer={active,instance:{id:'layer'},skeleton:{data:{findAnimation:name=>(name==='animation'?idle:name==='start'?start:false)?{name,duration:2}:null},setToSetupPose(){calls.push('setup');}},state:{clearTracks(){calls.push('clear');},setAnimation(...args){calls.push(args);},addAnimation(...args){calls.push(args);}}};
  const group={kind:'spine',presentation:{id:'skin'},layers:[layer],controllers:[]},library={appearances:[{id:'12',kind:'skin',bundle:'skin',entranceItem:item}]};
  return {calls,layer,group,library};
}
test('source item gates an entrance once before the configured idle',()=>{
  const {calls,group,library}=fixture();assert.equal(appearancePlaybackProfile(library,group).available,true);
  assert.equal(prepareAppearancePlayback(library,group).entrance,true);
  assert.deepEqual(calls,['clear','setup',[0,'start',false],[0,'animation',true,0]]);
});
test('locked, disabled and unconfigured entrances use source idle; missing idle and inactive layers are untouched',()=>{
  for(const options of [{entrance:false},{unlocked:false}]){
    const {calls,group,library}=fixture();assert.equal(prepareAppearancePlayback(library,group,options).entrance,false);assert.deepEqual(calls,['clear','setup',[0,'animation',true]]);
  }
  for(const options of [{item:0},{item:undefined,start:false},{start:false}]){
    const {calls,group,library}=fixture(options);assert.equal(prepareAppearancePlayback(library,group).entrance,false);assert.deepEqual(calls,['clear','setup',[0,'animation',true]]);
  }
  for(const options of [{idle:false},{active:false}]){const {calls,group,library}=fixture(options);assert.equal(prepareAppearancePlayback(library,group).entrance,false);assert.deepEqual(calls,[]);}
});
test('variants use declared parent metadata; unrelated story and static resources keep authored playback',()=>{
  const {group,library}=fixture();library.appearances.push({id:'hx',variantOf:'12',bundle:'variant'});group.presentation.id='variant';assert.equal(appearancePlaybackProfile(library,group).entranceItem,123);
  library.appearances[0].kind='story';assert.equal(prepareAppearancePlayback(library,group).applied,false);
  library.appearances[0].kind='skin';group.kind='image';assert.equal(appearancePlaybackProfile(library,group),null);assert.equal(appearancePlaybackProfile(library,null),null);
});
test('entrance completion releases its controller gate without altering ordinary interaction locks',()=>{
  const {group,library,layer}=fixture(),events=[];
  const root=Object.assign(Object.create(InteractionRoot.prototype),{stage:{dispatchEvent:event=>events.push(event)},group:{id:'actor'},source:{id:'root',data:{}},primary:layer,initializeBackgrounds(){}});group.controllers=[root];
  prepareAppearancePlayback(library,group);assert.equal(root.value.playing,true);assert.equal(root.value.animation,'start');
  root.onComplete({}, {animation:{name:'start'}});assert.equal(root.value.playing,true);
  root.onComplete(layer,{animation:{name:'start'}});assert.equal(root.value.playing,false);assert.equal(events.length,1);
  Object.assign(root.value,{playing:true,event:100,animation:'click'});root.onComplete(layer,{animation:{name:'start'}});assert.equal(root.value.playing,true);
});
