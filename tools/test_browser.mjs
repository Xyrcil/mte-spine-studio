import {chromium,firefox,webkit} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function silentMedia(){
  if(window.__mteSilentTest)return;Object.defineProperty(window,'__mteSilentTest',{value:true});
  const prototype=HTMLMediaElement.prototype,muted=Object.getOwnPropertyDescriptor(prototype,'muted'),play=prototype.play;
  Object.defineProperty(prototype,'muted',{...muted,set(){muted.set.call(this,true);}});
  prototype.play=function(...args){muted.set.call(this,true);return play.apply(this,args);};
}

function silenceBrowser(browser){
  const newPage=browser.newPage.bind(browser),newContext=browser.newContext.bind(browser);
  browser.newPage=async options=>{const page=await newPage(options);await page.addInitScript(silentMedia);return page;};
  browser.newContext=async options=>{const context=await newContext(options);await context.addInitScript(silentMedia);return context;};
  return browser;
}

export async function launchTestBrowser(name){
  const type={chromium,firefox,webkit}[name];if(!type)throw new Error('Choose chromium, firefox or webkit');
  const application=name==='firefox'?process.env.MTE_FIREFOX_TEST_APP:undefined;
  if(application){
    const profile=await mkdtemp(join(tmpdir(),'mte-firefox-'));
    try{
      const context=await firefox.launchPersistentContext(profile,{headless:true,ignoreDefaultArgs:true,args:['-app',application,'-no-remote','-headless','-profile',profile,'-juggler-pipe','-silent']});
      await context.addInitScript(silentMedia);
      return {browser:silenceBrowser(context.browser()),async close(){try{await context.close();}finally{await rm(profile,{recursive:true,force:true});}}};
    }catch(error){await rm(profile,{recursive:true,force:true});throw error;}
  }
  const browser=await type.launch({headless:true,...(name==='chromium'?{channel:'chrome',args:['--mute-audio']}:{})});return {browser:silenceBrowser(browser),close:()=>browser.close()};
}
