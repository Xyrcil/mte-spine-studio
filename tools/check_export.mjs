import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Input,BufferSource,ALL_FORMATS} from 'mediabunny';
import {unzipSync} from 'fflate';
import {launchTestBrowser} from './test_browser.mjs';
const {browser,close}=await launchTestBrowser('chromium');
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length>0);
  await page.getByRole('button',{name:'Pause',exact:true}).click();const original=await page.evaluate(()=>window.mteEditor.snapshot());
  await page.getByRole('button',{name:'Export',exact:true}).click();
  for(const [id,value] of [['width','320'],['height','240'],['scale','2'],['fps','10'],['end','1']])await page.locator(`#export-${id}`).fill(value);
  const voice=await page.locator('#export-audio option').evaluateAll(options=>options.find(option=>option.value.includes('_Login'))?.value);assert.ok(voice);await page.locator('#export-audio').selectOption(voice);
  async function download(filename){const handle=page.waitForEvent('download',{timeout:60000});handle.catch(()=>{});const exported=await page.evaluate(()=>window.mteExporter.run());if(!exported)throw new Error(await page.locator('#export-status').textContent());const result=await handle;await result.saveAs(`private/${filename}`);await page.waitForFunction(()=>!document.querySelector('#run-export').disabled);return new Uint8Array(await fs.readFile(`private/${filename}`));}
  for(const format of ['mp4','webm']){
    await page.locator('#export-format').selectOption(format);const bytes=await download(`export-test.${format}`),input=new Input({source:new BufferSource(bytes),formats:ALL_FORMATS});
    const video=await input.getPrimaryVideoTrack(),audio=await input.getPrimaryAudioTrack();assert.ok(video&&audio);assert.equal(await video.getDisplayWidth(),640);assert.equal(await video.getDisplayHeight(),480);assert.equal((await video.computePacketStats()).packetCount,10);assert.ok(Math.abs(await video.computeDuration()-1)<.002);input.dispose();
    const decoded=await page.evaluate(async format=>{const {Input,BlobSource,ALL_FORMATS,AudioSampleSink}=await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs');const response=await fetch(`/private/export-test.${format}`);if(!response.ok)return null;const input=new Input({source:new BlobSource(await response.blob()),formats:ALL_FORMATS}),audio=await input.getPrimaryAudioTrack(),sample=await new AudioSampleSink(audio).getSample(.5),data=sample.toAudioBuffer().getChannelData(0);const rms=Math.sqrt(data.reduce((sum,v)=>sum+v*v,0)/data.length);sample.close();input.dispose();return rms;},format);
    assert.ok(decoded>.001,`Export audio is silent: ${format}`);console.log({format,bytes:bytes.length,audioRms:decoded});
  }
  await page.locator('#export-format').selectOption('png');await page.locator('#export-transparent').check();const image=await download('export-test.png');
  const pixels=await page.evaluate(async data=>{const bitmap=await createImageBitmap(new Blob([new Uint8Array(data)],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;bitmap.close();return {width:canvas.width,height:canvas.height,corner:pixels[3],visible:pixels.filter((_,i)=>i%4===3).some(value=>value>0)};},Array.from(image));assert.equal(pixels.width,640);assert.equal(pixels.height,480);assert.equal(pixels.corner,0);assert.equal(pixels.visible,true);
  await page.locator('#export-format').selectOption('sequence');for(const [id,value] of [['width','96'],['height','64'],['scale','1'],['fps','5'],['end','.6'],['loops','2']])await page.locator(`#export-${id}`).fill(value);
  const sequence=unzipSync(await download('export-test.zip'));assert.equal(Object.keys(sequence).length,6);assert.ok(Object.keys(sequence).every(name=>name.endsWith('.png')));
  assert.deepEqual(await page.evaluate(()=>window.mteEditor.snapshot()),original);
  await page.locator('#export-format').selectOption('webm');await page.locator('#export-transparent').uncheck();await page.locator('#export-end').fill('60');await page.locator('#run-export').click();await page.waitForFunction(()=>!document.querySelector('#cancel-export').disabled&&document.querySelector('#export-progress').value>=2);await page.locator('#cancel-export').click();await page.waitForFunction(()=>document.querySelector('#export-status').textContent==='Export cancelled');
  assert.deepEqual(await page.evaluate(()=>window.mteEditor.snapshot()),original);assert.deepEqual(errors,[]);await page.screenshot({path:'private/browser-export.png'});
  const variants=await page.evaluate(async()=>{
    const {exportMedia}=await import('/src/engine/export.js'),{Input,BlobSource,ALL_FORMATS,VideoSampleSink}=await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs');
    const stage=window.mteStudio,scene=window.mteExporter.captured,catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries;
    const results=[];
    for(const loopMode of ['ping-pong','crossfade']){
      const settings={...window.mteExporter.settings(),format:'webm',width:160,height:120,scale:1,start:0,end:1.2,fps:10,loops:2,loopMode,fade:.2},out=await exportMedia({scene,catalog,entries,imageAssets:stage.imageAssets,sourceAspect:stage.canvas.width/stage.canvas.height,settings}),input=new Input({source:new BlobSource(out.blob),formats:ALL_FORMATS}),track=await input.getPrimaryVideoTrack(),sample=await new VideoSampleSink(track).getSample(.5);
      results.push({loopMode,expected:out.plan.frames,actual:(await track.computePacketStats()).packetCount,duration:await track.computeDuration(),decoded:Boolean(sample)});sample.close();input.dispose();
    }
    const writes=[];let closed=false;const writable=new WritableStream({write:chunk=>writes.push({position:chunk.position,data:chunk.data.slice()}),close:()=>closed=true});
    const settings={...window.mteExporter.settings(),format:'mp4',width:160,height:120,scale:1,start:0,end:.5,fps:10,loops:1,loopMode:'repeat'},out=await exportMedia({scene,catalog,entries,imageAssets:stage.imageAssets,sourceAspect:stage.canvas.width/stage.canvas.height,settings,writable});
    const bytes=new Uint8Array(Math.max(...writes.map(chunk=>chunk.position+chunk.data.length)));for(const chunk of writes)bytes.set(chunk.data,chunk.position);
    const input=new Input({source:new BlobSource(new Blob([bytes])),formats:ALL_FORMATS}),track=await input.getPrimaryVideoTrack();results.push({streamed:true,closed,blob:out.blob,expected:out.plan.frames,actual:(await track.computePacketStats()).packetCount});input.dispose();
    let aborted=false,committed=false;const controller=new AbortController(),cancelStream=new WritableStream({write:()=>{},close:()=>committed=true,abort:()=>aborted=true});
    try{await exportMedia({scene,catalog,entries,imageAssets:stage.imageAssets,sourceAspect:stage.canvas.width/stage.canvas.height,settings:{...settings,end:60},writable:cancelStream,signal:controller.signal,onProgress:info=>{if(info.frame===2)controller.abort();}});throw new Error('Cancellation did not reject');}catch(error){if(error.name!=='AbortError')throw error;}
    results.push({cancelledStream:true,aborted,committed});return results;
  });for(const result of variants){if(result.cancelledStream){assert.equal(result.aborted,true);assert.equal(result.committed,false);continue;}assert.equal(result.actual,result.expected);if(result.streamed){assert.equal(result.closed,true);assert.equal(result.blob,null);}else assert.equal(result.decoded,true);}console.log(variants);
  const preserved=await page.evaluate(async()=>{
    const directory=await navigator.storage.getDirectory(),file=await directory.getFileHandle('mte-export-cancel-test',{create:true}),before=new Uint8Array([77,84,69]),initial=await file.createWritable();await initial.write(before);await initial.close();
    const {exportMedia}=await import('/src/engine/export.js'),stage=window.mteStudio,scene=window.mteExporter.captured,catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries,controller=new AbortController();
    try{await exportMedia({scene,catalog,entries,imageAssets:stage.imageAssets,sourceAspect:stage.canvas.width/stage.canvas.height,settings:{...window.mteExporter.settings(),format:'mp4',width:160,height:120,scale:1,end:60,loops:1,loopMode:'repeat'},writable:await file.createWritable(),signal:controller.signal,onProgress:info=>{if(info.frame===2)controller.abort();}});throw new Error('File cancellation did not reject');}catch(error){if(error.name!=='AbortError')throw error;}
    const after=[...new Uint8Array(await (await file.getFile()).arrayBuffer())];await directory.removeEntry('mte-export-cancel-test');return after;
  });assert.deepEqual(preserved,[77,84,69]);
  const cropTest=await page.evaluate(async()=>{
    const {exportMedia}=await import('/src/engine/export.js'),stage=window.mteStudio,catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries;
    const raster=document.createElement('canvas');raster.width=32;raster.height=32;const ctx=raster.getContext('2d');for(const [x,y,color] of [[0,0,'#ff0000'],[16,0,'#00ff00'],[0,16,'#0000ff'],[16,16,'#ffff00']]){ctx.fillStyle=color;ctx.fillRect(x,y,16,16);}
    const scene={schema:1,name:'Crop',camera:{x:0,y:0,width:2,height:2},speed:1,paused:true,background:'#000000',objects:[{id:'image',kind:'image',name:'Quadrants',src:raster.toDataURL(),width:2,height:2,x:0,y:0,scale:1,rotation:0,opacity:1,visible:true,locked:false,flipX:false,flipY:false}]};
    const colors=[];for(const [x,y] of [[0,0],[.5,.5]]){const settings={...window.mteExporter.settings(),format:'png',width:100,height:100,scale:1,start:0,end:1,loops:1,loopMode:'repeat',fit:'cover',crop:{x,y,width:.5,height:.5},transparent:false};const out=await exportMedia({scene,catalog,entries,imageAssets:stage.imageAssets,sourceAspect:1,settings}),image=await createImageBitmap(out.blob),canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);colors.push([...ctx.getImageData(50,50,1,1).data]);image.close();}return colors;
  });assert.deepEqual(cropTest,[[255,0,0,255],[255,255,0,255]]);
  console.log('Export browser checks passed: MP4/WebM frame counts and audio, transparent PNG, ZIP sequence, cancellation and scene isolation');
}finally{await close();}
