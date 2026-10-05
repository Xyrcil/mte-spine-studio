import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {InteractionRoot} from '../src/engine/interaction.js';
import {cardOutcomeSeeds,ControllerCheckpoint} from './controller_branches.mjs';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';

const stateLimit=Number(process.env.MTE_CONTROLLER_STATE_LIMIT||4096);
assert.ok(Number.isSafeInteger(stateLimit)&&stateLimit>0&&stateLimit<=100000,'Invalid controller state limit');
const cardBranches=cardOutcomeSeeds(seed=>InteractionRoot.prototype.randomCard.call({value:{random:seed}}));
const args=process.argv.slice(2),option=name=>{const index=args.indexOf(name);if(index<0)return;assert.ok(args[index+1]&&!args[index+1].startsWith('--'),`Missing ${name} value`);return args.splice(index,2)[1];};
const checkpointName=option('--checkpoint'),stepOption=option('--steps'),steps=stepOption===undefined?Infinity:Number(stepOption);
assert.ok(steps===Infinity&&stepOption===undefined||Number.isSafeInteger(steps)&&steps>0,'Invalid controller step count');
let checkpointPath;
if(checkpointName){checkpointPath=resolve(checkpointName);const within=relative(resolve('private'),checkpointPath);assert.ok(within&&!within.startsWith('..')&&!isAbsolute(within),'Controller checkpoints must be inside private/');}
const sourceFiles=['public/vendor/spine-webgl.js','tools/check_controllers.mjs','tools/controller_branches.mjs',...(await readdir('src/engine')).filter(name=>name.endsWith('.js')).map(name=>'src/engine/'+name)].sort();
const runtimeSource=JSON.stringify(await Promise.all(sourceFiles.map(async path=>[path,await readFile(path,'utf8')]))),checkpoint=new ControllerCheckpoint(checkpointPath,runtimeSource);await checkpoint.open();
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.exposeFunction('mteControllerStore',(operation,...values)=>{assert.ok(['begin','enqueue','next','finish','status'].includes(operation));return checkpoint[operation](...values);});
  await page.route('**/@vite/client',async route=>{const response=await route.fetch(),body=(await response.text()).replaceAll('case "update":','case "audit-disabled-update":').replaceAll('case "full-reload":','case "audit-disabled-reload":').replaceAll('case "bundled-dev-update":','case "audit-disabled-bundled-update":');await route.fulfill({response,body});});
  page.on('console',message=>{if(message.text().startsWith('[controller-check]'))console.log(message.text());});
  await page.goto(process.env.MTE_TEST_URL||'http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
  const bundles=await page.evaluate(async()=>{const catalog=await fetch('/assets/presentations.json').then(response=>response.json());return catalog.presentations.filter(presentation=>presentation.controllers.length).map(presentation=>presentation.id);});
  const selected=args.length?bundles.filter(bundle=>args.some(pattern=>bundle.includes(pattern))):bundles;assert.ok(selected.length);
  const results=[];
  for(const bundle of selected){
    const result=await page.evaluate(async({bundle,stateLimit,cardBranches,steps})=>{
      const {Stage}=await import('/src/engine/stage.js'),canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const stage=new Stage(canvas,{manual:true});stage.paused=true;
      try{
      const catalog=(await fetch('/assets/presentations.json').then(response=>response.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(response=>response.json())).entries;
      for(const group of [...stage.groups])stage.remove(group.id);
      const presentation=catalog.find(presentation=>presentation.id===bundle),group=await stage.add(presentation,entries.filter(entry=>entry.bundle===bundle)),root=group.controllers[0];
      const invalidPose=()=>group.layers.flatMap(layer=>layer.skeleton.bones.filter(bone=>['a','b','c','d','worldX','worldY','x','y','rotation','scaleX','scaleY','shearX','shearY','arotation','ax','ay','ascaleX','ascaleY','ashearX','ashearY'].some(key=>!Number.isFinite(bone[key]))).map(bone=>({layer:layer.instance.name,bone:bone.data.name,parent:bone.parent?.data.name,local:[bone.x,bone.y,bone.scaleX,bone.scaleY],parentMatrix:bone.parent&&[bone.parent.a,bone.parent.b,bone.parent.c,bone.parent.d],applied:[bone.ax,bone.ay,bone.arotation]})));
      if(invalidPose().length)return {bundle,failures:[{reason:'Non-finite initial pose',bones:invalidPose()}]};
      for(let i=0;i<3600&&root.primary?.state.getCurrent(0)?.animation.name==='start';i++)stage.evaluate(1/120);
      const key=()=>JSON.stringify({names:root.value.names,variants:Object.keys(root.value.variants).filter(name=>root.value.variants[name]).sort(),state:root.value.state,isBig:root.value.isBig,stockingDown:root.value.stockingDown,cardStage:root.value.cardStage,selectedCard:root.value.selectedCard,wins:root.value.wins,rounds:root.value.rounds,tracks:root.layers.map(layer=>layer.state.tracks.map(track=>track?{name:track.animation.name,loop:track.loop}:null))});
      const store=(operation,...values)=>window.mteControllerStore(operation,bundle,...values),status=await store('begin',JSON.stringify({presentation,entries:entries.filter(entry=>entry.bundle===bundle)}));
      if(!status.states){const initialKey=key();await store('enqueue',initialKey,stage.snapshot(),stateLimit);status.seen=[initialKey];}
      const seen=new Set(status.seen);
      const saved=status.progress||{},covered=new Set(saved.covered),gaps=new Map(saved.gaps),failures=saved.failures||[],inactive=new Set(saved.inactive),blocked=new Set(saved.blocked),cardOutcomes=new Set(saved.cardOutcomes);let transitions=saved.transitions||0,limited=false,explored=saved.explored||0,expandedThisRun=0;
      const progress=()=>({covered:[...covered],gaps:[...gaps],failures,inactive:[...inactive],blocked:[...blocked],cardOutcomes:[...cardOutcomes],transitions,explored});
      const settle=()=>{for(let i=0;i<3600&&(root.value.playing||root.value.tasks.length);i++){stage.evaluate(1/120);if(invalidPose().length)return false;}return !root.value.playing&&!root.value.tasks.length;};
      const enqueue=async()=>{const target=key();if(seen.has(target))return;const result=await store('enqueue',target,stage.snapshot(),stateLimit);if(result.limited){limited=true;throw new Error('Controller state limit reached');}seen.add(target);};
      try{while(expandedThisRun<steps){
        const next=await store('next');if(!next)break;
        const initial=next.scene;group.id=initial.objects[0].id;
        if(explored%16===0){const status=await store('status');console.log(`[controller-check] ${bundle}: ${explored} expanded, ${status.states} discovered, ${status.pending} pending`);await new Promise(resolve=>setTimeout(resolve,0));}
        for(const hit of root.hotspots)for(const branch of [18,19,20].includes(hit.event)?cardBranches:[null]){
          await stage.restore(initial,catalog,entries);
          if(branch)root.value.random=branch.seed;
          if(!group.isActiveTransform(hit.transform)){inactive.add(hit.id);continue;}
          const result=stage.triggerInteraction(group.id,root.source.id,hit.id);
          if(!result.accepted){if(result.reason.startsWith('Animation unavailable:'))gaps.set(hit.id,{hit:hit.name,reason:result.reason});else blocked.add(hit.id);if(result.unavailable)await enqueue();continue;}
          covered.add(hit.id);transitions++;
          if(!settle()){if(!failures.some(row=>row.hit===hit.name))failures.push({hit:hit.name,animation:result.animation,reason:invalidPose().length?'Non-finite animation pose':'Interaction remained locked after 30 seconds',bones:invalidPose().slice(0,2)});continue;}
          if(branch&&result.animation){cardOutcomes.add(branch.outcome);}
          await enqueue();
          if([5,102].includes(hit.event)){
            const second=stage.triggerInteraction(group.id,root.source.id,hit.id);
            if(!second.accepted){gaps.set(hit.id,{hit:hit.name,reason:second.reason});continue;}
            if(!settle())failures.push({hit:hit.name,animation:second.animation,reason:'Second variant remained locked'});else await enqueue();
          }
        }
        explored++;expandedThisRun++;await store('finish',next.key,progress());
      }}catch(error){if(!limited)throw error;}
      const final=await store('status');return {bundle,controllers:group.controllers.length,states:final.states,stateLimit,transitions,explored,pending:final.pending,complete:final.pending===0&&!limited,covered:covered.size,total:root.hotspots.length,cardOutcomes:[...cardOutcomes].sort(),limited,inactive:[...inactive],blocked:[...blocked],unreached:root.hotspots.filter(hit=>!covered.has(hit.id)).map(hit=>({name:hit.name,event:hit.event,inactive:inactive.has(hit.id)})),gaps:[...gaps.values()],failures};
      }finally{stage.dispose();stage.gl.getExtension('WEBGL_lose_context')?.loseContext();}
    },{bundle,stateLimit,cardBranches,steps:Number.isFinite(steps)?steps:1e9});
    results.push(result);console.log(JSON.stringify(result));
  }
  assert.deepEqual(errors,[]);const failures=results.flatMap(result=>result.failures.map(failure=>({bundle:result.bundle,...failure})));
  assert.equal(failures.length,0,JSON.stringify(failures.slice(0,3)));console.log('Controller check run ended', {bundles:results.length,states:results.reduce((sum,result)=>sum+result.states,0),transitions:results.reduce((sum,result)=>sum+result.transitions,0),unfinished:results.filter(result=>!result.complete).map(result=>result.bundle),limited:results.filter(result=>result.limited).map(result=>result.bundle)});
}finally{await browser.close();}
