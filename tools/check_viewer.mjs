import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';
import {selectAsset} from './select_asset.mjs';
import {openViewerMenu,selectView,togglePlayback} from './viewer_actions.mjs';

const engine=process.argv[2]||'chromium',capture=process.argv.includes('--capture');
const {browser,close}=await launchTestBrowser(engine);
try{
  if(process.argv.includes('--web')){
    await checkHostedWeb(browser,capture);
  }else if(process.argv.includes('--ui-hidden')){
    await checkUiHidden(browser,capture);
  }else{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.MTE_TEST_URL||'http://127.0.0.1:4173/');
  await page.waitForFunction(()=>window.mteHost?.getState().ready&&!window.mteEditor.busy);
  await page.evaluate(()=>window.mteI18n.setLocale('en'));
  const shot=async name=>{if(capture)await page.screenshot({path:`private/ui-${name}.png`});};
  const canvas=page.locator('#stage'),menu=page.locator('#viewer-menu'),library=page.locator('.library'),inspector=page.locator('.inspector');
  assert.equal(await library.isVisible(),false);assert.equal(await inspector.isVisible(),false);
  assert.equal(await page.evaluate(()=>window.mteStudio.paused),false);
  assert.ok((await page.evaluate(()=>window.mteStudio.groups[0].presentation.id)).endsWith('_spine'));
  const bounds=await canvas.boundingBox();assert.deepEqual([bounds.x,bounds.y,bounds.width,bounds.height],[0,0,1440,900]);
  await page.waitForFunction(()=>document.querySelector('#status').classList.contains('is-quiet'));await shot('viewer');
  await canvas.click({button:'right',position:{x:1435,y:895}});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#viewer-menu')).opacity==='1');
  const edge=await menu.boundingBox();assert.ok(edge.x>=12&&edge.y>=12&&edge.x+edge.width<=1428&&edge.y+edge.height<=888);
  assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'),'true');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'library-toggle');
  await shot('menu');await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.id),'editor-toggle');
  await page.keyboard.press('Escape');assert.equal(await canvas.evaluate(node=>node===document.activeElement),true);
  await openViewerMenu(page);await page.locator('#library-toggle').click();
  await page.waitForFunction(()=>document.querySelector('#viewer-menu').hidden);assert.equal(await library.isVisible(),true);assert.equal(await inspector.isVisible(),false);
  assert.deepEqual(await canvas.boundingBox(),bounds);await shot('library');
  await page.keyboard.press('Escape');assert.equal(await library.isVisible(),false);
  await selectView(page,'studio');assert.equal(await inspector.isVisible(),true);assert.equal(await page.locator('body').getAttribute('data-view'),'studio');
  const group=await page.evaluate(()=>window.mteEditor.selected().id);
  await page.getByLabel('X',{exact:true}).fill('2');await page.getByLabel('X',{exact:true}).press('Tab');
  assert.equal(await page.evaluate(()=>window.mteEditor.selected().x),2);await page.locator('#undo').click();
  await page.waitForFunction(()=>!window.mteEditor.busy);assert.equal(await page.evaluate(()=>window.mteEditor.selected().id),group);
  await shot('controls');
  await page.keyboard.press('Escape');assert.equal(await inspector.isVisible(),false);assert.equal(await page.locator('body').getAttribute('data-view'),'gallery');
  await selectAsset(page,'Spines/painting/301601601_spine');
  await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/painting/301601601_spine'&&!window.mteEditor.busy);
  assert.equal(await library.isVisible(),false);
  await togglePlayback(page);assert.equal(await page.evaluate(()=>window.mteStudio.paused),true);
  await selectView(page,'export');assert.equal(await inspector.isVisible(),true);assert.equal(await page.locator('#export-panel').isVisible(),true);
  for(const [key,value] of [['width','160'],['height','120'],['end','.2']])await page.locator(`#export-${key}`).fill(value);
  await page.locator('#export-format').selectOption('png');
  const result=await page.evaluate(async()=>{const output=await window.mteExporter.run();return {type:output?.blob.type,frames:output?.plan.frames};});
  assert.deepEqual(result,{type:'image/png',frames:1});await shot('export');
  await page.getByRole('button',{name:'Close controls',exact:true}).click();assert.equal(await page.locator('body').getAttribute('data-view'),'gallery');
  const oldLength=await page.evaluate(()=>window.mteEditor.snapshot().objects.length);
  for(const width of engine==='chromium'?[820,390]:[390]){
    await page.setViewportSize({width,height:844});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await canvas.focus();await page.keyboard.press('Shift+F10');
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#viewer-menu')).opacity==='1');await shot(`menu-${width}`);
    const rect=await menu.boundingBox();assert.ok(rect.x>=12&&rect.x+rect.width<=width-12);
    await page.locator('#library-toggle').click();await page.waitForFunction(()=>document.querySelector('#viewer-menu').hidden);await shot(`library-${width}`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.ok((await library.boundingBox()).height<844);await page.keyboard.press('Escape');
    await selectView(page,'export');assert.equal(await page.getByRole('button',{name:'Close controls',exact:true}).isVisible(),true);
    await page.keyboard.press('Escape');assert.equal(await inspector.isVisible(),false);
  }
  await page.emulateMedia({reducedMotion:'reduce'});await openViewerMenu(page);
  assert.equal(await menu.evaluate(node=>getComputedStyle(node).transitionDuration),'0s');
  const camera=await page.evaluate(()=>structuredClone(window.mteStudio.camera));
  await canvas.click({position:{x:20,y:700}});assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'),'false');
  assert.deepEqual(await page.evaluate(()=>window.mteStudio.camera),camera);assert.equal(await page.evaluate(()=>window.mteEditor.snapshot().objects.length),oldLength);
  assert.deepEqual(errors,[]);
  console.log(`${engine}: immersive viewer, menu edges/keyboard/dismissal, stable canvas, scene undo, non-HX selection, PNG export, narrow panels and reduced motion passed`);
  }
}finally{await close();}

