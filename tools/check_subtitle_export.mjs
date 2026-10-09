import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';
const {browser,close}=await launchTestBrowser('chromium');
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
  const result=await page.evaluate(async()=>{
    const {exportMedia}=await import('/src/engine/export.js'),{Input,BlobSource,ALL_FORMATS,VideoSampleSink}=await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs');
    const audio=window.mteAudio,library=await fetch('/assets/library.json').then(r=>r.json()),voice=library.storyVoices.find(row=>row.id==='8400001'),clip=audio.resolve(voice.resourceName,'a_sound_voiceeff_ch'),subtitleClip={url:audio.base+clip.path,text:voice.text};
    const scene={schema:1,name:'Subtitle check',background:'#224466',camera:{x:0,y:0,width:2,height:2},speed:1,paused:true,objects:[]},settings={format:'mp4',width:640,height:360,scale:1,fps:10,bitrate:1000000,speed:1,start:0,end:1,loops:1,loopMode:'repeat',fade:.1,fit:'contain',background:'#224466',crop:{x:0,y:0,width:1,height:1},audioOffset:.2};
    const out=await exportMedia({scene,catalog:[],entries:[],imageAssets:new Map(),sourceAspect:640/360,settings,subtitleClip}),input=new Input({source:new BlobSource(out.blob),formats:ALL_FORMATS}),track=await input.getPrimaryVideoTrack(),sink=new VideoSampleSink(track),regions=[];
    for(const time of [0,.4]){const sample=await sink.getSample(time),canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');sample.draw(ctx,0,0);const data=ctx.getImageData(40,300,560,45).data;let bright=0,dark=0;for(let i=0;i<data.length;i+=4){if(data[i]>160&&data[i+1]>160&&data[i+2]>160)bright++;if(data[i]<25&&data[i+1]<35&&data[i+2]<45)dark++;}regions.push({bright,dark});sample.close();}
    const audioAbsent=!(await input.getPrimaryAudioTrack());input.dispose();
    const png=await exportMedia({scene,catalog:[],entries:[],imageAssets:new Map(),sourceAspect:640/360,settings:{...settings,format:'png',audioOffset:0},subtitleClip}),bitmap=await createImageBitmap(png.blob);const pngSize=[bitmap.width,bitmap.height];bitmap.close();return {regions,audioAbsent,pngSize};
  });assert.equal(result.regions[0].bright,0);assert.equal(result.regions[0].dark,0);assert.ok(result.regions[1].bright>100);assert.ok(result.regions[1].dark>1000);assert.equal(result.audioAbsent,true);assert.deepEqual(result.pngSize,[640,360]);assert.deepEqual(errors,[]);console.log('Subtitle export checks passed: decoded Chinese caption, voice offset, muted video and PNG',result);
}finally{await close();}
