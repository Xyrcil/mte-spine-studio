import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ParticleSystem} from '../src/engine/particles.js';

const constant=value=>({minMaxState:0,scalar:value});
const color={minMaxState:0,maxColor:{r:1,g:1,b:1,a:1}};
function fixture(change={}){return {id:'test',sprites:[],data:{lengthInSec:1,simulationSpeed:1,looping:true,prewarm:false,moveWithTransform:0,startDelay:constant(0),InitialModule:{enabled:true,startLifetime:constant(2),startSpeed:constant(1),startSize:constant(1),startRotation:constant(0),startColor:color,maxNumParticles:10},EmissionModule:{enabled:true,rateOverTime:constant(2),rateOverDistance:constant(0),m_Bursts:[]},...change}};}
const model=source=>new ParticleSystem(source||fixture(),{seed:7});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('continuous emission has exact birth times and partial-frame views do not advance random state',()=>{
  const value=model();value.advance(.51);const before=value.snapshot(),particles=value.view();assert.equal(particles.length,1);near(particles[0].birth,.5);near(particles[0].position[2],.01);assert.deepEqual(value.snapshot(),before);assert.deepEqual(value.view(),particles);
  value.advance(.49);assert.equal(value.view().length,2);near(value.view()[1].birth,1);
});
test('particle motion integrates authored acceleration rather than changing velocity alone',()=>{
  const value=model(fixture({ForceModule:{enabled:true,x:constant(0),y:constant(-2),z:constant(0)}}));value.advance(1.5);const particle=value.view()[0];near(particle.birth,.5);near(particle.position[1],-1);near(particle.velocity[1],-2);near(particle.position[2],1);
});
test('prewarm simulates one complete loop and does not force a full lifetime equilibrium',()=>{
  const value=model(fixture({prewarm:true}));assert.equal(value.view().length,2);near(value.state.clock,1);near(value.view()[0].position[2],.5);
});
test('different display frame partitions share the same canonical particle state',()=>{
  const a=model(),b=model();for(let i=0;i<30;i++)a.advance(1/30);for(let i=0;i<60;i++)b.advance(1/60);assert.deepEqual(a.snapshot(),b.snapshot());assert.deepEqual(a.view(),b.view());
});
test('checkpoints recover future emission, positions and the random stream in a fresh instance',()=>{
  const original=model();original.advance(.713);const snapshot=original.snapshot(),restored=new ParticleSystem(fixture(),{seed:123});restored.restore(snapshot);assert.deepEqual(restored.view(),original.view());
  original.advance(.25);restored.advance(.25);assert.deepEqual(restored.snapshot(),original.snapshot());
  const bad=structuredClone(snapshot);bad.state.clock=NaN;assert.throws(()=>restored.restore(bad),/clocks/);assert.deepEqual(restored.snapshot(),original.snapshot());
});
test('source capacity, lifetime expiry, start delay and nonlooping emission are retained',()=>{
  const capped=fixture();capped.data.InitialModule.maxNumParticles=1;const value=model(capped);value.advance(1.5);assert.equal(value.view().length,1);
  const oneShot=model(fixture({looping:false,startDelay:constant(.25)}));oneShot.advance(.7);assert.equal(oneShot.view().length,0);oneShot.advance(.55);assert.equal(oneShot.view().length,2);oneShot.advance(3);assert.equal(oneShot.view().length,0);
});
test('edge and box source shapes retain authored geometry and rotations',()=>{
  const edge=model(fixture({ShapeModule:{enabled:true,type:12,radius:{value:8,mode:0},m_Position:{x:0,y:7,z:0},m_Rotation:{x:180,y:0,z:0},m_Scale:{x:1,y:1,z:1}}}));edge.advance(.5);const first=edge.view()[0];assert.ok(Math.abs(first.position[0])<=8);near(first.position[1],7);near(first.velocity[1],-1);near(first.velocity[2],0);
  const box=model(fixture({ShapeModule:{enabled:true,type:5,m_Rotation:{x:0,y:-90,z:0},m_Scale:{x:0,y:0,z:0}}}));box.advance(.75);near(box.view()[0].position[0],-.25);
});
test('world simulation does not move old particles when the emitter moves',()=>{
  let offset=10;const value=new ParticleSystem(fixture(),{seed:7,transform:(vector,point)=>[vector[0]+(point?offset:0),vector[1],vector[2]]});value.advance(.5);offset=20;value.advance(.5);const particles=value.view();near(particles[0].position[0],10);near(particles[1].position[0],20);
});
test('unsupported enabled modules fail explicitly instead of being silently ignored',()=>{
  assert.throws(()=>model(fixture({NoiseModule:{enabled:true}})),/NoiseModule/);assert.throws(()=>model(fixture({ShapeModule:{enabled:true,type:4}})),/shape/);
});
test('all five original particle systems simulate and restore with finite values',t=>{
  if(!fs.existsSync('public/assets/presentations.json')){t.skip('Local game resources are not installed');return;}
  const effects=JSON.parse(fs.readFileSync('public/assets/presentations.json')).presentations.flatMap(p=>p.effects||[]);assert.equal(effects.length,5);
  for(const effect of effects){const value=model(effect);assert.ok(value.view().length>0);value.advance(.713);const restored=model(effect);restored.restore(value.snapshot());assert.deepEqual(restored.view(),value.view());value.advance(1);restored.advance(1);assert.deepEqual(restored.snapshot(),value.snapshot());for(const particle of value.view())assert.ok([...particle.position,...particle.velocity,...particle.rotation,...particle.size,...particle.color,particle.age,particle.frame].every(Number.isFinite));}
});
