import {selectAsset} from './select_asset.mjs';
import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';
const engine=process.argv[2]||'chromium',{browser,close}=await launchTestBrowser(engine);
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteHost?.getState().ready);
  await page.screenshot({path:'private/browser-first.png'});await page.getByRole('button',{name:'Studio',exact:true}).click();
  await selectAsset(page,'Spines/painting/301619402_spine');await page.waitForFunction(()=>window.mteStudio.groups.length===2&&!window.mteEditor.busy);
  await page.screenshot({path:'private/browser-multi.png'});await page.evaluate(()=>window.mteHost.pause());
  const original=await page.evaluate(()=>window.mteHost.getScene()),target='Spines/painting/301301101_spine',pattern='**/assets/spines/painting/301301101_spine/**';
  await page.evaluate(()=>{const gl=window.mteStudio.gl,create=gl.createTexture.bind(gl),remove=gl.deleteTexture.bind(gl);window.loadingTextures=new Set();gl.createTexture=()=>{const texture=create();window.loadingTextures.add(texture);return texture;};gl.deleteTexture=texture=>{window.loadingTextures.delete(texture);remove(texture);};});
  for(const mode of ['cancel','workspace','replace']){
    let release;const waiting=new Promise(resolve=>release=resolve);
    await page.route(pattern,async route=>{await waiting;await route.continue();});
    try{
      await selectAsset(page,target);await page.waitForFunction(()=>window.mteStudio.assetLoadBusy&&window.mteStudio.activeLoads>0);
      assert.equal(await page.evaluate(()=>window.mteHost.getState().busy),true);assert.equal(await page.locator('#cancel-asset-load').isVisible(),true);assert.equal(await page.locator('#layers').evaluate(node=>node.inert),true);
      const blocked=await page.evaluate(async()=>{try{await window.mteHost.loadScene(window.mteHost.getScene());return false;}catch(error){return error.message.includes('Finish the current operation');}});assert.equal(blocked,true);
      assert.deepEqual(await page.evaluate(()=>window.mteHost.getScene()),original);
      if(mode==='cancel')await page.locator('#cancel-asset-load').click();
      if(mode==='workspace')await page.getByRole('button',{name:'Export',exact:true}).click();
      if(mode==='replace'){
        await selectAsset(page,'Spines/painting/3014027_spine');await page.waitForFunction(()=>!window.mteStudio.assetLoadBusy&&window.mteStudio.groups.length===3);
      }
      release();await page.waitForFunction(()=>window.mteStudio.activeLoads===0&&!window.mteStudio.assetLoadBusy);
      if(mode!=='replace'){await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>window.loadingTextures.size),0,'Cancelled loading left a live texture');}
      assert.equal(await page.locator('#cancel-asset-load').isVisible(),false);
      if(mode!=='replace')assert.deepEqual(await page.evaluate(()=>window.mteHost.getScene()),original);
      else{assert.equal(await page.evaluate(()=>window.mteStudio.groups.at(-1).presentation.id),'Spines/painting/3014027_spine');assert.equal(await page.evaluate(()=>window.mteStudio.groups.some(group=>group.presentation.id==='Spines/painting/301301101_spine')),false);}
      if(mode==='workspace')await page.getByRole('button',{name:'Studio',exact:true}).click();
    }finally{release();await page.unroute(pattern);}
  }
  const beforeFailure=await page.evaluate(()=>window.mteHost.getScene());await page.route(pattern,route=>route.abort());
  await selectAsset(page,target);await page.waitForFunction(()=>!window.mteStudio.assetLoadBusy&&window.mteStudio.activeLoads===0);assert.deepEqual(await page.evaluate(()=>window.mteHost.getScene()),beforeFailure);assert.equal(await page.evaluate(()=>window.mteHost.getState().busy),false);assert.equal(await page.locator('#cancel-asset-load').isVisible(),false);
  await page.unroute(pattern);await selectAsset(page,target);await page.waitForFunction(()=>window.mteStudio.groups.at(-1)?.presentation.id==='Spines/painting/301301101_spine'&&!window.mteStudio.assetLoadBusy);assert.deepEqual(errors,[]);
  const portrait='appearance:3013001',portraitPattern='**/assets/portraits/3013001_lihui/*.png',beforePortrait=await page.evaluate(()=>window.mteHost.getScene());
  let releasePortrait;const portraitWaiting=new Promise(resolve=>releasePortrait=resolve);
  await page.route(portraitPattern,async route=>{await portraitWaiting;await route.continue().catch(()=>{});});
  try{
    await selectAsset(page,portrait);await page.waitForFunction(()=>window.mteStudio.assetLoadBusy&&window.mteStudio.activeLoads>0);
    await page.locator('#cancel-asset-load').click();
    await page.waitForFunction(()=>window.mteStudio.activeLoads===0&&!window.mteStudio.assetLoadBusy,{},{timeout:3000});
    assert.deepEqual(await page.evaluate(()=>window.mteHost.getScene()),beforePortrait);
    const liveTextures=await page.evaluate(()=>window.loadingTextures.size);releasePortrait();await page.waitForTimeout(500);
    assert.equal(await page.evaluate(()=>window.loadingTextures.size),liveTextures,'Cancelled portrait allocated a late texture');
    assert.deepEqual(await page.evaluate(()=>window.mteHost.getScene()),beforePortrait);
  }finally{releasePortrait();await page.unroute(portraitPattern);}
  await selectAsset(page,portrait);await page.waitForFunction(()=>window.mteStudio.groups.at(-1)?.appearanceId==='3013001'&&!window.mteStudio.assetLoadBusy);
  assert.deepEqual(errors,[]);
  console.log(engine+': real asset loading checks passed: Gallery/Studio, busy host, detached preparation, cancellation, workspace switch, replacement, failed request, portrait cancellation and retry');
}finally{await close();}