async function checkHostedWeb(browser,capture){
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],external=[],failed=[];
  const address=process.env.MTE_TEST_URL||'http://127.0.0.1:4175/';
  page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/^https?:/.test(request.url())&&new URL(request.url()).origin!==new URL(address).origin)external.push(request.url());});
  page.on('response',response=>{if(response.status()>=400)failed.push(new URL(response.url()).pathname);});
  const ready=async()=>{try{await page.waitForFunction(()=>window.mteHost?.getState().ready&&!window.mteEditor.busy&&window.mteStudio.groups.length,null,{timeout:90000});}catch(error){throw new Error(await page.locator('#status').textContent(),{cause:error});}};
  await page.goto(address);await ready();await page.evaluate(()=>window.mteI18n.setLocale('en'));
  const initial=await page.evaluate(async()=>({bundle:window.mteStudio.groups[0].presentation.id,cacheReady:await window.mteCache.ready,imported:await window.mtePack.refresh(),hostMuted:window.mteAudio.hostOutput.muted}));
  assert.deepEqual(initial,{bundle:'Spines/painting/3014027_spine',cacheReady:true,imported:null,hostMuted:false});
  if(capture)await page.screenshot({path:'private/ui-web.jpg',type:'jpeg',quality:75});
  const mappedAudio=await page.evaluate(async()=>{
    const aliases=(await (await fetch('./assets/resource-map.json')).json()).aliases,audio=window.mteAudio;
    const entry=[...audio.byName.values()].flat().find(row=>{const path=row.clips?.[0]?.path;return aliases[path]&&audio.soundInfo(row.name,row.category).clip?.path===path;});
    if(!entry)throw new Error('No aliased audio sample is available');
    const element=await audio.playEffect(entry.name,entry.category);
    return {target:new URL('./assets/'+aliases[entry.clips[0].path],location.href).href,src:element.src,muted:element.muted};
  });
  assert.equal(mappedAudio.src,mappedAudio.target);assert.equal(mappedAudio.muted,true);
  await page.evaluate(()=>window.mteAudio.stopEffects());
  await openViewerMenu(page);await page.locator('#viewer-mute').click();assert.equal(await page.evaluate(()=>window.mteAudio.muted),true);
  await openViewerMenu(page);await page.locator('#viewer-mute').click();assert.equal(await page.evaluate(()=>window.mteAudio.muted),false);
  await selectAsset(page,'Spines/painting/301602402_spine');await ready();
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
  assert.equal(await page.evaluate(()=>window.mteStudio.groups[0].layers.length),6);
  await openViewerMenu(page);await page.locator('#viewer-hide-ui').click();assert.equal(await page.locator('.viewer-header').isVisible(),false);
  await page.locator('#stage').click({button:'right',position:{x:100,y:100}});assert.equal(await page.locator('#viewer-menu').isVisible(),true);
  await selectView(page,'studio');const previous=await page.evaluate(()=>window.mteEditor.selected().x);
  await page.getByLabel('X',{exact:true}).fill(String(previous+2));await page.getByLabel('X',{exact:true}).press('Tab');
  assert.equal(await page.evaluate(()=>window.mteEditor.selected().x),previous+2);await page.locator('#undo').click();await ready();
  assert.equal(await page.evaluate(()=>window.mteEditor.selected().x),previous);
  await selectView(page,'export');for(const [key,value] of [['width','160'],['height','120'],['end','.1']])await page.locator('#export-'+key).fill(value);
  await page.locator('#export-format').selectOption('png');
  const exported=await page.evaluate(async()=>{const value=await window.mteExporter.run();return {type:value?.blob.type,frames:value?.plan.frames};});
  assert.deepEqual(exported,{type:'image/png',frames:1});
  await selectView(page,'studio');await page.locator('#cache-scene').click();
  await page.waitForFunction(()=>!document.querySelector('#cache-scene').disabled&&document.querySelector('#cache-status').textContent.includes('MiB cached'),null,{timeout:60000});
  const cache=await page.evaluate(()=>window.mteCache.request('STATUS'));assert.ok(cache.entries>0);assert.equal(cache.pack,null);
  await selectView(page,'gallery');await page.context().setOffline(true);await page.reload();await ready();
  assert.equal(await page.evaluate(()=>window.mteStudio.groups[0].presentation.id),'Spines/painting/301602402_spine');
  await page.context().setOffline(false);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(failed,[]);
  console.log(JSON.stringify({web:true,initial,sharedAudio:true,interaction:true,noUi:true,undo:true,png:true,offlineScene:true,cacheBytes:cache.bytes,mutedCheck:true}));
}

