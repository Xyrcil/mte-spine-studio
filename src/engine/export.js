import {Output,BufferTarget,StreamTarget,Mp4OutputFormat,WebMOutputFormat,CanvasSource,AudioBufferSource,Quality,canEncodeVideo,canEncodeAudio} from 'mediabunny';
import {Zip,ZipPassThrough} from 'fflate';
import {Stage} from './stage.js';
import {exportPlan,frameSources,exportCamera} from './export-plan.js';
import {mixExportSample,voiceTimeline,sceneCaptionWeight} from './export-audio.js';
import {subtitleActive,prepareSubtitle,drawSubtitle} from './subtitles.js';
import {aacEncodingDelay} from './audio-delay.js';
import {exportScene,omittedVisualWarnings} from './export-source.js';
import {chooseVideoCodec} from './export-codec.js';
import {InteractionPlayer} from './interaction-sequence.js';

const checkpoint=signal=>{if(signal?.aborted)throw new DOMException('Export cancelled','AbortError');};
const yieldBrowser=()=>new Promise(resolve=>setTimeout(resolve,0));
const png=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Image encoding failed')),'image/png'));

export class RenderSession {
  constructor(scene,catalog,entries,imageAssets,sourceAspect,plan,signal){
    this.scene=exportScene(scene,Boolean(plan.useSequence));this.catalog=catalog;this.entries=entries;this.plan=plan;this.signal=signal;
    this.canvas=document.createElement('canvas');this.canvas.width=plan.width;this.canvas.height=plan.height;
    this.stage=new Stage(this.canvas,{manual:true,transparent:Boolean(plan.transparent)});this.stage.imageAssets=new Map(imageAssets);
    this.stage.addEventListener('sequence-error',event=>{this.playbackError=new Error(event.detail);});
    const bounds=exportCamera(this.scene.camera,sourceAspect,plan);this.camera=bounds.camera;this.stage.options.clip=bounds.clip;this.stage.options.maskCamera=bounds.maskCamera;this.time=0;
  }
  async initialize(){checkpoint(this.signal);this.playbackError=null;this.stage.sequencePlayer=null;await this.stage.restore(this.scene,this.catalog,this.entries,this.signal);if(this.plan.useSequence)this.stage.sequencePlayer=new InteractionPlayer(this.stage,this.scene.sequence,{continueAfterEnd:true});this.stage.background=this.plan.background;this.stage.camera={...this.camera};this.time=0;this.pendingTime=0;}
  async seek(target,onAdvance){
    if(this.stage.recoveryPending)throw new Error('Export rendering was interrupted; retry the export');
    checkpoint(this.signal);
    if(target<this.time-1e-9){await this.initialize();this.time=0;}
    let steps=0;
    while(target-this.time>1e-9){const delta=Math.min(1/120,target-this.time);this.pendingTime=this.time+delta;this.stage.evaluate(delta);if(this.playbackError)throw this.playbackError;this.time+=delta;if(++steps%300===0){onAdvance?.(this.time);await yieldBrowser();checkpoint(this.signal);}}
    if(this.stage.recoveryPending)throw new Error('Export rendering was interrupted; retry the export');this.stage.evaluate(0);if(this.playbackError)throw this.playbackError;this.stage.draw();
  }
  dispose(){this.stage.dispose();this.stage.gl.getExtension('WEBGL_lose_context')?.loseContext();}
}

