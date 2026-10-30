import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';
import {selectAsset} from './select_asset.mjs';

const address=process.argv[2]||'http://127.0.0.1:4175/';
const {browser,close}=await launchTestBrowser('chromium');
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],failed=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)failed.push(new URL(response.url()).pathname);});
  page.on('request',request=>{const url=request.url();if(/^https?:/.test(url)&&new URL(url).origin!==new URL(address).origin)external.push(url);});
  await page.addInitScript(()=>{window.__mteHostState={paused:false,muted:true,volume:0,speed:1,fps:30,renderScale:1};});
  await page.goto(address);
  await page.waitForFunction(()=>window.mteHost?.getState().ready&&!window.mteEditor?.busy&&window.mteStudio?.groups.length>0,null,{timeout:60000});
  const first=await page.evaluate(async()=>{
    const api=window.mteHost,stage=window.mteStudio,audio=window.mteAudio,initial=api.getScene();
    let draws=0;const draw=stage.draw.bind(stage);stage.draw=(...args)=>{draws++;return draw(...args);};
    await api.setHostState({paused:true,muted:true,volume:0,fps:24,renderScale:.5});
    const frozen=stage.groups[0].layers[0].state.getCurrent(0).trackTime,at=draws;
    await new Promise(resolve=>setTimeout(resolve,150));
    if(stage.groups[0].layers[0].state.getCurrent(0).trackTime!==frozen||draws!==at||stage.frame!==null)throw new Error('Host pause is still rendering');
    if(api.getScene().paused!==initial.paused||api.getScene().speed!==initial.speed)throw new Error('Host settings modified the authored scene');
    if(stage.canvas.width!==720||stage.canvas.height!==450)throw new Error('Render scale was not applied');
    const width=stage.canvas.width;
    const session=api.getSession();session.scene.camera.x+=.25;await api.restoreSession(session);
    if(stage.camera.x!==session.scene.camera.x)throw new Error('Camera was not restored');
    const voice=audio.currentVoice?.voice.resourceName;
    await api.setHostState({paused:false,speed:1.25,renderScale:1});await new Promise(resolve=>setTimeout(resolve,150));
    if(draws<=at||stage.groups[0].layers[0].state.getCurrent(0).trackTime<=frozen)throw new Error('Host resume did not advance');
    await api.setHostState({paused:true});
    if(!audio.element.muted||[...audio.effects].some(element=>!element.muted))throw new Error('Check is not muted');
    return {version:api.version,bundle:stage.groups[0].presentation.id,scaledWidth:width,voice,session:api.getSession()};
  });
  await page.evaluate(()=>window.mteHost.setHostState({paused:false,speed:1}));
  await selectAsset(page,'Spines/painting/301602402_spine');
  await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/painting/301602402_spine'&&!window.mteEditor.busy);
  const head=await page.evaluate(()=>{
    const stage=window.mteStudio,group=stage.groups[0],root=group.controllers[0],hit=root.hotspots.find(row=>row.name==='HitArea_head1');
    window.mteAudio.stopEffects();stage.fit();stage.evaluate(0);stage.draw();
    const rect=stage.canvas.getBoundingClientRect(),width=Math.max(stage.camera.width,stage.camera.height*rect.width/rect.height),height=width*rect.height/rect.width;
    for(const collider of hit.colliders)for(const fx of [-.8,0,.8])for(const fy of [-.8,0,.8]){
      const d=collider.data,m=root.matrix(hit),x=(d.m_Offset?.x||0)+(d.m_Size?.x||0)*fx/2,y=(d.m_Offset?.y||0)+(d.m_Size?.y||0)*fy/2,world={x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]};
      if(root.hitAt(world.x,world.y)?.id===hit.id)return {x:rect.left+((world.x-stage.camera.x)/width+.5)*rect.width,y:rect.top+(.5-(world.y-stage.camera.y)/height)*rect.height};
    }
    throw new Error('Source head region is unavailable');
  });
  await page.mouse.click(head.x,head.y);
  await page.waitForFunction(()=>[...window.mteAudio.effects].some(element=>element.effectName==='301602402_click_head'&&element.currentTime>0));
  await page.evaluate(()=>window.mteHost.setHostState({paused:true}));
  first.session=await page.evaluate(()=>window.mteHost.getSession());first.voice=await page.evaluate(()=>window.mteAudio.currentVoice?.voice.resourceName);
  assert.equal(first.session.scene.objects[0].layers.length,6);
  await page.locator('#menu-toggle').click();await page.locator('#editor-toggle').click();
  assert.equal(await page.locator('#cache-panel').count(),0);assert.equal(await page.locator('#resource-pack-panel').count(),0);
  assert.equal(await page.locator('#scene-inspector').isVisible(),true);
  await page.locator('#scene-name').fill('Wallpaper saved scene');await page.locator('#scene-name').dispatchEvent('change');
  await page.locator('#save-scene').click();await page.waitForFunction(()=>window.mteHost.getSession().ui.savedScenes.some(row=>row.key==='Wallpaper saved scene'));
  first.session=await page.evaluate(()=>window.mteHost.getSession());
  await page.screenshot({path:'private/ui-wallpaper.jpg',type:'jpeg',quality:75});
  const replacement=await browser.newPage({viewport:{width:1440,height:900}});replacement.on('pageerror',error=>errors.push(error.message));
  await replacement.addInitScript(session=>{window.__mteHostState={paused:true,muted:true,volume:0,speed:1,fps:30,renderScale:1};window.__mteHostSession=session;},first.session);
  await replacement.goto(address);await replacement.waitForFunction(()=>window.__mteHostSessionConsumed===true,null,{timeout:60000});
  const restored=await replacement.evaluate(()=>({scene:window.mteHost.getScene(),voice:window.mteAudio.currentVoice?.voice.resourceName,ready:window.mteHost.getState().ready}));
  assert.equal(restored.scene.objects[0].id,first.session.scene.objects[0].id);
  assert.deepEqual(restored.scene.camera,first.session.scene.camera);assert.equal(restored.voice,first.voice);
  assert.equal(await replacement.locator('#saved-scenes option[value="Wallpaper saved scene"]').count(),1);
  const storage=await replacement.evaluate(async()=>({registrations:navigator.serviceWorker?(await navigator.serviceWorker.getRegistrations()).length:0,cacheEntries:'caches' in window?(await caches.keys()).length:0}));
  assert.deepEqual(storage,{registrations:0,cacheEntries:0});assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert.deepEqual(external,[]);
  console.log(JSON.stringify({checks:11,version:first.version,bundle:first.bundle,interactiveBundle:first.session.scene.objects[0].bundle,scaledWidth:first.scaledWidth,sessionRestored:restored.ready,savedSceneRestored:true,storage,muted:true}));
}finally{await close();}
