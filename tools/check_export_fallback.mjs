import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  for(const mode of ['vp8','no-codecs','no-webgl','dropped-frames']){
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(mode=>{
      if(mode==='no-webgl'){const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl'?null:original.call(this,type,...args);};}
      else if(mode==='dropped-frames'){const Original=VideoEncoder;window.VideoEncoder=class extends Original{encode(frame,options){if(frame.timestamp===100000)return;super.encode(frame,options);}};}
      else{const original=VideoEncoder.isConfigSupported.bind(VideoEncoder);VideoEncoder.isConfigSupported=config=>mode==='no-codecs'||config.codec.startsWith('vp09')?Promise.resolve({supported:false,config}):original(config);}
    },mode);
    await page.goto('http://127.0.0.1:4173/');
    if(mode==='no-webgl'){await page.waitForFunction(()=>window.mteStartupError);assert.match(await page.locator('#status').textContent(),/Rendering could not start: WebGL is unavailable/);assert.equal(await page.locator('#pause').isDisabled(),true);}
    else{
      await page.waitForFunction(()=>window.mteStudio?.groups.length);await page.locator('#pause').click();await page.getByRole('button',{name:'Export',exact:true}).click();
      for(const [key,value] of [['width','160'],['height','120'],['fps','10'],['end','.4']])await page.locator(`#export-${key}`).fill(value);await page.locator('#export-format').selectOption(mode==='vp8'?'webm':'mp4');
      await page.waitForFunction(()=>!document.querySelector('#export-support').textContent.includes('Checking'));
      if(mode==='vp8'){assert.match(await page.locator('#export-support').textContent(),/VP8/);const codec=await page.evaluate(async()=>{const result=await window.mteExporter.run();if(!result)throw new Error(document.querySelector('#export-status').textContent);const {Input,BlobSource,ALL_FORMATS}=await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs'),input=new Input({source:new BlobSource(result.blob),formats:ALL_FORMATS});try{return await (await input.getPrimaryVideoTrack()).getCodec();}finally{input.dispose();}});assert.equal(codec,'vp8');}
      else if(mode==='dropped-frames'){assert.equal(await page.evaluate(()=>window.mteExporter.run()),undefined);assert.match(await page.locator('#export-status').textContent(),/did not preserve every frame/);}
      else{assert.match(await page.locator('#export-support').textContent(),/MP4 encoding is unavailable/);assert.equal(await page.evaluate(()=>window.mteExporter.run()),undefined);assert.match(await page.locator('#export-status').textContent(),/PNG sequence/);await page.locator('#export-format').selectOption('sequence');assert.equal(await page.evaluate(async()=>Boolean((await window.mteExporter.run())?.blob)),true);}
    }
    assert.deepEqual(errors,[]);await page.close();console.log(`Simulated ${mode} checks passed`);
  }
}finally{await browser.close();}
