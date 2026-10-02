import './style.css';
import './editor.css';
import './library.css';
import {Stage} from './engine/stage.js';
import {AudioBus} from './engine/audio.js';
import {createEditor} from './editor.js';
import {createExportPanel} from './export-panel.js';
import {createSoundPanel} from './sound-panel.js';
import {createVoicePanel} from './voice-panel.js';
import {createCachePanel} from './cache-panel.js';
import {createSequencePanel} from './sequence-panel.js';
import {createCanvasInput} from './canvas-input.js';
import {createAssetLibrary} from './asset-library.js';
import {createResourcePackPanel} from './resource-pack-panel.js';
import {resolveInteractionVoice,explicitInteractionEffect} from './engine/interaction-audio.js';

document.querySelector('#app').innerHTML = `
  <header><div class="brand">MTE <span>Spine Studio</span></div><nav><button data-view="gallery" class="selected">Gallery</button><button data-view="studio">Studio</button><button data-view="export">Export</button></nav><button id="library-toggle" aria-controls="asset-library" aria-expanded="false">Library</button><button id="editor-toggle" aria-expanded="false">Controls</button><button id="pause">Pause</button></header>
  <main><aside class="library" id="asset-library"><label for="search">Asset library</label><input id="search" placeholder="Search character, skin or resource"><label for="category">Artwork type</label><select id="category"><option value="">All types</option><option value="painting">Character artwork</option><option value="skin">Skins</option><option value="story">Story portraits</option><option value="storyCG">Story CG</option><option value="ui">Scenes / UI</option><option value="drawing">Other artwork</option><option value="portrait">Static portraits</option></select><div id="assets" role="list"></div></aside>
  <section class="workspace"><canvas id="stage" aria-label="Animated scene"></canvas><div id="status" role="status">Loading asset catalog…</div></section>
  <aside class="inspector"><h2>Scene</h2><div id="layers"></div><label>Background <input id="background" type="color" value="#191b20"></label><label>Playback speed <input id="speed" type="range" min="0.1" max="2" step="0.1" value="1"></label><button id="fit">Fit scene</button><div id="details"></div><p id="notice">Gallery plays interactions. Studio edits the scene.</p></aside></main>`;
