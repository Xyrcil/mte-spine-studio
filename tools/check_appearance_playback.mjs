import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {launchTestBrowser} from './test_browser.mjs';
import {selectAsset} from './select_asset.mjs';
import {openViewerMenu} from './viewer_actions.mjs';
import {expandStationDrawings} from '../src/engine/station-drawing.js';
import {voiceAppearance,mainViewVoiceBinding,mainViewEntryVoice,mainViewIdleVoices} from '../src/engine/voice-catalog.js';
import {MainViewSpeech,chineseCaptionPolicy} from '../src/engine/main-view-speech.js';
import {audioResourceLookup} from '../src/engine/audio.js';

const library=JSON.parse(readFileSync('public/assets/library.json'));
const entries=JSON.parse(readFileSync('public/assets/runtime-index.json')).entries;
const presentations=expandStationDrawings(JSON.parse(readFileSync('public/assets/presentations.json')).presentations,library,entries);
const lookup=audioResourceLookup(JSON.parse(readFileSync('public/assets/audio-index.json')),library.soundResources);
const sourceRows=library.appearances.filter(row=>['skin','painting'].includes(row.kind)||row.stationDrawingId);
const availability=(name,language)=>chineseCaptionPolicy(library,name,language)?library.mainViewVoices.captions[name]?'caption-only':'caption-missing':lookup.resolve(name,language,true)?'audio':'audio-missing';
const audit=sourceRows.map(appearance=>{
  const object={appearanceId:appearance.id,bundle:appearance.bundle},canonical=voiceAppearance(library,object),binding=mainViewVoiceBinding(library,object);
  const group={...object,id:appearance.id,kind:appearance.displayKind==='static'?'image':'spine',visible:true,presentation:{id:appearance.bundle}};
  const speech=new MainViewSpeech({});speech.configure(library,lookup);
  if(binding){const restricted=group.kind==='spine'&&!binding.drawingId&&library.mainViewVoices.touchRules.some(rule=>rule.id===canonical.id&&rule.spineTouch>0);assert.equal(speech.touchAllowed(group),!restricted);}
  const names=binding?[mainViewEntryVoice(library,object).resourceName,mainViewEntryVoice(library,object,{birthday:true}).resourceName,...mainViewIdleVoices(library,object).map(row=>row.resourceName)]:[];
  return {id:appearance.id,bundle:appearance.bundle,kind:appearance.stationDrawingId?'station':appearance.kind,binding:binding||null,entranceItem:canonical?.entranceItem??null,touchAllowed:binding?speech.touchAllowed(group):false,voices:names.map(name=>({name,original:availability(name,'a_sound_voiceeff'),chinese:availability(name,'a_sound_voiceeff_ch')}))};
});
const entrances=library.appearances.filter(row=>row.kind==='skin'&&!row.variantOf&&row.entranceItem>0);
assert.ok(entrances.length,'No entrance metadata imported');assert.ok(library.mainViewVoices.entryVoices.every(row=>row.exactResource));
const engine=process.argv[2]||'chromium',{browser,close}=await launchTestBrowser(engine),results={engine,silent:true,characters:library.characters.length,catalogue:audit,entrances:[],checks:[],errors:[]};
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(20000);page.on('pageerror',error=>results.errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteHost?.getState().ready&&!window.mteEditor.busy);
  for(const appearance of entrances){
    await page.evaluate(()=>window.mteHost.resume());await selectAsset(page,appearance.bundle);
    await page.waitForFunction(id=>window.mteStudio.groups[0]?.presentation.id===id&&!window.mteEditor.busy,appearance.bundle);
    const result=await page.evaluate(()=>{
      const stage=window.mteStudio,group=stage.groups[0];window.mteHost.pause();
      const entering=group.layers.filter(layer=>layer.active&&layer.state.getCurrent(0)?.animation.name==='start');
      const initial=entering.map(layer=>{const track=layer.state.getCurrent(0);return {id:layer.instance.id,name:track.animation.name,loop:track.loop,next:track.next?.animation.name,duration:track.animation.duration};});
      const duration=Math.max(0,...initial.map(row=>row.duration))+.5;
      for(let time=0;time<duration;time+=1/60)stage.evaluate(Math.min(1/60,duration-time));stage.draw();
      return {bundle:group.presentation.id,initial,settled:entering.map(layer=>layer.state.getCurrent(0)?.animation.name),controllerLocks:group.controllers.filter(root=>root.value?.animation==='start').length,muted:window.mteAudio.element.muted,glError:stage.gl.getError()};
    });
    assert.ok(result.initial.length,appearance.id+': entrance must start');assert.ok(result.initial.every(row=>!row.loop&&row.next==='animation'));
    assert.ok(result.settled.every(name=>name==='animation'));assert.equal(result.controllerLocks,0);assert.equal(result.muted,true);assert.equal(result.glError,0);results.entrances.push(result);
  }
  await page.evaluate(()=>window.mteHost.resume());await selectAsset(page,entrances[0].bundle);await page.waitForFunction(()=>!window.mteEditor.busy);
  await openViewerMenu(page);await page.locator('#editor-toggle').click();await page.waitForFunction(()=>document.querySelector('#viewer-menu').hidden);
  await page.locator('#entrance-mode').selectOption('locked');await page.locator('#replay-arrival').click();
  assert.equal(await page.evaluate(()=>window.mteStudio.groups[0].layers.some(layer=>layer.active&&layer.state.getCurrent(0)?.animation.name==='start')),false);
  await page.locator('#entrance-mode').selectOption('unlocked');await page.locator('#replay-arrival').click();
  assert.equal(await page.evaluate(()=>window.mteStudio.groups[0].layers.some(layer=>layer.active&&layer.state.getCurrent(0)?.animation.name==='start')),true);
  await page.locator('#automatic-voices').scrollIntoViewIfNeeded();
  if(engine==='chromium')await page.screenshot({path:'private/ui-arrival.png'});
  await page.setViewportSize({width:390,height:844});await page.locator('#automatic-voices').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(engine==='chromium')await page.screenshot({path:'private/ui-arrival-narrow.png'});
  results.checks.push('locked/unlocked replay controls','390px layout');
  await page.keyboard.press('Escape');
  const shield=library.mainViewVoices.chineseCaptions.players[0],shieldAppearance=library.appearances.find(row=>row.id===String(shield));assert.ok(shieldAppearance?.bundle);
  await page.evaluate(()=>{window.mteAudio.language='a_sound_voiceeff_ch';window.mteGallerySpeech.setPreference('birthday',false);});await selectAsset(page,shieldAppearance.bundle);
  await page.waitForFunction(()=>!window.mteEditor.busy&&window.mteAudio.externalCaption?.text);
  assert.equal(await page.evaluate(()=>window.mteAudio.currentVoice===null&&!window.mteAudio.element.hasAttribute('src')),true);
  results.checks.push('Chinese source entry caption without audio');
  await page.evaluate(()=>{window.mteGallerySpeech.setPreference('birthday',true);window.mteGallerySpeech.enter(window.mteStudio.groups[0],{animations:false});});
  assert.equal(await page.evaluate(()=>window.mteStudio.mainViewSpeech.value.captionOnly.name.endsWith('_Birthday')),true);results.checks.push('explicit birthday preview');
  const station=presentations.find(row=>row.stationDrawing?.id==='100101');assert.ok(station);
  await page.evaluate(()=>{window.mteAudio.language='a_sound_voiceeff';window.mteGallerySpeech.setPreference('birthday',false);});await selectAsset(page,station.id);
  await page.waitForFunction(()=>window.mteAudio.currentVoice?.voice.resourceName==='Voice_3000001_Login'&&window.mteAudio.element.currentTime>.03);
  assert.equal(await page.evaluate(()=>window.mteAudio.element.muted),true);results.checks.push('station entry speaker');
  await page.evaluate(async()=>{
    const {loadLocalScene}=await import('/src/engine/scene.js'),id=window.mteStudio.groups[0].id,deadline=performance.now()+10000;
    while((await loadLocalScene())?.objects[0]?.id!==id){if(performance.now()>deadline)throw new Error('Current scene was not autosaved');await new Promise(resolve=>setTimeout(resolve,25));}
  });
  const before=await page.evaluate(()=>JSON.stringify(window.mteStudio.groups[0].layers.map(layer=>layer.state.getCurrent(0)?.animation.name)));
  await page.reload();await page.waitForFunction(()=>window.mteHost?.getState().ready&&!window.mteEditor.busy);
  assert.equal(await page.evaluate(()=>JSON.stringify(window.mteStudio.groups[0].layers.map(layer=>layer.state.getCurrent(0)?.animation.name))),before);results.checks.push('restored scene retains authored tracks');
  assert.deepEqual(results.errors,[]);results.passed=true;
}catch(error){results.failure=error.message;throw error;
}finally{
  await close();writeFileSync(`private/acceptance-arrival-${engine}.json`,JSON.stringify(results,null,2)+'\n');
}
console.log(JSON.stringify({engine,characters:results.characters,appearances:audit.length,unbound:audit.filter(row=>!row.binding).map(row=>row.bundle),entrances:results.entrances.length,checks:results.checks,passed:results.passed}));
