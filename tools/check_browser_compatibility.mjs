import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';
import {selectAsset} from './select_asset.mjs';
const name=process.argv[2]||'webkit';
const {browser,close}=await launchTestBrowser(name);
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length&&!window.mteEditor.busy);
  await page.locator('#pause').click();const initial=await page.evaluate(()=>window.mteEditor.snapshot());
  await page.getByRole('button',{name:'Studio',exact:true}).click();await page.getByLabel('X',{exact:true}).fill('2');await page.getByLabel('X',{exact:true}).press('Tab');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await page.waitForFunction(()=>!window.mteEditor.busy);assert.deepEqual(await page.evaluate(()=>window.mteEditor.snapshot()),initial);
  await selectAsset(page,'Spines/painting/301619402_spine');await page.waitForFunction(()=>window.mteStudio.groups.length===2);
  const interaction=await page.evaluate(()=>{const stage=window.mteStudio,group=stage.groups.at(-1),root=group.controllers[0];root.reset();for(const layer of root.layers){layer.state.clearTracks();layer.skeleton.setToSetupPose();}root.play('animation',0,true);stage.evaluate(0);const hit=root.hotspots.find(hit=>hit.name==='HitArea_anim_anim2'),result=stage.triggerInteraction(group.id,root.source.id,hit.id);for(let i=0;i<1200&&root.value.playing;i++)stage.evaluate(1/120);stage.draw();return {accepted:result.accepted,idle:root.primary.state.getCurrent(0).animation.name,glError:stage.gl.getError(),layers:root.layers.length};});assert.equal(interaction.accepted,true);assert.equal(interaction.idle,'animation2');assert.equal(interaction.glError,0);
  await page.getByRole('button',{name:'Export',exact:true}).click();for(const [key,value] of [['width','160'],['height','120'],['fps','10'],['end','.4']])await page.locator(`#export-${key}`).fill(value);
  const outputs=await page.evaluate(async()=>{
    const {exportMedia,exportVideoSupport}=await import('/src/engine/export.js'),{Input,BlobSource,ALL_FORMATS,VideoSampleSink,AudioSampleSink}=await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs'),{unzipSync}=await import('/node_modules/fflate/esm/browser.js');
    const stage=window.mteStudio,scene=window.mteExporter.captured,catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries,library=await fetch('/assets/library.json').then(r=>r.json()),audio=window.mteAudio;
    const voice=library.voices.find(row=>row.targetId==='3014027'&&audio.resolve(row.resourceName)),clip=audio.resolve(voice.resourceName),args={scene,catalog,entries,imageAssets:stage.imageAssets,sourceAspect:stage.canvas.width/stage.canvas.height},outputs=[];
    const {aacGaplessMetadata,normalizeDecodedAac}=await import('/src/engine/audio-delay.js'),referenceContext=new AudioContext({sampleRate:48000}),referenceData=await (await fetch(audio.base+clip.path)).arrayBuffer(),timing=aacGaplessMetadata(referenceData),reference=normalizeDecodedAac(referenceContext,await referenceContext.decodeAudioData(referenceData),timing).getChannelData(0);await referenceContext.close();
    for(const format of ['mp4','webm']){
      const settings={...window.mteExporter.settings(),format};let codec;try{codec=await exportVideoSupport(settings,scene.speed);}catch(error){outputs.push({format,unavailable:error.message});continue;}
      const output=await exportMedia({...args,settings,audioClip:{url:audio.base+clip.path}}),input=new Input({source:new BlobSource(output.blob),formats:ALL_FORMATS});
      try{
        const video=await input.getPrimaryVideoTrack(),sound=await input.getPrimaryAudioTrack(),frame=await new VideoSampleSink(video).getSample(.1),pcm=new Float32Array(19200);
        for await(const sample of new AudioSampleSink(sound).samples()){const channel=sample.toAudioBuffer().getChannelData(0),start=Math.round(sample.timestamp*48000),skip=Math.max(0,-start),target=Math.max(0,start);if(target<pcm.length)pcm.set(channel.subarray(skip,skip+pcm.length-target),target);sample.close();}
        let energy=0,difference=0;for(let index=3600;index<16800;index++){energy+=reference[index]**2;difference+=(pcm[index]-reference[index])**2;}
        outputs.push({format,codec,actualCodec:await video.getCodec(),frames:(await video.computePacketStats()).packetCount,expected:output.plan.frames,decoded:Boolean(frame),audioRms:Math.sqrt(pcm.reduce((sum,value)=>sum+value*value,0)/pcm.length),audioAlignmentError:Math.sqrt(difference/energy)});frame.close();
      }finally{input.dispose();}
    }
    const png=await exportMedia({...args,settings:{...window.mteExporter.settings(),format:'png',transparent:true}}),bitmap=await createImageBitmap(png.blob);outputs.push({format:'png',width:bitmap.width,height:bitmap.height});bitmap.close();
    const zip=await exportMedia({...args,settings:{...window.mteExporter.settings(),format:'sequence'}});outputs.push({format:'sequence',frames:Object.keys(unzipSync(new Uint8Array(await zip.blob.arrayBuffer()))).length,expected:zip.plan.frames});return outputs;
  });
  for(const output of outputs)if(output.unavailable)assert.match(output.unavailable,/encoding is unavailable/);else if(output.format==='png')assert.deepEqual([output.width,output.height],[160,120]);else{assert.equal(output.frames,output.expected);if(output.codec){assert.equal(output.actualCodec,output.codec);assert.equal(output.decoded,true);assert.ok(output.audioRms>.001);assert.ok(output.audioAlignmentError<.3,JSON.stringify(output));}}
  assert.deepEqual(errors,[]);console.log(`${name} real-asset checks passed: scene undo, special interaction, video/audio decoding, PNG and ZIP`,{interaction,outputs});
}finally{await close();}
