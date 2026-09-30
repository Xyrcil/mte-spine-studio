import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');
  await page.waitForSelector('#voice-panel');
  for(const track of ['a_sound_voiceeff','a_sound_voiceeff_ch']) {
    await page.getByLabel('Voice track',{exact:true}).selectOption(track);
    await page.getByRole('button',{name:'Play voice',exact:true}).click();
    await page.waitForFunction(()=>window.mteAudio.element.currentTime>0.1,null,{timeout:15000});
    const result=await page.evaluate(async()=>{
      const element=window.mteAudio.element;
      const context=new AudioContext();
      const response=await fetch(element.src);
      const decoded=await context.decodeAudioData(await response.arrayBuffer());
      await context.close();
      return {source:element.getAttribute('src'),duration:decoded.duration,channels:decoded.numberOfChannels,subtitle:document.querySelector('#subtitle').textContent};
    });
    if(!result.subtitle || result.duration<=0)throw new Error('Voice or subtitle was not loaded');
    console.log({track,...result});
    await page.getByRole('button',{name:'Stop voice',exact:true}).click();
    if(!await page.evaluate(()=>window.mteAudio.element.paused && !window.mteAudio.element.hasAttribute('src')))throw new Error('Stopped audio still has a resource');
  }
  if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();}
