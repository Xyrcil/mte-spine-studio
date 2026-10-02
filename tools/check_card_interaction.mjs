import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {selectAsset} from './select_asset.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);await selectAsset(page,'Spines/painting/301619101_spine');await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/painting/301619101_spine');
  const result=await page.evaluate(async()=>{
    const stage=window.mteStudio;stage.paused=true;window.mteAudio.pause();stage.captureAudio=undefined;stage.applyAudio=undefined;
    const catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries;
    const {InteractionRecorder,InteractionPlayer}=await import('/src/engine/interaction-sequence.js'),{RenderSession}=await import('/src/engine/export.js'),{exportPlan}=await import('/src/engine/export-plan.js');
    const group=()=>stage.groups[0],root=()=>group().controllers[0],initial=stage.snapshot(),sounds=[],transitions=[],approaches=[];
    stage.addEventListener('sound-request',event=>sounds.push(event.detail.name));
    const check=(condition,label)=>{if(!condition)throw new Error(label);};
    const checkState=(actual,expected,label)=>{check(Math.abs(actual.clock-expected.clock)<1e-9,`${label}: controller clock`);check(JSON.stringify({...actual,clock:0})===JSON.stringify({...expected,clock:0}),label);};
    const step=n=>{for(let i=0;i<n;i++)stage.evaluate(1/120);};
    const settle=()=>{let steps=0;while(root().value.playing||root().value.tasks.length){step(1);if(++steps>6000)throw new Error('Card interaction remained locked');}return steps;};
    const click=event=>{const hit=root().hotspots.find(hit=>hit.event===event&&group().isActiveTransform(hit.transform));check(hit,`Active region missing: ${event}`);const result=stage.triggerInteraction(group().id,root().source.id,hit.id);check(result.accepted,`${event}: ${result.reason}`);return result;};
    const peekCard=()=>{const value=root().value.random,card=root().randomCard();root().value.random=value;return card;};
    const enterRisk=async variant=>{await stage.restore(initial,catalog,entries);click(9);settle();check(root().value.state===1,'Door did not enter risk state');if(variant===2){click(6);settle();}};
    const enter=async variant=>{await enterRisk(variant);click(17);settle();check(root().value.state===3,'Game mode did not open');check(root().layers.every(layer=>layer.state.getCurrent(0).animation.name===`animation4_${variant}`),'Wrong clothing idle or unsynchronized skeleton');};
    for(const variant of [1,2]){
      await enterRisk(variant);const recorder=new InteractionRecorder(stage);recorder.start();
      const clock=root().value.clock,invoked=click(8),first=root().layers.find(layer=>layer.skeleton.data.findAnimation(invoked.animation)),duration=first.skeleton.data.findAnimation(invoked.animation).duration;
      check(invoked.animation===`stand_down${variant}`,'Approach used wrong clothing variant');
      check(Math.abs(root().value.tasks.find(task=>task.kind==='approach').due-clock-duration)<1e-9,'Approach timer did not use first source skeleton');
      step(Math.max(1,Math.floor(duration*60)));const checkpoint=stage.snapshot();check(root().value.playing,'Approach ended before its source duration');settle();const focused=root().snapshot();
      check(root().value.isBig,'Approach did not enter focused state');check(root().layers.every(layer=>layer.state.getCurrent(0).animation.name===`animation3_${variant}`),'Focused skeletons diverged');
      click(15);settle();check(!root().value.isBig,'Return did not leave focused state');check(root().layers.every(layer=>layer.state.getCurrent(0).animation.name===`animation1_${variant}`),'Return used wrong idle');
      const final=root().snapshot(),sequence=recorder.stop();recorder.dispose();
      await stage.restore(checkpoint,catalog,entries);settle();checkState(root().snapshot(),focused,'Mid-approach checkpoint diverged');
      await stage.restore(sequence.initial,catalog,entries);const player=new InteractionPlayer(stage,sequence,{notifyEnd:false});player.advance(sequence.duration,delta=>stage.evaluateFrame(delta));checkState(root().snapshot(),final,'Approach/return replay diverged');
      const plan=exportPlan({width:160,height:120,fps:25,start:0,end:sequence.duration,speed:1,loops:1,loopMode:'repeat',useSequence:true,format:'png',background:'#191b20',fit:'contain',crop:{x:0,y:0,width:1,height:1}},1),session=new RenderSession({...stage.snapshot(),sequence},catalog,entries,stage.imageAssets,stage.canvas.width/stage.canvas.height,plan);
      try{await session.initialize();await session.seek(sequence.duration);checkState(session.stage.groups[0].controllers[0].snapshot(),final,'Approach export diverged');await session.seek(0);await session.seek(sequence.duration);checkState(session.stage.groups[0].controllers[0].snapshot(),final,'Backward approach export diverged');}finally{session.dispose();}
      approaches.push({variant,duration,checkpoint:true,replay:true,export:true});
    }
    for(const variant of [1,2])for(const won of [true,false]){
      await enter(variant);const recorder=new InteractionRecorder(stage);recorder.start();const rounds=won?2:3;
      for(let round=0;round<rounds;round++){
        if(root().value.cardStage){check(click(18).animation==='','First click did not dismiss old card overlays');check([2,3,4].every(track=>!root().primary.state.getCurrent(track)),'Dismiss did not clear overlays');}
        click(18+(peekCard()+(won?0:1))%3);settle();check(root().value.cardClickable,'Card input did not unlock');transitions.push({variant,won,round:round+1,wins:root().value.wins,rounds:root().value.rounds});
      }
      check(root().value.wins===0&&root().value.rounds===0,'Terminal result did not reset score');check(root().layers.every(layer=>layer.state.getCurrent(3)&&layer.state.getCurrent(4)),'Terminal result discarded source overlays');
      const sequence=recorder.stop();recorder.dispose();const final=root().snapshot();
      await stage.restore(sequence.initial,catalog,entries);const player=new InteractionPlayer(stage,sequence,{notifyEnd:false});player.advance(sequence.duration,delta=>stage.evaluateFrame(delta));checkState(root().snapshot(),final,'Recorded card result diverged');
      const plan=exportPlan({width:160,height:120,fps:10,start:0,end:sequence.duration,speed:1,loops:1,loopMode:'repeat',useSequence:true,format:'png',background:'#191b20',fit:'contain',crop:{x:0,y:0,width:1,height:1}},1),session=new RenderSession({...stage.snapshot(),sequence},catalog,entries,stage.imageAssets,stage.canvas.width/stage.canvas.height,plan);
      try{
        await session.initialize();await session.seek(sequence.duration);
        checkState(session.stage.groups[0].controllers[0].snapshot(),final,'Export card state diverged');
        const pixels=()=>{const gl=session.stage.gl,data=new Uint8Array(160*120*4);gl.readPixels(0,0,160,120,gl.RGBA,gl.UNSIGNED_BYTE,data);check(gl.getError()===gl.NO_ERROR,'Export WebGL error');return data;},before=pixels();
        await session.seek(0);await session.seek(sequence.duration);
        checkState(session.stage.groups[0].controllers[0].snapshot(),final,'Backward export seeking changed result');
        const after=pixels();check(before.every((value,index)=>Math.abs(value-after[index])<=1),'Backward export seeking changed pixels');
        if(variant===1&&won)for(const fps of [25,29.97]){
          await session.initialize();for(let time=0;time<sequence.duration;time+=1/fps)await session.seek(time);await session.seek(sequence.duration);
          checkState(session.stage.groups[0].controllers[0].snapshot(),final,`${fps} FPS card state diverged`);
        }
      }catch(error){throw new Error(`${error.message}; ${JSON.stringify({variant,won,actions:sequence.actions,clock:session.stage.groups[0].controllers[0].value.clock,tasks:session.stage.groups[0].controllers[0].value.tasks})}`);}
      finally{session.dispose();}
    }
    await enter(1);click(18+peekCard());while(!root().value.tasks.some(task=>task.kind==='card-result'))step(1);
    const checkpoint=stage.snapshot();step(900);const future=root().snapshot();await stage.restore(checkpoint,catalog,entries);step(900);checkState(root().snapshot(),future,'Mid-reveal scene restore diverged');
    check(sounds.some(name=>name.endsWith('_game_win'))&&sounds.some(name=>name.endsWith('_game_lose')),'Terminal sounds missing');check(sounds.some(name=>name.endsWith('_card_click'))&&sounds.some(name=>name.endsWith('_card_cancel')),'Card selection and dismissal sounds missing');
    check(click(17).animation==='','Game exit click did not dismiss the previous result first');check(root().value.state===3,'Dismissal unexpectedly exited game mode');click(17);settle();check(root().value.state===1,'Game exit did not restore risk state');check([2,3,4].every(track=>!root().primary.state.getCurrent(track)),'Game exit did not clear card tracks');
    return {layers:group().layers.length,approaches,transitions,soundNames:[...new Set(sounds)],midRevealRestore:true,sequenceReplay:true,independentExport:true};
  });
  assert.equal(result.layers,6);assert.equal(result.transitions.length,10);assert.deepEqual(errors,[]);console.log('Real card checks passed: both clothing variants, wins/losses, retained/dismissed overlays, sounds, mid-reveal restore, sequence replay, independent export seeking and game exit',result);
}finally{await browser.close();}
