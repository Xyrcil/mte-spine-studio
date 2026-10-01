import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {maskedParticleProfile,stretchedParticleQuad} from '../src/engine/masked-particles.js';

test('stretched quads retain authored length, sheet frame and pivot without moving the particle',()=>{
  const source={renderer:{m_LengthScale:6.5,m_Pivot:{x:0,y:0}},data:{UVModule:{tilesX:1,tilesY:2}}},particle={position:[10,20,0],velocity:[2,0,0],rotation:[0,0,0],size:[2,2,2],frame:1},before=structuredClone(particle),quad=stretchedParticleQuad(particle,source);
  assert.deepEqual(quad,[[3.5,21,0,1],[3.5,19,1,1],[16.5,19,1,.5],[16.5,21,0,.5]]);assert.deepEqual(particle,before);
  particle.velocity=[0,0,1];assert.ok(stretchedParticleQuad(particle,source).flat().every(Number.isFinite));particle.flipU=true;assert.equal(stretchedParticleQuad(particle,source)[0][2],1);
});
test('real masked material resolves its exact additive screen-mask variant',t=>{
  if(!fs.existsSync('public/assets/presentations.json')){t.skip('Local game resources are not installed');return;}
  const source=JSON.parse(fs.readFileSync('public/assets/presentations.json')).presentations.find(p=>p.id==='Spines/painting/3016009_spine').effects[0];assert.deepEqual(maskedParticleProfile(source).color,{r:1,g:1,b:1,a:1});
  const changed=structuredClone(source);changed.materials[0].keywords.push('_ADDTEX_ON');assert.throws(()=>maskedParticleProfile(changed),/variant/);changed.materials[0].keywords.pop();changed.materials[0].properties.m_Floats.push(['_MainTexAngle',30]);assert.throws(()=>maskedParticleProfile(changed),/option/);
});
