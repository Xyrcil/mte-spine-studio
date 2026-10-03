import {chromium,firefox,webkit} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export async function launchTestBrowser(name){
  const type={chromium,firefox,webkit}[name];if(!type)throw new Error('Choose chromium, firefox or webkit');
  const application=name==='firefox'?process.env.MTE_FIREFOX_TEST_APP:undefined;
  if(application){
    const profile=await mkdtemp(join(tmpdir(),'mte-firefox-'));
    try{
      const context=await firefox.launchPersistentContext(profile,{headless:true,ignoreDefaultArgs:true,args:['-app',application,'-no-remote','-headless','-profile',profile,'-juggler-pipe','-silent']});
      return {browser:context.browser(),async close(){try{await context.close();}finally{await rm(profile,{recursive:true,force:true});}}};
    }catch(error){await rm(profile,{recursive:true,force:true});throw error;}
  }
  const browser=await type.launch({headless:true,...(name==='chromium'?{channel:'chrome'}:{})});return {browser,close:()=>browser.close()};
}
