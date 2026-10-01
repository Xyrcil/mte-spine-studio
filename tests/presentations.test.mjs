import test from 'node:test';
import assert from 'node:assert/strict';
import {standaloneInstances} from '../tools/presentation_helpers.mjs';
test('standalone asset bundles expose every skeleton without layering variants together',()=>{
  const entries=[{id:'1',name:'Body',skins:['default'],animations:[{name:'Idle'}],status:'parsed'},{id:'2',name:'Alternative',skins:['skin'],animations:[{name:'Expression'}],status:'parsed'}];
  const instances=standaloneInstances(entries);assert.equal(instances.length,2);assert.equal(instances[0].animation,'Idle');assert.equal(instances[1].skin,'skin');assert.equal(instances.filter(instance=>instance.active).length,1);assert.equal(instances[0].transform,null);
});