const status = document.querySelector('#status');
let stage;
try{stage=new Stage(document.querySelector('#stage'));}catch(error){status.textContent=`Rendering could not start: ${error.message}. Check browser graphics support and reload.`;document.querySelector('.library').inert=true;document.querySelector('.inspector').inert=true;for(const button of document.querySelectorAll('header button'))button.disabled=true;window.mteStartupError=error.message;}
if(stage){
window.mteStudio = stage;
let view = 'gallery', catalog, runtime, request, libraryData, audio;
const message = value => {status.textContent=value;};
const closeLibrary=()=>{const open=document.body.classList.contains('library-open');document.body.classList.remove('library-open');document.querySelector('#library-toggle').setAttribute('aria-expanded','false');if(open&&matchMedia('(max-width:540px)').matches&&document.activeElement?.closest('.library'))stage.canvas.focus({preventScroll:true});};
const editor=createEditor(stage,message,group=>{window.mteLibrary?.setActive(group);if(group?.kind==='spine'){describe(group);voicePanel(group.presentation);}else if(group?.appearanceId){const appearance=libraryData.appearances.find(row=>row.id===group.appearanceId);describePortrait(appearance);voicePanel({appearanceId:group.appearanceId});}else{document.querySelector('#details').textContent=group?'Image layer':'';document.querySelector('#voice-panel')?.remove();}});
window.mteEditor=editor;
const exporter=createExportPanel(stage,editor,()=>({catalog,runtime,library:libraryData,audio}),message);window.mteExporter=exporter;
const resourceCache=createCachePanel(stage,editor,()=>({library:libraryData,audio,catalog,runtime}),message);window.mteCache=resourceCache;
window.mtePack=createResourcePackPanel(resourceCache,editor,message,stage);
window.mteSequence=createSequencePanel(stage,editor,message);
stage.addEventListener('sequence-paused',()=>audio?.pause());
stage.addEventListener('resource-import-start',()=>audio?.pause());
stage.addEventListener('resource-import-ended',()=>{if(!stage.paused)audio?.resume().catch(error=>message(error.message));});
stage.addEventListener('sequence-playing',()=>audio?.resume().catch(error=>message(error.message)));
const renderingRetry=document.createElement('button');renderingRetry.id='rendering-retry';renderingRetry.textContent='Retry rendering';renderingRetry.hidden=true;document.querySelector('header').append(renderingRetry);
let recoverySelection;
stage.addEventListener('rendering-pausing',()=>audio?.pause());
stage.addEventListener('rendering-lost',()=>{request?.abort();recoverySelection=editor.selected()?.id;audio?.pause();document.querySelector('.library').inert=true;renderingRetry.hidden=false;message('Rendering interrupted. The scene is retained; you can export its JSON while waiting for recovery.');});
stage.addEventListener('rendering-recovering',()=>{renderingRetry.disabled=true;message('Restoring scene textures and animation state…');});
stage.addEventListener('rendering-recovered',()=>{renderingRetry.disabled=false;renderingRetry.hidden=true;document.querySelector('.library').inert=view==='export';editor.choose(stage.groups.find(group=>group.id===recoverySelection)||stage.groups.at(-1));editor.changed();message('Rendering restored');});
stage.addEventListener('rendering-recovery-error',event=>{renderingRetry.disabled=false;renderingRetry.hidden=false;message(`Rendering recovery failed: ${event.detail}. The scene can still be saved.`);});
renderingRetry.onclick=()=>stage.recoverRendering().catch(error=>message(error.message));
function describe(group){
  const gaps=(group.controllers||[]).flatMap(root=>root.missingAnimations());
  const effects=(group.effects?.filter(effect=>effect.reason).length||0)+(group.presentation.visualAnimations?.filter(row=>row.type==='AnimationClip'&&!group.nativeAnimations?.some(native=>native.model?.clip.id===row.id)).length||0);
  const regions=group.presentation.hotspots.length+(group.controllers||[]).filter(root=>root.source.id==='hot-spring').reduce((count,root)=>count+root.hotspots.filter(hit=>hit.role).length,0);
  const parts=[...(group.presentation.standalone?['Standalone Spine preview']:[]),`${group.presentation.instances.length} skeleton instances`,`${regions} interaction regions`];
  if(group.presentation.hotSpringHouse){const root=group.controllers.find(root=>root.source.id==='hot-spring');parts.push(!root?'Hot spring focus configuration unavailable':root.decorationModels.size&&!root.decorationReason?root.dialoguePanelAvailable?group.dialogueTypography?.slots.length===2&&!group.dialogueTypography.reason?'Hot spring conversations · original fonts and panel · browser text rasterization needs visual verification':'Hot spring conversations · original decorations and panel · dialogue text not yet restored':'Hot spring conversations · original decorations · dialogue panel layout not yet restored':'Hot spring conversations · original dialogue decorations not yet restored');}
  if(libraryData?.appearances.some(row=>row.bundle===group.presentation.id&&row.hotSpringRoleId)&&!group.controllers.length)parts.push('Hot spring click behavior unavailable in this standalone asset');
  if(gaps.length)parts.push(`Missing source animations: ${[...new Set(gaps.map(row=>row.animation))].join(', ')}`);
  if(effects)parts.push(`Additional effects unavailable: ${effects}`);
  if(group.effects?.some(effect=>effect.verification))parts.push('Effect visual verification pending');
  const ordering=group.layers.filter(layer=>layer.instance.renderOrderStatus&&(!layer.materialMapping||layer.materialMapping.reason)).length;
  if(ordering)parts.push(`Material ordering unavailable: ${ordering}`);
  if(group.layers.some(layer=>layer.materialMapping?.pages))parts.push('Material segment visual verification pending');
  document.querySelector('#details').textContent=parts.join(' · ');
}
function describePortrait(appearance){document.querySelector('#details').textContent=`Static portrait · ${appearance?.portrait?.width} × ${appearance?.portrait?.height}${appearance?.spineStatus==='missing-source'?' · Spine bundle absent from backup':appearance?.spineStatus==='available'?' · Animated version also available':''}`;}
async function selectPortrait(appearance){
  if(editor.busy)return false;canvasInput.clear();request?.abort();request=new AbortController();audio?.stop();audio?.stopEffects();if(view==='gallery')audio?.stopAmbients();
  try{const old=[...stage.groups];editor.before();const group=await stage.addPortrait(appearance.portrait.path,[appearance.characterName,appearance.name].filter(Boolean).join(' · '),appearance.id,request.signal);if(view==='gallery')for(const previous of old)stage.remove(previous.id);stage.fit();editor.choose(group);editor.changed();message('Static portrait loaded');closeLibrary();return true;}catch(error){if(error.name!=='AbortError')message(error.message);return false;}
}
async function select(presentation) {
  if(editor.busy)return false;
  canvasInput.clear();
  request?.abort();request=new AbortController();
  audio?.stop();
  audio?.stopEffects();
  if(view==='gallery')audio?.stopAmbients();
  message(`Loading ${presentation.id}…`);
  try {
    const old=[...stage.groups];editor.before();
    const group=await stage.add(presentation,runtime.entries.filter(entry=>entry.bundle===(presentation.resourceBundle||presentation.id)),request.signal);
    if(view==='gallery')for(const previous of old)stage.remove(previous.id);
    stage.fit();
    editor.choose(group);editor.changed();
    describe(group);
    message(presentation.id);
    voicePanel(presentation);
    closeLibrary();
    return true;
  } catch(error) { if(error.name!=='AbortError')message(error.message);return false; }
}
function voicePanel(presentation) {
  createVoicePanel(presentation,libraryData,audio,editor,message);
}
document.querySelector('#library-toggle').onclick=event=>{if(editor.busy||view==='export')return;const open=document.body.classList.toggle('library-open');event.target.setAttribute('aria-expanded',String(open));if(open){document.body.classList.remove('inspector-open');document.querySelector('#editor-toggle').setAttribute('aria-expanded','false');document.querySelector('#search').focus();}};
document.querySelector('#editor-toggle').onclick=event=>{closeLibrary();event.target.setAttribute('aria-expanded',String(document.body.classList.toggle('inspector-open')));};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.body.classList.contains('library-open')){closeLibrary();document.querySelector('#library-toggle').focus();}});
document.querySelector('#background').onchange=event=>{const value=event.target.value;editor.mutate(()=>stage.background=value);};
document.querySelector('#speed').onchange=event=>{const value=Number(event.target.value);editor.mutate(()=>stage.speed=value);};
document.querySelector('#pause').onclick=()=>{if(window.mteSequence.togglePause())return;editor.mutate(()=>{stage.paused=!stage.paused;if(stage.paused)audio?.pause();else audio?.resume().catch(error=>message(error.message));});};
document.querySelector('#fit').onclick=()=>editor.mutate(()=>{stage.evaluate(0);stage.fit();});
for (const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{
  canvasInput.clear();
  closeLibrary();
  view=button.dataset.view;
  document.querySelector('#library-toggle').disabled=view==='export';
  for(const tab of document.querySelectorAll('[data-view]'))tab.classList.toggle('selected',tab===button);
  exporter.setOpen(view==='export');
  document.querySelector('.library').inert=view==='export';document.querySelector('.library').classList.toggle('export-disabled',view==='export');
};
const canvasInput=createCanvasInput(stage,editor,{getView:()=>view,isRecording:()=>window.mteSequence.recorder.active,onInteraction:result=>{if(result.accepted){editor.changed();message(`Interaction: ${result.animation||'reset'}`);}else if(result.reason!=='No interaction region here')message(result.reason);}});
document.querySelector('#notice').textContent='Click to interact in Gallery; drag objects in Studio. Drag empty space to pan, or hold Space to pan anywhere. Scroll or pinch to zoom. With the canvas focused, use arrow keys to pan, +/− to zoom, and Home to fit.';
stage.addEventListener('sound-request',event=>{if(!audio||stage.paused||!stage.groups.some(group=>group.id===event.detail.group&&group.visible))return;audio.playEffect(event.detail.name,event.detail.category,event.detail.lateness||0,true,event.detail.group).catch(error=>message(error.message));});
stage.addEventListener('interaction-change',()=>{if(!editor.busy)editor.changed();});
stage.addEventListener('effect-request',()=>message('This interaction requests an effect that is not rendered yet.'));
stage.addEventListener('voice-request',event=>{
  if(!audio||stage.paused)return;
  if(event.detail.group&&!stage.groups.some(group=>group.id===event.detail.group&&group.visible))return;
  const effect=explicitInteractionEffect(event.detail,audio);if(effect)audio.playEffect(effect.name,effect.category,0,true,event.detail.group).catch(error=>message(error.message));
  const language=document.querySelector('#voice-language')?.value||audio.language,voice=resolveInteractionVoice(event.detail,libraryData,audio,language,{onUnavailable:warning=>queueMicrotask(()=>message(warning))});if(!voice)return;
  audio.play(voice,language,{group:event.detail.group||'',time:event.detail.lateness||0}).catch(error=>message(error.message));
});
stage.addEventListener('voice-stop-request',event=>{if(audio?.currentVoice?.group===event.detail.group)audio.stop();});
try {
  await resourceCache.ready;
  const base=import.meta.env.BASE_URL;
  [catalog,runtime,libraryData]=await Promise.all(['presentations.json','runtime-index.json','library.json'].map(async name=>{const response=await fetch(`${base}assets/${name}`);if(!response.ok)throw new Error(`Catalog unavailable (${response.status})`);return response.json();}));
  const {expandHotSpringPresentations}=await import('./engine/hot-spring.js');catalog.presentations=expandHotSpringPresentations(catalog.presentations,libraryData.hotSpringHouses,libraryData.hotSpringRoles,libraryData.voices,libraryData.characters);
  for(const presentation of catalog.presentations){const appearance=libraryData.appearances.find(row=>row.bundle===presentation.id);if(appearance)presentation.label=[appearance.characterName,appearance.name].filter(Boolean).join(' · ');}
  const portraitResponse=await fetch(`${base}assets/portrait-index.json`);if(portraitResponse.ok)stage.setImageAssets((await portraitResponse.json()).entries);
  const audioResponse=await fetch(`${base}assets/audio-index.json`);
  if(audioResponse.ok){audio=new AudioBus(await audioResponse.json(),libraryData.soundResources,`${base}assets/`,[...libraryData.voices,...libraryData.storyVoices]);audio.addEventListener('subtitle',event=>{const el=document.querySelector('#subtitle');if(el)el.textContent=event.detail?.text||'';});audio.addEventListener('voice-state',()=>{if(!editor.busy)editor.changed({audioOnly:true});});audio.addEventListener('audio-error',event=>message(event.detail));window.mteAudio=audio;createSoundPanel(stage,audio,libraryData,editor,message);}
  window.mteLibrary=createAssetLibrary(catalog,libraryData,{select,selectPortrait,isBusy:()=>editor.busy,base,showUnavailable:entry=>{message(`Display unavailable: ${entry.name}`);voicePanel({appearanceId:entry.id});}});message(`${catalog.presentations.length} bundles · ${runtime.summary?.parsed??runtime.entries.filter(entry=>entry.status==='parsed').length} parsed skeletons`);
  const recovered=await editor.init(catalog.presentations,runtime.entries);
  const initial=catalog.presentations.find(p=>p.id==='Spines/painting/3014027_spine');if(!recovered&&initial)await select(initial);
}catch(error){message(error.message);}
}
