import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';
import {selectAsset} from './select_asset.mjs';
import {selectView,openViewerMenu} from './viewer_actions.mjs';

const engine=process.argv[2]||'chromium',{browser,close}=await launchTestBrowser(engine);
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteHost?.getState().ready&&!window.mteEditor.busy);
  assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');assert.equal(await page.locator('#menu-toggle').textContent(),'菜单');
  await selectAsset(page,'Spines/painting/301602402_spine');
  await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/painting/301602402_spine'&&!window.mteEditor.busy);
  await page.waitForFunction(()=>window.mteAudio.currentVoice?.voice.resourceName==='Voice_3016024_Login'&&window.mteAudio.element.currentTime>.03);
  assert.equal(await page.evaluate(()=>window.mteAudio.element.muted),true);
  const soundPoint=await page.evaluate(async()=>{
    const {point}=await import('/src/engine/geometry.js'),stage=window.mteStudio,group=stage.groups[0],root=group.controllers[0],hit=root.hotspots.find(row=>row.name==='HitArea_head1');
    window.mteAudio.stop();window.mteAudio.stopEffects();root.reset();for(const layer of root.layers){layer.state.clearTracks();layer.skeleton.setToSetupPose();}root.play('animation',0,true);stage.evaluate(0);stage.fit();stage.draw();
    window.voiceCheckEvents=[];stage.addEventListener('sound-request',event=>window.voiceCheckEvents.push(event.detail.name));
    const rect=stage.canvas.getBoundingClientRect(),width=Math.max(stage.camera.width,stage.camera.height*rect.width/rect.height),height=width*rect.height/rect.width;
    if(!group.isActiveTransform(hit.transform))return null;
    for(const collider of hit.colliders)for(const fx of [-.8,-.4,0,.4,.8])for(const fy of [-.8,-.4,0,.4,.8]){
      const data=collider.data,world=point(root.matrix(hit),(data.m_Offset?.x||0)+(data.m_Size?.x||0)*fx/2,(data.m_Offset?.y||0)+(data.m_Size?.y||0)*fy/2);
      if(root.hitAt(world.x,world.y)?.id!==hit.id)continue;
      const x=rect.left+((world.x-stage.camera.x)/width+.5)*rect.width,y=rect.top+(.5-(world.y-stage.camera.y)/height)*rect.height;
      if(x>0&&x<rect.width&&y>0&&y<rect.height)return {x,y};
    }
    return null;
  });
  assert.ok(soundPoint,'The source head area must be physically hittable');await page.mouse.click(soundPoint.x,soundPoint.y);
  await page.waitForFunction(()=>[...window.mteAudio.effects].some(effect=>effect.effectName==='301602402_click_head'&&effect.currentTime>.03));
  const physicalSound=await page.evaluate(()=>({events:window.voiceCheckEvents,effects:[...window.mteAudio.effects].map(effect=>({name:effect.effectName,volume:effect.volume,muted:effect.muted}))}));
  assert.ok(physicalSound.events.includes('301602402_click_head'));assert.ok(physicalSound.effects.every(effect=>effect.muted));
  const alternating=await page.evaluate(()=>{
    const stage=window.mteStudio,root=stage.groups[0].controllers[0],hit=root.hotspots.find(row=>row.name==='HitArea_horn2'),out=[];
    root.reset();window.voiceCheckEvents.length=0;
    for(let index=0;index<2;index++){root.unlocked();const start=window.voiceCheckEvents.length,result=root.click(hit);out.push({animation:result.animation,sounds:window.voiceCheckEvents.slice(start)});}
    const silent=root.hotspots.find(row=>row.name==='HitArea_chest');root.unlocked();window.voiceCheckEvents.length=0;root.click(silent);
    return {out,chestSounds:window.voiceCheckEvents};
  });
  assert.deepEqual(alternating.out,[{animation:'click_1_horn1',sounds:['301602402_click_1_horn']},{animation:'click_1_horn1_02',sounds:['301602402_click_2_horn']}]);assert.deepEqual(alternating.chestSounds,[]);
  await selectAsset(page,'Spines/painting/3016024_spine');await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/painting/3016024_spine'&&!window.mteEditor.busy);
  const speech=await page.evaluate(()=>{
    const stage=window.mteStudio,group=stage.groups[0],rect=stage.canvas.getBoundingClientRect();window.mteAudio.stop();stage.mainViewSpeechClock.finish();stage.fit();
    const result=window.mteGallerySpeech.touchAt(rect.width/2,rect.height/2);return {result,group:group.id};
  });assert.equal(speech.result.accepted,true);
  await page.waitForFunction(()=>window.mteAudio.currentVoice?.voice.resourceName.includes('Voice_3016024_Touch_')&&window.mteAudio.element.currentTime>.03);
  const idle=await page.evaluate(()=>{const stage=window.mteStudio;stage.mainViewSpeechClock.finish();stage.evaluate(120);return {name:window.mteAudio.currentVoice?.voice.resourceName,language:stage.mainViewSpeech.value.language};});
  assert.match(idle.name,/Voice_3016024_Greetings_Idel_0[12]/);assert.equal(idle.language,'a_sound_voiceeff');
  await selectView(page,'studio');await page.evaluate(()=>window.mteHost.pause());
  assert.equal(await page.locator('#inspector-title').textContent(),'场景');assert.equal(await page.locator('#undo').textContent(),'撤销');
  const name=page.locator('#scene-name');await name.fill('User Menu <source>');
  const before=await page.evaluate(()=>({objects:window.mteStudio.snapshot().objects,camera:window.mteStudio.camera,track:window.mteAudio.language}));
  await openViewerMenu(page);await page.locator('#interface-language').click();
  assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.equal(await page.locator('#undo').textContent(),'Undo');assert.equal(await name.inputValue(),'User Menu <source>');
  await page.locator('#interface-language').click();assert.equal(await page.locator('#undo').textContent(),'撤销');
  const after=await page.evaluate(()=>({objects:window.mteStudio.snapshot().objects,camera:window.mteStudio.camera,track:window.mteAudio.language}));assert.deepEqual(after,before);
  await page.keyboard.press('Escape');await selectView(page,'export');
  assert.equal(await page.locator('#run-export').textContent(),'导出媒体');assert.equal(await page.locator('#export-format').inputValue(),'mp4');
  await page.locator('#export-format').selectOption('png');await page.locator('#export-width').fill('160');await page.locator('#export-height').fill('120');await page.locator('#export-end').fill('.2');
  const output=await page.evaluate(async()=>{const out=await window.mteExporter.run();return {type:out?.blob.type,frames:out?.plan.frames};});assert.deepEqual(output,{type:'image/png',frames:1});
  await page.waitForFunction(()=>document.querySelector('#export-status').textContent.includes('导出'));
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.ok(await page.locator('[data-close-panel]').last().isVisible());
  if(engine==='chromium')await page.screenshot({path:'private/ui-localized-export.png'});
  await page.keyboard.press('Escape');await selectView(page,'gallery');await page.evaluate(()=>window.mteI18n.setLocale('en'));await page.reload();
  await page.waitForFunction(()=>window.mteHost?.getState().ready);assert.equal(await page.locator('html').getAttribute('lang'),'en');
  const blocked=await browser.newPage({viewport:{width:960,height:720}});blocked.setDefaultTimeout(15000);
  await blocked.addInitScript(()=>{const original=HTMLMediaElement.prototype.play;let once=true;HTMLMediaElement.prototype.play=function(...args){if(once){once=false;return Promise.reject(new DOMException('Autoplay blocked','NotAllowedError'));}return original.apply(this,args);};});
  await blocked.goto('http://127.0.0.1:4173/');await blocked.waitForFunction(()=>window.mteHost?.getState().ready&&!document.querySelector('#enable-sound').hidden);
  assert.equal(await blocked.locator('#enable-sound').textContent(),'启用声音');await blocked.locator('#enable-sound').click();await blocked.waitForFunction(()=>document.querySelector('#enable-sound').hidden&&window.mteAudio.element.currentTime>.03);
  assert.equal(await blocked.evaluate(()=>window.mteAudio.element.muted),true);await blocked.close();assert.deepEqual(errors,[]);
  console.log(JSON.stringify({engine,physicalSound,alternating,entry:'Voice_3016024_Login',touch:speech.result.animation,idle,locales:'zh-CN/en live + persisted',export:output,autoplayRecovery:true}));
}finally{await close();}