export async function collectInteractionEffects(session,plan,provider,onProgress=()=>{},interactionProvider){
  const clips=[],voices=[],stops=[],warnings=new Set(),visible=new Set(session.scene.objects.filter(object=>object.visible).map(object=>object.id));let error,eventCount=0;
  const add=(name,category,position,offset,group)=>{
    if(!provider||session.scene.audio?.muted||(session.scene.audio?.effectVolume??.8)<=0)return;
    if(group&&!visible.has(group))return;
    const clip=provider(name,category);if(!clip){warnings.add(`Sound unavailable: ${name}`);return;}
    clips.push({...clip,scene:true,position,offset,sceneRate:1/plan.speed,repeat:false,gain:clip.gain*(session.scene.audio?.effectVolume??.8)});
  };
  for(const track of session.scene.audio?.effectTracks||[])add(track.name,track.category,track.time,0,track.group);
  const listener=event=>{if(++eventCount>10000){error=new Error('Too many interaction sound events; export a shorter interval');return;}try{add(event.detail.name,event.detail.category,0,Math.max(0,(session.stage.sequenceTime??session.pendingTime)-(event.detail.lateness||0)),event.detail.group);}catch(reason){error=reason;}};
  const voiceListener=event=>{
    if(!interactionProvider||event.detail.group&&!visible.has(event.detail.group))return;
    if(++eventCount>10000){error=new Error('Too many interaction audio events; export a shorter interval');return;}
    try{const result=interactionProvider(event.detail),offset=Math.max(0,(session.stage.sequenceTime??session.pendingTime)-(event.detail.lateness||0));
      for(const warning of result?.warnings||[])warnings.add(warning);
      if(result?.effect)add(result.effect.name,result.effect.category,0,offset,event.detail.group);
      if(result?.voice){const voice=result.voice;voices.push({...voice,sourceGroup:event.detail.group||'',scene:true,position:0,offset,sceneRate:1/plan.speed,repeat:false,gain:session.scene.audio?.voiceVolume??1});if(voice.includeSubtitles&&!voice.text)warnings.add('Interaction voice has no subtitle text');}
    }catch(reason){error=reason;}
  };
  session.stage.addEventListener('sound-request',listener);
  session.stage.addEventListener('voice-request',voiceListener);
  const stop=event=>{if(!event.detail.group||visible.has(event.detail.group))stops.push({at:session.stage.sequenceTime??session.pendingTime,group:event.detail.group||''});};session.stage.addEventListener('voice-stop-request',stop);
  const end=plan.format==='png'?plan.start:Math.max(plan.end,plan.start+plan.segmentFrames/plan.fps*plan.speed);
  onProgress({phase:'analyzing-audio',frame:0,total:Math.ceil(end*120)});
  try{await session.seek(end,time=>{if(error)throw error;onProgress({phase:'analyzing-audio',frame:Math.ceil(time*120),total:Math.ceil(end*120)});});if(error)throw error;}
  finally{session.stage.removeEventListener('sound-request',listener);session.stage.removeEventListener('voice-request',voiceListener);session.stage.removeEventListener('voice-stop-request',stop);}
  await session.initialize();return {clips,voices:voiceTimeline(voices,stops),stops,warnings:[...warnings]};
}

export async function exportVideoSupport(settings,sceneSpeed=1){
  const plan=exportPlan(settings,sceneSpeed);
  return chooseVideoCodec(plan.format,{width:plan.width,height:plan.height,frameRate:plan.fps,latencyMode:'realtime',quality:new Quality({bitrate:plan.bitrate})},canEncodeVideo);
}

