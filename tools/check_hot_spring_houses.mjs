import assert from 'node:assert/strict';
import {chromium,webkit,firefox} from '@playwright/test';
import {selectAsset} from './select_asset.mjs';
const engine=process.argv[2]||'chromium',type={chromium,webkit,firefox}[engine];assert.ok(type,'Choose chromium, webkit or firefox');
const browser=await type.launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
  const houses=await page.evaluate(async()=>{const library=await fetch('/assets/library.json').then(r=>r.json());return library.hotSpringHouses;});assert.equal(houses.length,3);
  for(const house of houses){
    const id=`${house.bundle}/${house.id}`;await selectAsset(page,id);await page.waitForFunction(id=>window.mteStudio.groups[0]?.presentation.id===id,id);
    const result=await page.evaluate(async()=>{
      const stage=window.mteStudio,group=stage.groups[0];stage.paused=true;
      const library=await fetch('/assets/library.json').then(r=>r.json()),catalog=await fetch('/assets/presentations.json').then(r=>r.json()),entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries,{expandHotSpringPresentations}=await import('/src/engine/hot-spring.js'),presentations=expandHotSpringPresentations(catalog.presentations,library.hotSpringHouses,library.hotSpringRoles);
      const snapshot=stage.snapshot();await stage.restore(snapshot,presentations,entries);const restored=stage.snapshot(),root=group.controllers.find(root=>root.source.id==='hot-spring'),conversations=[];let lastSequence;
      if(!root)throw new Error('Hot spring controller unavailable');
      const {InteractionRecorder,InteractionPlayer}=await import('/src/engine/interaction-sequence.js');
      for(const role of root.roles)for(const level of [1,2,3,4,5]){
        await stage.restore(snapshot,presentations,entries);root.value.levels[role.id]=level;const recorder=new InteractionRecorder(stage);recorder.start();
        const hit=root.hotspots.find(hit=>hit.id===role.id),result=stage.triggerInteraction(group.id,root.source.id,hit.id);if(!result.accepted)throw new Error(result.reason);
        for(let i=0;i<60;i++)stage.evaluate(1/120);const middle=stage.snapshot();for(let i=0;i<60;i++)stage.evaluate(1/120);const focused=root.snapshot();
        if(focused.phase!=='dialogue'||!role.levels.find(pool=>pool.level===level).voiceIds.includes(focused.voiceId))throw new Error('Wrong conversation pool');
        for(let i=0;i<36;i++)stage.evaluate(1/120);const ended=stage.triggerInteraction(group.id,root.source.id,'continue');if(!ended.accepted)throw new Error(ended.reason);for(let i=0;i<120;i++)stage.evaluate(1/120);const final=root.snapshot(),sequence=recorder.stop();recorder.dispose();lastSequence=sequence;
        await stage.restore(middle,presentations,entries);for(let i=0;i<60;i++)stage.evaluate(1/120);if(JSON.stringify(root.snapshot())!==JSON.stringify(focused))throw new Error('Mid-focus restore diverged');
        await stage.restore(sequence.initial,presentations,entries);const player=new InteractionPlayer(stage,sequence,{notifyEnd:false});player.advance(sequence.duration,delta=>stage.evaluateFrame(delta));if(JSON.stringify(root.snapshot())!==JSON.stringify(final))throw new Error('Conversation replay diverged');
        conversations.push({role:role.id,level,voice:focused.voiceId});
      }
      await stage.restore(snapshot,presentations,entries);
      const {RenderSession,collectInteractionEffects}=await import('/src/engine/export.js'),{interactionExportProvider}=await import('/src/engine/interaction-export.js'),{exportPlan}=await import('/src/engine/export-plan.js'),plan=exportPlan({useSequence:true,format:'webm',width:160,height:120,fps:10,start:0,end:lastSequence.duration,speed:1,loops:1,loopMode:'repeat',background:'#191b20',fit:'contain',crop:{x:0,y:0,width:1,height:1}}),session=new RenderSession({...snapshot,sequence:lastSequence},presentations,entries,stage.imageAssets,stage.canvas.width/stage.canvas.height,plan);
      let exported;try{
        await session.initialize();await session.seek(.5);if(session.stage.groups[0].controllers.at(-1).value.phase!=='focusing')throw new Error('Export lost focus transition');
        await session.seek(1.1);if(session.stage.groups[0].controllers.at(-1).value.phase!=='dialogue')throw new Error('Export lost conversation');
        await session.seek(lastSequence.duration);await session.seek(.25);await session.seek(lastSequence.duration);if(session.stage.groups[0].controllers.at(-1).value.phase!=='idle')throw new Error('Backward export lost return');
        await session.initialize();const analysis=await collectInteractionEffects(session,plan,null,()=>{},interactionExportProvider(library,window.mteAudio,lastSequence.initial));
        if(analysis.voices.length!==1||Math.abs(analysis.voices[0].until-1.3)>1e-8)throw new Error(`Export voice stop diverged: ${JSON.stringify({voices:analysis.voices,stops:analysis.stops,warnings:analysis.warnings})}`);
        exported=session.stage.groups[0].presentation.id;if(session.stage.gl.getError()!==session.stage.gl.NO_ERROR)throw new Error('Export graphics error');
      }finally{session.dispose();}
      const mediaChecks=[];
      {
        const {exportMedia}=await import('/src/engine/export.js'),{Input,BlobSource,ALL_FORMATS,AudioSampleSink,VideoSampleSink}=await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs'),sequence=structuredClone(lastSequence);
        sequence.actions.at(-1).at=2.2;sequence.duration=3.2;
        const audio=window.mteAudio,provider=interactionExportProvider(library,audio,sequence.initial,{includeSubtitles:false}),voice=library.voices.find(row=>row.id===conversations.at(-1).voice),clip=audio.resolve(voice.resourceName,sequence.initial.audio.language),context=new AudioContext({sampleRate:48000});
        const reference=await context.decodeAudioData(await (await fetch(audio.base+clip.path)).arrayBuffer());
        const render=new RenderSession({...snapshot,sequence},presentations,entries,stage.imageAssets,stage.canvas.width/stage.canvas.height,{...plan,end:3.2}),expectedFrames=[];
        try{await render.initialize();for(const at of [0,1.1]){await render.seek(at);const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;const ctx=canvas.getContext('2d');ctx.drawImage(render.canvas,0,0);expectedFrames.push(ctx.getImageData(0,0,160,120).data);}}finally{render.dispose();}
        try{for(const format of ['mp4','webm']){
          const media=await exportMedia({scene:{...snapshot,sequence},catalog:presentations,entries,imageAssets:stage.imageAssets,sourceAspect:stage.canvas.width/stage.canvas.height,settings:{format,useSequence:true,width:160,height:120,fps:10,start:0,end:3.2,speed:1,loops:1,loopMode:'repeat',background:'#191b20',fit:'contain',crop:{x:0,y:0,width:1,height:1}},interactionProvider:provider});
          if(!media.warnings.includes('Original hot spring dialogue decorations are not rendered'))throw new Error('Missing conversation decoration notice');
          const input=new Input({source:new BlobSource(media.blob),formats:ALL_FORMATS});
          try{
            const video=await input.getPrimaryVideoTrack(),track=await input.getPrimaryAudioTrack();if(!video||!track)throw new Error(`${format}: media tracks missing`);
            const pcm=new Float32Array(4*48000);for await(const sample of new AudioSampleSink(track).samples()){try{const data=sample.toAudioBuffer().getChannelData(0),start=Math.round(sample.timestamp*48000),skip=Math.max(0,-start),target=Math.max(0,start);if(target<pcm.length)pcm.set(data.subarray(skip,skip+pcm.length-target),target);}finally{sample.close();}}
            const rms=(a,b)=>{const data=pcm.subarray(Math.round(a*48000),Math.round(b*48000));return Math.sqrt(data.reduce((sum,value)=>sum+value*value,0)/data.length);};
            const source=reference.getChannelData(0);let energy=0,error=0;for(let index=Math.round(1.2*48000);index<Math.round(2.05*48000);index++){const at=(index/48000-1)*reference.sampleRate,base=Math.floor(at),fraction=at-base,value=((source[base]||0)*(1-fraction)+(source[base+1]||0)*fraction)*sequence.initial.audio.voiceVolume;energy+=value*value;error+=(value-pcm[index])**2;}
            const sink=new VideoSampleSink(video),frames=[];for(const at of [0,1.1]){const sample=await sink.getSample(at);if(!sample)throw new Error(`${format}: video decoding failed`);try{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;const ctx=canvas.getContext('2d');sample.draw(ctx,0,0,160,120);frames.push(ctx.getImageData(0,0,160,120).data);}finally{sample.close();}}
            const changed=frames[0].reduce((sum,value,index)=>sum+Number(Math.abs(value-frames[1][index])>8),0),difference=Math.sqrt(error/energy),pixelErrors=frames.map((frame,i)=>frame.reduce((sum,value,index)=>sum+Math.abs(value-expectedFrames[i][index]),0)/frame.length);
            if(rms(1.2,2.05)<.0005||rms(0,.8)>.001||rms(2.4,3.1)>.001||!Number.isFinite(difference)||difference>.35||changed<100||pixelErrors.some(error=>error>8))throw new Error(`${format}: decoded conversation diverged: ${JSON.stringify({difference,changed,pixelErrors,before:rms(0,.8),speech:rms(1.2,2.05),after:rms(2.4,3.1)})}`);
            mediaChecks.push({format,frames:media.plan.frames,bytes:media.blob.size,difference,changed,pixelErrors,silenceAfterClose:rms(2.4,3.1)});
          }finally{input.dispose();}
        }}finally{await context.close();}
      }
      return {id:group.presentation.id,layers:group.layers.filter(layer=>layer.active).length,roles:group.presentation.hotSpringHouse.roleIds,activeRoles:group.presentation.hotSpringHouse.roleIds.filter(id=>[...group.nodes.values()].some(node=>node.type==='GameObject'&&node.data.m_Name===id&&node.data.m_IsActive)),same:JSON.stringify(snapshot)===JSON.stringify(restored),exported,voices:document.querySelector('#voice-list').options.length,conversations,mediaChecks};
    });assert.ok(result.layers>0);assert.deepEqual(result.activeRoles,house.roleIds);assert.equal(result.same,true);assert.equal(result.exported,id);assert.ok(result.voices>0);console.log(result);
    const position=await page.evaluate(async()=>{const stage=window.mteStudio,group=stage.groups[0],root=group.controllers.find(root=>root.source.id==='hot-spring'),hit=root.hotspots.find(hit=>hit.role),{point,multiply,objectTransform}=await import('/src/engine/geometry.js'),data=group.nodes.get(hit.transform).data,world=point(multiply(objectTransform(group),group.world(hit.transform)),data.m_SizeDelta.x*(.5-data.m_Pivot.x),data.m_SizeDelta.y*(.5-data.m_Pivot.y)),rect=stage.canvas.getBoundingClientRect(),width=Math.max(stage.camera.width,stage.camera.height*rect.width/rect.height),height=width*rect.height/rect.width;stage.paused=false;return {x:rect.left+((world.x-stage.camera.x)/width+.5)*rect.width,y:rect.top+(.5-(world.y-stage.camera.y)/height)*rect.height,hit:root.hitAt(world.x,world.y)?.id,target:hit.id};});assert.equal(position.hit,position.target);await page.locator('#sequence-record').click();await page.mouse.click(position.x,position.y);
    await page.waitForFunction(()=>window.mteStudio.groups[0].controllers.at(-1).value.phase==='dialogue'&&window.mteAudio.currentVoice&&window.mteAudio.element.currentTime>.03);assert.ok(await page.locator('#subtitle').textContent());await page.locator('#hot-spring-close').click();await page.waitForFunction(()=>window.mteStudio.groups[0].controllers.at(-1).value.phase==='idle');assert.equal(await page.evaluate(()=>window.mteAudio.currentVoice),null);await page.locator('#sequence-stop').click();assert.deepEqual(await page.evaluate(()=>window.mteSequence.sequence.actions.map(action=>action.hit)),[position.target,'close']);
  }
  assert.deepEqual(errors,[]);console.log(`${engine}: three real hot spring houses loaded, restored and rendered independently`);
}finally{await browser.close();}
