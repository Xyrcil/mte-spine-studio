import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';
const {browser,close}=await launchTestBrowser('chromium');
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteEditor&&!window.mteEditor.busy&&window.mteStudio.groups.length);
  const result=await page.evaluate(async()=>{
    const {exportMedia}=await import('/src/engine/export.js'),{Input,BlobSource,ALL_FORMATS,AudioSampleSink}=await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs');
    const stage=window.mteStudio,audio=window.mteAudio;stage.paused=true;audio.pause();
    audio.configureAmbient(stage.groups[0].id,{name:'bgm_BianNianShi_01_star_ocean_past',category:'a_sound_bgm',loop:true,gain:.7,time:3,enabled:true,ended:false});audio.ambientEnabled=true;
    const scene=window.mteEditor.snapshot(),catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries;
    const settings={format:'mp4',width:160,height:120,scale:1,fps:10,bitrate:500000,speed:1,start:.25,end:1.25,loops:2,loopMode:'repeat',fade:.1,fit:'contain',background:'#191b20',crop:{x:0,y:0,width:1,height:1}};
    const args={scene,catalog,entries,imageAssets:stage.imageAssets,sourceAspect:stage.canvas.width/stage.canvas.height,settings},out=await exportMedia({...args,ambientClips:audio.exportAmbients(scene.audio,scene.objects)});
    const input=new Input({source:new BlobSource(out.blob),formats:ALL_FORMATS}),track=await input.getPrimaryAudioTrack(),sink=new AudioSampleSink(track);
    const samples=[];for await(const sample of sink.samples()){const buffer=sample.toAudioBuffer();samples.push({start:Math.round(sample.timestamp*48000),data:buffer.getChannelData(0).slice()});sample.close();}
    const pcm=new Float32Array(96000);for(const sample of samples){const start=Math.max(0,sample.start),skip=Math.max(0,-sample.start);if(start<pcm.length)pcm.set(sample.data.subarray(skip,skip+pcm.length-start),start);}input.dispose();
    let energy=0,difference=0;for(let i=9600;i<33600;i++){energy+=pcm[i]**2;difference+=(pcm[i]-pcm[i+48000])**2;}
    const rms=Math.sqrt(energy/24000),relativeError=Math.sqrt(difference/Math.max(1e-20,energy));
    const muted=await exportMedia({...args,ambientClips:audio.exportAmbients({...scene.audio,muted:true},scene.objects)}),silentInput=new Input({source:new BlobSource(muted.blob),formats:ALL_FORMATS}),silent=!(await silentInput.getPrimaryAudioTrack());silentInput.dispose();
    return {rms,relativeError,silent,unchanged:JSON.stringify(scene)===JSON.stringify(window.mteEditor.snapshot()),frames:out.plan.frames};
  });
  assert.ok(result.rms>.001);assert.ok(result.relativeError<.25,JSON.stringify(result));assert.equal(result.silent,true);assert.equal(result.unchanged,true);assert.equal(result.frames,20);assert.deepEqual(errors,[]);console.log('Ambient export checks passed',result);
}finally{await close();}