export async function exportMedia({scene,catalog,entries,imageAssets,sourceAspect,settings,signal,onProgress=()=>{},writable,audioClip,ambientClips=[],subtitleClip,effectProvider,capturedVoice,interactionProvider}){
  scene=exportScene(scene,Boolean(settings.useSequence));
  const plan=exportPlan(settings,scene.speed),quality=new Quality({bitrate:plan.bitrate}),codec=await exportVideoSupport(settings,scene.speed);
  if(!writable&&['mp4','webm'].includes(plan.format)&&plan.bitrate*plan.duration/8>384*1024*1024)throw new Error('Use direct file saving for this large export, or reduce its duration or bitrate');
  const session=new RenderSession(scene,catalog,entries,imageAssets,sourceAspect,plan,signal),head=plan.loopMode==='crossfade'?new RenderSession(scene,catalog,entries,imageAssets,sourceAspect,plan,signal):null;
  const canvas=document.createElement('canvas');canvas.width=plan.width;canvas.height=plan.height;const ctx=canvas.getContext('2d');
  let output,source,audioSource,decoder,zip,zipBytes=0,writeQueue=Promise.resolve(),zipError,chunks=[],audioUntil=0,abortOutput,fileWriter,abortWrite;
  const tracks=[];
  let interactionClips=[],interactionVoices=[],interactionStops=[],warnings=[];
  let captionDuration=0,captionLayout;
  const sceneCaptions=[];
  let audioDelay=0,encodedFrames=0;
  const audioCodec=plan.format==='mp4'?'aac':'opus';
  try{
    if(writable){fileWriter=writable.getWriter();abortWrite=()=>fileWriter.abort(new DOMException('Export cancelled','AbortError')).catch(()=>{});signal?.addEventListener('abort',abortWrite,{once:true});checkpoint(signal);}
    await session.initialize();if(head)await head.initialize();
    warnings.push(...omittedVisualWarnings(session.stage.groups,session.scene,Boolean(plan.useSequence)));
    const effects=session.stage.groups.filter(group=>group.visible).flatMap(group=>group.effects||[]),pendingEffects=effects.filter(effect=>effect.verification);
    if(pendingEffects.length)warnings.push('Masked particle geometry and draw order still need visual verification');
    if(session.stage.groups.some(group=>group.visible&&group.layers.some(layer=>layer.instance.renderOrderStatus&&(!layer.materialMapping||layer.materialMapping.reason))))warnings.push('Some source material queues are mixed or unresolved; their separate draw ordering is not yet restored');
    if(session.stage.groups.some(group=>group.visible&&group.layers.some(layer=>layer.materialMapping?.pages)))warnings.push('Material segment ordering still needs original-client visual verification');
    if(plan.transparent&&effects.some(effect=>effect.maskedProfile))warnings.push('Transparent output cannot retain additive blending on every background; use an opaque background for matching composition');
    const maxDimension=session.stage.gl.getParameter(session.stage.gl.MAX_RENDERBUFFER_SIZE);if(plan.width>maxDimension||plan.height>maxDimension)throw new Error('Export dimensions exceed this device’s rendering limit');
    const video=['mp4','webm'].includes(plan.format);
    if((video&&effectProvider)||interactionProvider){const result=await collectInteractionEffects(session,plan,video?effectProvider:null,onProgress,interactionProvider);interactionClips=result.clips;interactionVoices=result.voices;interactionStops=result.stops;warnings.push(...result.warnings);}
    const until=Math.min(interactionVoices[0]?.offset??Infinity,...interactionStops.filter(stop=>!stop.group||stop.group===session.scene.audio?.voiceTrack?.group).map(stop=>stop.at)),replacement=Number.isFinite(until)?{until}:{};
    const voiceAudio=video&&capturedVoice?.includeAudio&&!session.scene.audio?.muted?{...capturedVoice,...replacement,scene:true,sceneRate:1/plan.speed}:null;
    const voiceCaption=capturedVoice?.includeSubtitles&&capturedVoice.text?{...capturedVoice,...replacement,captionOnly:true,sceneCaption:true,sceneRate:1/plan.speed}:null;
    const scheduledAudio=video&&!session.scene.audio?.muted?interactionVoices.filter(voice=>voice.includeAudio):[];
    const scheduledCaptions=interactionVoices.filter(voice=>voice.includeSubtitles&&voice.text).map(voice=>({...voice,captionOnly:true,sceneCaption:true}));
    if(capturedVoice?.includeSubtitles&&!capturedVoice.text)warnings.push('Captured voice has no subtitle text');
    const hasAudio=video&&(audioClip||ambientClips.length||interactionClips.length||voiceAudio||scheduledAudio.length);
    if(hasAudio||subtitleClip||voiceCaption||scheduledCaptions.length){
      if(hasAudio&&!await canEncodeAudio(audioCodec,{sampleRate:48000,numberOfChannels:2,quality:new Quality({bitrate:128000})}))throw new Error('Audio encoding is unavailable for this video format. Try another video format, turn off audio, or export a PNG sequence.');
      if(hasAudio&&audioCodec==='aac')audioDelay=await aacEncodingDelay(signal);
      decoder=new AudioContext();const decoded=new Map();let decodedBytes=0;
      for(const clip of [...(video&&audioClip?[{...audioClip,scene:false}]:[]),...(video?ambientClips.map(clip=>({...clip,scene:true})):[]),...interactionClips,...(voiceAudio?[voiceAudio]:[]),...scheduledAudio,...(subtitleClip?[{...subtitleClip,captionOnly:true}]:[]),...(voiceCaption?[voiceCaption]:[]),...scheduledCaptions]){
        checkpoint(signal);let buffer=decoded.get(clip.url);
        if(!buffer){const response=await fetch(clip.url,{signal});if(!response.ok)throw new Error(`Audio unavailable (${response.status})`);
          buffer=await decoder.decodeAudioData(await response.arrayBuffer());checkpoint(signal);decodedBytes+=buffer.length*buffer.numberOfChannels*4;
          if(decodedBytes>256*1024*1024)throw new Error('Decoded audio exceeds the memory budget; use fewer or shorter sound tracks');decoded.set(clip.url,buffer);
        }
        if(clip.sceneCaption){sceneCaptions.push({layout:prepareSubtitle(ctx,clip.text,plan.width,plan.height),duration:buffer.duration,position:clip.position,rate:clip.sceneRate,offset:clip.offset||0,until:clip.until});}
        else if(clip.captionOnly){captionDuration=buffer.duration;captionLayout=prepareSubtitle(ctx,clip.text,plan.width,plan.height);}
        else tracks.push({...clip,channels:Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i)),sampleRate:buffer.sampleRate,options:{offset:settings.audioOffset||0,rate:settings.audioFollowSpeed?plan.speed:1,repeat:Boolean(settings.audioRepeat),gain:settings.audioGain??1}});
      }
    }
    if(['mp4','webm'].includes(plan.format)){
      const stream=fileWriter&&new WritableStream({write:chunk=>fileWriter.write(chunk),close:()=>{}});
      output=new Output({format:plan.format==='mp4'?new Mp4OutputFormat({fastStart:writable?'fragmented':false}):new WebMOutputFormat(),target:stream?new StreamTarget(stream,{chunked:true,chunkSize:4*1024*1024}):new BufferTarget()});
      let payloadBytes=0;
      source=new CanvasSource(canvas,{codec,quality,latencyMode:'realtime',keyFrameInterval:2,onEncodedPacket:packet=>{encodedFrames++;payloadBytes+=packet.data.byteLength;if(!writable&&payloadBytes>384*1024*1024)zipError=new Error('Encoded file exceeds the memory budget; use direct file saving');}});output.addVideoTrack(source,{frameRate:plan.fps});
      if(tracks.length){audioSource=new AudioBufferSource({codec:audioCodec,quality:new Quality({bitrate:128000})},{startTimestamp:-audioDelay});output.addAudioTrack(audioSource);}
      await output.start();
      abortOutput=()=>{output.cancel().catch(()=>{});};signal?.addEventListener('abort',abortOutput,{once:true});checkpoint(signal);
    }else if(plan.format==='sequence'){
      zip=new Zip((error,data)=>{if(error){zipError=error;return;}zipBytes+=data.byteLength;if(zipBytes>0xffffffff){zipError=new Error('PNG sequence exceeds the ZIP size limit; export a shorter interval');return;}if(!writable&&zipBytes>384*1024*1024){zipError=new Error('PNG sequence exceeds the memory budget; use direct file saving');return;}if(fileWriter)writeQueue=writeQueue.then(()=>fileWriter.write(data));else chunks.push(data);});
    }
    const sampleValues=[0,0];
    async function addAudio(until){
      if(!audioSource)return;
      while(audioUntil<until-1e-9){checkpoint(signal);const count=Math.min(48000,Math.round((until-audioUntil)*48000));if(count<1)break;const buffer=new AudioBuffer({numberOfChannels:2,length:count,sampleRate:48000}),channels=[buffer.getChannelData(0),buffer.getChannelData(1)];
        for(let sample=0;sample<count;sample++){const values=mixExportSample(plan,audioUntil+sample/48000,tracks,sampleValues);channels[0][sample]=values[0];channels[1][sample]=values[1];}
        await audioSource.add(buffer);audioUntil+=count/48000;
      }
    }
    for(let i=0;i<plan.frames;i++){
      checkpoint(signal);if(zipError)throw zipError;
      const frames=frameSources(plan,i);await session.seek(plan.start+frames[0].frame/plan.fps*plan.speed);
      ctx.clearRect(0,0,plan.width,plan.height);ctx.globalCompositeOperation='source-over';ctx.globalAlpha=frames[0].weight;ctx.drawImage(session.canvas,0,0);
      if(frames.length===2){await head.seek(plan.start+frames[1].frame/plan.fps*plan.speed);ctx.globalCompositeOperation='lighter';ctx.globalAlpha=frames[1].weight;ctx.drawImage(head.canvas,0,0);ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;}
      let captionOffset=0;
      if(captionLayout&&subtitleActive(i/plan.fps,captionDuration,{offset:settings.audioOffset||0,rate:settings.audioFollowSpeed?plan.speed:1,repeat:Boolean(settings.audioRepeat)})){drawSubtitle(ctx,captionLayout,plan.width,plan.height);captionOffset=captionLayout.height+plan.height*.015;}
      for(const caption of sceneCaptions){const weight=sceneCaptionWeight(plan,i/plan.fps,caption);if(weight>0){drawSubtitle(ctx,caption.layout,plan.width,plan.height,captionOffset,weight);captionOffset+=caption.layout.height+plan.height*.015;}}
      if(plan.format==='png'){const blob=await png(canvas);checkpoint(signal);if(fileWriter){await fileWriter.write(await blob.arrayBuffer());checkpoint(signal);await fileWriter.close();}onProgress({frame:1,total:1,phase:'complete'});return {blob:fileWriter?null:blob,plan,warnings,interactionVoices:interactionVoices.length};}
      if(source)await Promise.all([addAudio(Math.min(plan.duration,(i+1)/plan.fps)),source.add(i/plan.fps,1/plan.fps,{keyFrame:i%plan.cycleFrames===0})]);
      else {const blob=await png(canvas);checkpoint(signal);const file=new ZipPassThrough(`frame-${String(i).padStart(6,'0')}.png`);zip.add(file);file.push(new Uint8Array(await blob.arrayBuffer()),true);await writeQueue;}
      onProgress({frame:i+1,total:plan.frames,phase:'rendering'});if(i%8===0)await yieldBrowser();
    }
    checkpoint(signal);if(zipError)throw zipError;onProgress({frame:plan.frames,total:plan.frames,phase:'finalizing'});
    if(output){source.close();audioSource?.close();await output.finalize();checkpoint(signal);if(encodedFrames!==plan.frames)throw new Error('Video encoder did not preserve every frame. Try a lower frame rate or resolution.');if(fileWriter)await fileWriter.close();return {blob:writable?null:new Blob([output.target.buffer],{type:plan.format==='mp4'?'video/mp4':'video/webm'}),plan,warnings,interactionSounds:interactionClips.length,interactionVoices:interactionVoices.length};}
    zip.end();await writeQueue;if(zipError)throw zipError;checkpoint(signal);if(fileWriter)await fileWriter.close();return {blob:writable?null:new Blob(chunks,{type:'application/zip'}),plan,warnings,interactionVoices:interactionVoices.length};
  }catch(error){if(output&&output.state!=='finalized')await output.cancel().catch(()=>{});zip?.terminate();if(fileWriter)await fileWriter.abort(error).catch(()=>{});if(signal?.aborted)throw new DOMException('Export cancelled','AbortError');throw error;}
  finally{if(abortOutput)signal?.removeEventListener('abort',abortOutput);if(abortWrite)signal?.removeEventListener('abort',abortWrite);fileWriter?.releaseLock();session.dispose();head?.dispose();if(decoder)await decoder.close();}
}
