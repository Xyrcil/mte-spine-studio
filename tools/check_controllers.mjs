import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {InteractionRoot} from '../src/engine/interaction.js';
import {cardOutcomeSeeds} from './controller_branches.mjs';

const stateLimit=Number(process.env.MTE_CONTROLLER_STATE_LIMIT||4096);
assert.ok(Number.isSafeInteger(stateLimit)&&stateLimit>0&&stateLimit<=100000,'Invalid controller state limit');
const cardBranches=cardOutcomeSeeds(seed=>InteractionRoot.prototype.randomCard.call({value:{random:seed}}));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/@vite/client',async route=>{const response=await route.fetch(),body=(await response.text()).replaceAll('case "update":','case "audit-disabled-update":').replaceAll('case "full-reload":','case "audit-disabled-reload":').replaceAll('case "bundled-dev-update":','case "audit-disabled-bundled-update":');await route.fulfill({response,body});});
  page.on('console',message=>{if(message.text().startsWith('[controller-check]'))console.log(message.text());});
  await page.goto(process.env.MTE_TEST_URL||'http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
  const bundles=await page.evaluate(async()=>{const catalog=await fetch('/assets/presentations.json').then(response=>response.json());return catalog.presentations.filter(presentation=>presentation.controllers.length).map(presentation=>presentation.id);});
  const patterns=process.argv.slice(2),selected=patterns.length?bundles.filter(bundle=>patterns.some(pattern=>bundle.includes(pattern))):bundles;assert.ok(selected.length);
  const results=[];
  for(const bundle of selected){
    const result=await page.evaluate(async({bundle,stateLimit,cardBranches})=>{
      const {Stage}=await import('/src/engine/stage.js'),canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const stage=new Stage(canvas,{manual:true});stage.paused=true;
      try{
      const catalog=(await fetch('/assets/presentations.json').then(response=>response.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(response=>response.json())).entries;
      for(const group of [...stage.groups])stage.remove(group.id);
      const presentation=catalog.find(presentation=>presentation.id===bundle),group=await stage.add(presentation,entries.filter(entry=>entry.bundle===bundle)),root=group.controllers[0];
      const invalidPose=()=>group.layers.flatMap(layer=>layer.skeleton.bones.filter(bone=>['a','b','c','d','worldX','worldY','x','y','rotation','scaleX','scaleY','shearX','shearY','arotation','ax','ay','ascaleX','ascaleY','ashearX','ashearY'].some(key=>!Number.isFinite(bone[key]))).map(bone=>({layer:layer.instance.name,bone:bone.data.name,parent:bone.parent?.data.name,local:[bone.x,bone.y,bone.scaleX,bone.scaleY],parentMatrix:bone.parent&&[bone.parent.a,bone.parent.b,bone.parent.c,bone.parent.d],applied:[bone.ax,bone.ay,bone.arotation]})));
      if(invalidPose().length)return {bundle,failures:[{reason:'Non-finite initial pose',bones:invalidPose()}]};
      for(let i=0;i<3600&&root.primary?.state.getCurrent(0)?.animation.name==='start';i++)stage.evaluate(1/120);
      const key=()=>JSON.stringify({names:root.value.names,variants:Object.keys(root.value.variants).filter(name=>root.value.variants[name]).sort(),state:root.value.state,isBig:root.value.isBig,stockingDown:root.value.stockingDown,cardStage:root.value.cardStage,selectedCard:root.value.selectedCard,wins:root.value.wins,rounds:root.value.rounds,tracks:root.layers.map(layer=>layer.state.tracks.map(track=>track?{name:track.animation.name,loop:track.loop}:null))});
      const queue=[stage.snapshot()],seen=new Set([key()]),covered=new Set(),gaps=new Map(),failures=[],inactive=new Set(),blocked=new Set(),cardOutcomes=new Set();let transitions=0,limited=false,explored=0;
      const settle=()=>{for(let i=0;i<3600&&(root.value.playing||root.value.tasks.length);i++){stage.evaluate(1/120);if(invalidPose().length)return false;}return !root.value.playing&&!root.value.tasks.length;};
      const enqueue=()=>{const target=key();if(!seen.has(target)){if(seen.size>=stateLimit)limited=true;else{seen.add(target);queue.push(stage.snapshot());}}};
      while(queue.length){
        if(explored++%16===0){console.log(`[controller-check] ${bundle}: ${explored-1} expanded, ${seen.size} discovered, ${queue.length} pending`);await new Promise(resolve=>setTimeout(resolve,0));}
        const initial=queue.shift();
        for(const hit of root.hotspots)for(const branch of [18,19,20].includes(hit.event)?cardBranches:[null]){
          await stage.restore(initial,catalog,entries);
          if(branch)root.value.random=branch.seed;
          if(!group.isActiveTransform(hit.transform)){inactive.add(hit.id);continue;}
          const result=stage.triggerInteraction(group.id,root.source.id,hit.id);
          if(!result.accepted){if(result.reason.startsWith('Animation unavailable:'))gaps.set(hit.id,{hit:hit.name,reason:result.reason});else blocked.add(hit.id);if(result.unavailable)enqueue();continue;}
          covered.add(hit.id);transitions++;
          if(!settle()){if(!failures.some(row=>row.hit===hit.name))failures.push({hit:hit.name,animation:result.animation,reason:invalidPose().length?'Non-finite animation pose':'Interaction remained locked after 30 seconds',bones:invalidPose().slice(0,2)});continue;}
          if(branch&&result.animation){cardOutcomes.add(branch.outcome);}
          enqueue();
          if([5,102].includes(hit.event)){
            const second=stage.triggerInteraction(group.id,root.source.id,hit.id);
            if(!second.accepted){gaps.set(hit.id,{hit:hit.name,reason:second.reason});continue;}
            if(!settle())failures.push({hit:hit.name,animation:second.animation,reason:'Second variant remained locked'});else enqueue();
          }
        }
      }
      return {bundle,controllers:group.controllers.length,states:seen.size,stateLimit,transitions,covered:covered.size,total:root.hotspots.length,cardOutcomes:[...cardOutcomes].sort(),limited,inactive:[...inactive],blocked:[...blocked],unreached:root.hotspots.filter(hit=>!covered.has(hit.id)).map(hit=>({name:hit.name,event:hit.event,inactive:inactive.has(hit.id)})),gaps:[...gaps.values()],failures};
      }finally{stage.dispose();stage.gl.getExtension('WEBGL_lose_context')?.loseContext();}
    },{bundle,stateLimit,cardBranches});
    results.push(result);console.log(JSON.stringify(result));
  }
  assert.deepEqual(errors,[]);const failures=results.flatMap(result=>result.failures.map(failure=>({bundle:result.bundle,...failure})));
  assert.equal(failures.length,0,JSON.stringify(failures.slice(0,3)));console.log('Controller checks completed', {bundles:results.length,states:results.reduce((sum,result)=>sum+result.states,0),transitions:results.reduce((sum,result)=>sum+result.transitions,0),limited:results.filter(result=>result.limited).map(result=>result.bundle)});
}finally{await browser.close();}
