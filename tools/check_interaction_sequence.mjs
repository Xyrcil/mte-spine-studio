import {selectAsset} from './select_asset.mjs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';

const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length>0);
  await selectAsset(page,'Spines/painting/301619402_spine');
  await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/painting/301619402_spine');
  const result=await page.evaluate(async()=>{
    const {InteractionRecorder,InteractionPlayer}=await import('/src/engine/interaction-sequence.js');
    const stage=window.mteStudio;stage.paused=true;window.mteAudio.stop();window.mteAudio.stopEffects();
    const presentations=(await fetch('/assets/presentations.json').then(response=>response.json())).presentations;
    const entries=(await fetch('/assets/runtime-index.json').then(response=>response.json())).entries;
    const group=stage.groups[0],root=group.controllers[0];root.reset();
    for(const layer of root.layers){layer.state.clearTracks();layer.skeleton.setToSetupPose();}
    root.play('animation',0,true);stage.evaluate(0);
    const recorder=new InteractionRecorder(stage);recorder.start();
    const invoke=name=>{const hit=root.hotspots.find(hit=>hit.name===name);return stage.triggerInteraction(group.id,root.source.id,hit.id);};
    const first=invoke('HitArea_anim_anim2');
    for(let i=0;i<1200&&root.value.playing;i++)stage.evaluate(1/120);
    stage.evaluate(.2);const second=invoke('HitArea_anim_heiban');
    for(let i=0;i<1200&&root.value.playing;i++)stage.evaluate(1/120);
    stage.evaluate(.3);const sequence=recorder.stop();recorder.dispose();
    const states=[];let invoked=0;stage.addEventListener('interaction-invoked',()=>invoked++);
    for(let run=0;run<2;run++){
      await stage.restore(sequence.initial,presentations,entries);
      const player=new InteractionPlayer(stage,sequence);stage.sequencePlayer=player;
      stage.evaluate(0);for(let i=0;i<10000&&!player.finished;i++)stage.evaluate(run===0?1/30:1/60);
      if(!player.finished)throw new Error('Sequence did not finish');
      states.push(stage.groups[0].controllers[0].snapshot());stage.sequencePlayer=null;
    }
    return {first,second,actions:sequence.actions,duration:sequence.duration,states,invoked};
  });
  assert.equal(result.first.accepted,true);assert.equal(result.second.accepted,true);assert.equal(result.actions.length,2);
  assert.equal(result.actions[0].at,0);assert.ok(result.actions[1].at>0);assert.ok(result.duration>result.actions[1].at);
  // Compare gameplay state; clock rounding may differ at sub-nanosecond scale.
  for(const state of result.states)state.clock=Math.round(state.clock*1e8)/1e8;
  assert.deepEqual(result.states[0],result.states[1]);assert.equal(result.invoked,0);assert.deepEqual(errors,[]);
  console.log('Real sequence checks passed: two state-changing interactions, time-zero action, frame-rate-independent replay');
}finally{await browser.close();}
