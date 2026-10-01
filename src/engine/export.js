import {Output,BufferTarget,StreamTarget,Mp4OutputFormat,WebMOutputFormat,CanvasSource,AudioBufferSource,Quality,canEncodeVideo,canEncodeAudio} from 'mediabunny';
import {Zip,ZipPassThrough} from 'fflate';
import {Stage} from './stage.js';
import {validateScene} from './scene.js';
import {exportPlan,frameSources,exportCamera,clipSample} from './export-plan.js';

const checkpoint=signal=>{if(signal?.aborted)throw new DOMException('Export cancelled','AbortError');};
const yieldBrowser=()=>new Promise(resolve=>setTimeout(resolve,0));
const png=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Image encoding failed')),'image/png'));

export class RenderSession {
  constructor(scene,catalog,entries,imageAssets,sourceAspect,plan,signal){
    this.scene=validateScene(scene);this.catalog=catalog;this.entries=entries;this.plan=plan;this.signal=signal;
    this.canvas=document.createElement('canvas');this.canvas.width=plan.width;this.canvas.height=plan.height;
    this.stage=new Stage(this.canvas,{manual:true,transparent:Boolean(plan.transparent)});this.stage.imageAssets=new Map(imageAssets);
    const bounds=exportCamera(this.scene.camera,sourceAspect,plan);this.camera=bounds.camera;this.stage.options.clip=bounds.clip;this.time=0;
  }
  async initialize(){checkpoint(this.signal);await this.stage.restore(this.scene,this.catalog,this.entries,this.signal);this.stage.background=this.plan.background;this.stage.camera={...this.camera};}
  async seek(target){
    checkpoint(this.signal);
    if(target<this.time-1e-9){await this.initialize();this.time=0;}
    let steps=0;
    while(target-this.time>1e-9){const delta=Math.min(1/120,target-this.time);this.stage.evaluate(delta);this.time+=delta;if(++steps%300===0){await yieldBrowser();checkpoint(this.signal);}}
    this.stage.evaluate(0);this.stage.draw();
  }
  dispose(){this.stage.dispose();this.stage.gl.getExtension('WEBGL_lose_context')?.loseContext();}
}

