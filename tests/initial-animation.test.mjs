import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeAnimation} from '../src/engine/initial-animation.js';

function fixture(name='start',loop=true,hasIdle=true){const calls=[];return {calls,layer:{instance:{animation:name,loop},skeleton:{data:{findAnimation:name=>hasIdle||name!=='animation'?{name,duration:2}:null}},state:{setAnimation(index,name,loop){calls.push({index,name,loop});return {animation:{duration:2}};},addAnimation(index,name,loop,delay){calls.push({index,name,loop,delay});}}}};}
test('interactive entrance plays once and queues an available idle after its full duration',()=>{
  const value=fixture();initializeAnimation(value.layer,{interactive:true});assert.deepEqual(value.calls,[{index:0,name:'start',loop:false},{index:0,name:'animation',loop:true,delay:2}]);
});
test('standalone animation previews and sources without an idle retain their configured loop',()=>{
  for(const value of [fixture(),fixture('start',true,false)]){initializeAnimation(value.layer,{interactive:!value.layer.skeleton.data.findAnimation('animation')});assert.deepEqual(value.calls,[{index:0,name:'start',loop:true}]);}
  const value=fixture('animation3_1');initializeAnimation(value.layer,{interactive:true});assert.deepEqual(value.calls,[{index:0,name:'animation3_1',loop:true}]);
});