async function checkUiHidden(browser,capture){
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],external=[],failed=[];
  page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.__mteHostState={paused:false,muted:true,volume:0,fps:24};});
  const address=process.env.MTE_TEST_URL||'http://127.0.0.1:4173/';
  page.on('request',request=>{if(/^https?:/.test(request.url())&&new URL(request.url()).origin!==new URL(address).origin)external.push(request.url());});
  page.on('response',response=>{if(response.status()>=400)failed.push(new URL(response.url()).pathname);});
  const ready=()=>page.waitForFunction(()=>window.mteHost?.getState().ready&&!window.mteEditor.busy&&window.mteStudio.groups.length,null,{timeout:45000});
  await page.goto(address);await ready();
  await page.evaluate(()=>window.mteI18n.setLocale('en'));
  const canvas=page.locator('#stage'),header=page.locator('.viewer-header');
  const baseline=await page.evaluate(()=>{
    const stage=window.mteStudio,group=stage.groups[0],audio=window.mteAudio;
    return {camera:{...stage.camera},id:group.id,x:group.x,y:group.y,paused:stage.paused,speed:stage.speed,muted:audio.muted,volume:audio.volume,clock:group.layers[0].state.getCurrent(0).trackTime};
  });
  await openViewerMenu(page);await page.locator('#viewer-hide-ui').click();
  assert.equal(await header.isVisible(),false);
  assert.equal(await page.locator('#status').isVisible(),false);
  assert.equal(await page.locator('#viewer-menu').isVisible(),false);
  assert.equal(await page.evaluate(()=>window.mteStudio.uiHidden),true);
  assert.equal(await page.evaluate(()=>window.mteHost.getSession().ui.uiHidden),true);
  assert.deepEqual(await canvas.boundingBox(),{x:0,y:0,width:1440,height:900});
  const probe=await page.evaluate(()=>{
    const workspace=document.createElement('div'),portal=document.createElement('div');
    workspace.textContent='Late notice and subtitle';portal.textContent='Late overlay';
    document.querySelector('.workspace').append(workspace);document.body.append(portal);
    let calls=0;
    const stage=window.mteStudio,group=stage.groups[0],native=group.nativeTextLayer,dialogue=group.dialogueTypography,images=group.nativeImages;
    try{
      group.nativeTextLayer={slots:[{used:true,source:{transform:'hidden-text-probe'}}],draw(){calls++;}};
      group.dialogueTypography={prepare(){calls++;},draw(){calls++;}};
      group.nativeImages=[...(images||[]),{used:true,source:{viewportDecoration:true}}];
      stage.draw();
      const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),visible=[];
      while(walker.nextNode()){const node=walker.currentNode;if(node.textContent.trim()&&node.parentElement.getClientRects().length)visible.push(node.textContent.trim());}
      return {calls,visible,workspace:getComputedStyle(workspace).display,portal:getComputedStyle(portal).display,outline:getComputedStyle(stage.canvas).outlineStyle};
    }finally{group.nativeTextLayer=native;group.dialogueTypography=dialogue;group.nativeImages=images;workspace.remove();portal.remove();}
  });
  assert.deepEqual(probe,{calls:0,visible:[],workspace:'none',portal:'none',outline:'none'});
  await page.waitForFunction(clock=>window.mteStudio.groups[0].layers[0].state.getCurrent(0).trackTime>clock,baseline.clock);
  const preserved=await page.evaluate(()=>{const stage=window.mteStudio,group=stage.groups[0],audio=window.mteAudio;return {camera:{...stage.camera},id:group.id,x:group.x,y:group.y,paused:stage.paused,speed:stage.speed,muted:audio.muted,volume:audio.volume};});
  const {clock,...expected}=baseline;assert.deepEqual(preserved,expected);
  if(capture)await page.screenshot({path:'private/ui-no-ui.jpg',type:'jpeg',quality:75});
  await page.evaluate(()=>window.mteHost.setHostState({paused:true}));
  const frozen=await page.evaluate(()=>window.mteStudio.groups[0].layers[0].state.getCurrent(0).trackTime);
  await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.mteStudio.groups[0].layers[0].state.getCurrent(0).trackTime),frozen);
  await page.evaluate(()=>window.mteHost.setHostState({paused:false}));
  await page.waitForFunction(clock=>window.mteStudio.groups[0].layers[0].state.getCurrent(0).trackTime>clock,frozen);
  assert.equal(await header.isVisible(),false);
  await page.keyboard.press('Escape');assert.equal(await header.isVisible(),true);
  await canvas.focus();await page.keyboard.press('h');assert.equal(await header.isVisible(),false);
  await canvas.click({button:'right',position:{x:100,y:100}});
  assert.equal(await header.isVisible(),true);assert.equal(await page.locator('#viewer-menu').isVisible(),true);
  await page.keyboard.press('h');await page.reload();await ready();
  assert.equal(await header.isVisible(),false);
  await page.evaluate(()=>window.mteHost.setMode('studio'));
  assert.equal(await header.isVisible(),true);assert.equal(await page.locator('.inspector').isVisible(),true);
  await page.locator('#scene-name').focus();await page.keyboard.press('h');
  assert.equal(await page.evaluate(()=>window.mteStudio.uiHidden),false);
  const forced=new URL(address);forced.searchParams.set('ui','0');
  await page.goto(forced.href);await ready();assert.equal(await header.isVisible(),false);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await header.isVisible(),false);assert.deepEqual(await canvas.boundingBox(),{x:0,y:0,width:390,height:844});
  await page.keyboard.press('h');assert.equal(await header.isVisible(),true);
  await openViewerMenu(page);await page.evaluate(()=>{window.mteStudio.assetLoadBusy=true;});
  try{await page.locator('#viewer-hide-ui').click();assert.equal(await page.evaluate(()=>window.mteStudio.uiHidden),false);}
  finally{await page.evaluate(()=>{window.mteStudio.assetLoadBusy=false;});}
  await page.goto(address);await ready();await openViewerMenu(page);await page.locator('#editor-toggle').click();
  await page.locator('#viewer-preferences summary').click();
  const shortcut=page.locator('#viewer-ui-shortcut');await shortcut.selectOption('');
  assert.equal(await page.locator('#viewer-hide-ui').getAttribute('aria-keyshortcuts'),null);
  await openViewerMenu(page);await page.locator('#viewer-hide-ui').click();await canvas.focus();await page.keyboard.press('h');
  assert.equal(await header.isVisible(),false);
  await canvas.click({button:'right',position:{x:100,y:100}});assert.equal(await header.isVisible(),true);
  await page.locator('#editor-toggle').click();await shortcut.selectOption('U');
  if(capture){await page.evaluate(()=>window.mteI18n.setLocale('zh-CN'));await page.screenshot({path:'private/ui-wallpaper-interface.jpg',type:'jpeg',quality:75});}
  await canvas.focus();await page.keyboard.press('h');assert.equal(await header.isVisible(),true);
  await page.keyboard.press('u');assert.equal(await header.isVisible(),false);
  const session=await page.evaluate(()=>window.mteHost.getSession());
  assert.equal(session.ui.preferences['mte-ui-shortcut'],'U');
  await page.reload();await ready();await canvas.focus();await page.keyboard.press('u');assert.equal(await header.isVisible(),true);
  await page.evaluate(async()=>{const session=window.mteHost.getSession();session.ui.uiHidden=false;session.ui.preferences['mte-ui-shortcut']='';await window.mteHost.restoreSession(session);});
  assert.equal(await shortcut.inputValue(),'');await canvas.focus();await page.keyboard.press('u');assert.equal(await header.isVisible(),true);
  const storage=await page.evaluate(async()=>({registrations:navigator.serviceWorker?(await navigator.serviceWorker.getRegistrations()).length:0,cacheEntries:'caches' in window?(await caches.keys()).length:0}));
  assert.deepEqual(storage,{registrations:0,cacheEntries:0});assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(failed,[]);
  console.log(`${engine}: no-UI canvas, hidden text layers, mouse recovery with shortcut off, remapped shortcut, session/refresh preferences, host pause/resume/editor entry, unchanged scene/audio, URL override and narrow viewport passed; no external requests or browser asset copies; muted`);
}