export async function exportMedia({scene,catalog,entries,imageAssets,sourceAspect,settings,signal,onProgress=()=>{},writable,audioClip}){
  const plan=exportPlan(settings,scene.speed),quality=new Quality({bitrate:plan.bitrate}),codec=plan.format==='mp4'?'avc':'vp9';
  if(['mp4','webm'].includes(plan.format)&&!await canEncodeVideo(codec,{width:plan.width,height:plan.height,frameRate:plan.fps,quality}))throw new Error(`${plan.format.toUpperCase()} encoding is unavailable at these settings. Try another format or PNG sequence.`);
  if(!writable&&['mp4','webm'].includes(plan.format)&&plan.bitrate*plan.duration/8>384*1024*1024)throw new Error('Use direct file saving for this large export, or reduce its duration or bitrate');
  const session=new RenderSession(scene,catalog,entries,imageAssets,sourceAspect,plan,signal),head=plan.loopMode==='crossfade'?new RenderSession(scene,catalog,entries,imageAssets,sourceAspect,plan,signal):null;
  const canvas=document.createElement('canvas');canvas.width=plan.width;canvas.height=plan.height;const ctx=canvas.getContext('2d');
  let output,source,audioSource,decoder,decoded,zip,zipBytes=0,writeQueue=Promise.resolve(),zipError,chunks=[],audioUntil=0,abortOutput,fileWriter,abortWrite;
  const audioCodec=plan.format==='mp4'?'aac':'opus';
  try{
    if(writable){fileWriter=writable.getWriter();abortWrite=()=>fileWriter.abort(new DOMException('Export cancelled','AbortError')).catch(()=>{});signal?.addEventListener('abort',abortWrite,{once:true});checkpoint(signal);}
    await session.initialize();if(head)await head.initialize();
    const maxDimension=session.stage.gl.getParameter(session.stage.gl.MAX_RENDERBUFFER_SIZE);if(plan.width>maxDimension||plan.height>maxDimension)throw new Error('Export dimensions exceed this device’s rendering limit');
    if(audioClip&&['mp4','webm'].includes(plan.format)){
      if(!await canEncodeAudio(audioCodec,{sampleRate:48000,numberOfChannels:2,quality:new Quality({bitrate:128000})}))throw new Error('Audio encoding is unavailable for this video format');
      const response=await fetch(audioClip.url,{signal});if(!response.ok)throw new Error(`Audio unavailable (${response.status})`);
      decoder=new AudioContext();decoded=await decoder.decodeAudioData(await response.arrayBuffer());checkpoint(signal);
    }
    if(['mp4','webm'].includes(plan.format)){
      const stream=fileWriter&&new WritableStream({write:chunk=>fileWriter.write(chunk),close:()=>{}});
      output=new Output({format:plan.format==='mp4'?new Mp4OutputFormat({fastStart:writable?'fragmented':false}):new WebMOutputFormat(),target:stream?new StreamTarget(stream,{chunked:true,chunkSize:4*1024*1024}):new BufferTarget()});
      let payloadBytes=0;
      source=new CanvasSource(canvas,{codec,quality,keyFrameInterval:2,onEncodedPacket:packet=>{payloadBytes+=packet.data.byteLength;if(!writable&&payloadBytes>384*1024*1024)zipError=new Error('Encoded file exceeds the memory budget; use direct file saving');}});output.addVideoTrack(source,{frameRate:plan.fps});
      if(decoded){audioSource=new AudioBufferSource({codec:audioCodec,quality:new Quality({bitrate:128000})});output.addAudioTrack(audioSource);}
      await output.start();
      abortOutput=()=>{output.cancel().catch(()=>{});};signal?.addEventListener('abort',abortOutput,{once:true});checkpoint(signal);
    }else if(plan.format==='sequence'){
      zip=new Zip((error,data)=>{if(error){zipError=error;return;}zipBytes+=data.byteLength;if(zipBytes>0xffffffff){zipError=new Error('PNG sequence exceeds the ZIP size limit; export a shorter interval');return;}if(!writable&&zipBytes>384*1024*1024){zipError=new Error('PNG sequence exceeds the memory budget; use direct file saving');return;}if(fileWriter)writeQueue=writeQueue.then(()=>fileWriter.write(data));else chunks.push(data);});
    }
    const audioChannels=decoded&&Array.from({length:decoded.numberOfChannels},(_,i)=>decoded.getChannelData(i));
    const sampleOptions={offset:settings.audioOffset||0,rate:settings.audioFollowSpeed?plan.speed:1,repeat:Boolean(settings.audioRepeat),gain:settings.audioGain??1},sampleValues=[0,0];
    async function addAudio(until){
      if(!audioSource)return;
      while(audioUntil<until-1e-9){checkpoint(signal);const count=Math.min(48000,Math.round((until-audioUntil)*48000));if(count<1)break;const buffer=new AudioBuffer({numberOfChannels:2,length:count,sampleRate:48000}),channels=[buffer.getChannelData(0),buffer.getChannelData(1)];
        for(let sample=0;sample<count;sample++){const time=audioUntil+sample/48000,values=clipSample(audioChannels,decoded.sampleRate,time,sampleOptions,sampleValues),fade=Math.min(1,(plan.duration-time)/.005);channels[0][sample]=values[0]*fade;channels[1][sample]=values[1]*fade;}
        await audioSource.add(buffer);audioUntil+=count/48000;
      }
    }
    for(let i=0;i<plan.frames;i++){
      checkpoint(signal);if(zipError)throw zipError;
      const frames=frameSources(plan,i);await session.seek(plan.start+frames[0].frame/plan.fps*plan.speed);
      ctx.clearRect(0,0,plan.width,plan.height);ctx.globalCompositeOperation='source-over';ctx.globalAlpha=frames[0].weight;ctx.drawImage(session.canvas,0,0);
      if(frames.length===2){await head.seek(plan.start+frames[1].frame/plan.fps*plan.speed);ctx.globalCompositeOperation='lighter';ctx.globalAlpha=frames[1].weight;ctx.drawImage(head.canvas,0,0);ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;}
      if(plan.format==='png'){const blob=await png(canvas);checkpoint(signal);if(fileWriter){await fileWriter.write(await blob.arrayBuffer());checkpoint(signal);await fileWriter.close();}onProgress({frame:1,total:1,phase:'complete'});return {blob:fileWriter?null:blob,plan};}
      if(source)await Promise.all([addAudio(Math.min(plan.duration,(i+1)/plan.fps)),source.add(i/plan.fps,1/plan.fps,{keyFrame:i%plan.cycleFrames===0})]);
      else {const blob=await png(canvas);checkpoint(signal);const file=new ZipPassThrough(`frame-${String(i).padStart(6,'0')}.png`);zip.add(file);file.push(new Uint8Array(await blob.arrayBuffer()),true);await writeQueue;}
      onProgress({frame:i+1,total:plan.frames,phase:'rendering'});if(i%8===0)await yieldBrowser();
    }
    checkpoint(signal);if(zipError)throw zipError;onProgress({frame:plan.frames,total:plan.frames,phase:'finalizing'});
    if(output){source.close();audioSource?.close();await output.finalize();checkpoint(signal);if(fileWriter)await fileWriter.close();return {blob:writable?null:new Blob([output.target.buffer],{type:plan.format==='mp4'?'video/mp4':'video/webm'}),plan};}
    zip.end();await writeQueue;if(zipError)throw zipError;checkpoint(signal);if(fileWriter)await fileWriter.close();return {blob:writable?null:new Blob(chunks,{type:'application/zip'}),plan};
  }catch(error){if(output&&output.state!=='finalized')await output.cancel().catch(()=>{});zip?.terminate();if(fileWriter)await fileWriter.abort(error).catch(()=>{});if(signal?.aborted)throw new DOMException('Export cancelled','AbortError');throw error;}
  finally{if(abortOutput)signal?.removeEventListener('abort',abortOutput);if(abortWrite)signal?.removeEventListener('abort',abortWrite);fileWriter?.releaseLock();session.dispose();head?.dispose();if(decoder)await decoder.close();}
}
