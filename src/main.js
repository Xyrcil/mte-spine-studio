import './style.css';
import './editor.css';
import {Stage} from './engine/stage.js';
import {AudioBus} from './engine/audio.js';
import {createEditor} from './editor.js';
import {createExportPanel} from './export-panel.js';
import {createSoundPanel} from './sound-panel.js';
import {createVoicePanel} from './voice-panel.js';
import {createCachePanel} from './cache-panel.js';
import {createSequencePanel} from './sequence-panel.js';
import {resolveInteractionVoice,explicitInteractionEffect} from './engine/interaction-audio.js';

document.querySelector('#app').innerHTML = `
  <header><div class="brand">MTE <span>Spine Studio</span></div><nav><button data-view="gallery" class="selected">Gallery</button><button data-view="studio">Studio</button><button data-view="export">Export</button></nav><button id="editor-toggle" aria-expanded="false">Controls</button><button id="pause">Pause</button></header>
  <main><aside class="library"><label for="search">Asset library</label><input id="search" placeholder="Search asset or category"><select id="category"><option value="">All categories</option><option>painting</option><option>story</option><option>storyCG</option><option>ui</option><option value="portrait">Static portraits</option></select><div id="assets" role="list"></div></aside>
  <section class="workspace"><canvas id="stage" aria-label="Animated scene"></canvas><div id="status" role="status">Loading asset catalog…</div></section>
  <aside class="inspector"><h2>Scene</h2><div id="layers"></div><label>Background <input id="background" type="color" value="#191b20"></label><label>Playback speed <input id="speed" type="range" min="0.1" max="2" step="0.1" value="1"></label><button id="fit">Fit scene</button><div id="details"></div><p id="notice">Gallery plays interactions. Studio edits the scene.</p></aside></main>`;
const status = document.querySelector('#status');
const stage = new Stage(document.querySelector('#stage'));
window.mteStudio = stage;
let view = 'gallery', catalog, runtime, request, libraryData, audio;
const message = value => {status.textContent=value;};
const editor=createEditor(stage,message,group=>{if(group?.kind==='spine'){describe(group);voicePanel(group.presentation);}else if(group?.appearanceId){const appearance=libraryData.appearances.find(row=>row.id===group.appearanceId);describePortrait(appearance);voicePanel({appearanceId:group.appearanceId});}else{document.querySelector('#details').textContent=group?'Image layer':'';document.querySelector('#voice-panel')?.remove();}});
window.mteEditor=editor;
const exporter=createExportPanel(stage,editor,()=>({catalog,runtime,library:libraryData,audio}),message);window.mteExporter=exporter;
const resourceCache=createCachePanel(stage,editor,()=>({library:libraryData,audio}),message);window.mteCache=resourceCache;
window.mteSequence=createSequencePanel(stage,editor,message);
stage.addEventListener('sequence-paused',()=>audio?.pause());
stage.addEventListener('sequence-playing',()=>audio?.resume().catch(error=>message(error.message)));
const renderingRetry=document.createElement('button');renderingRetry.id='rendering-retry';renderingRetry.textContent='Retry rendering';renderingRetry.hidden=true;document.querySelector('header').append(renderingRetry);
let recoverySelection;
stage.addEventListener('rendering-pausing',()=>audio?.pause());
stage.addEventListener('rendering-lost',()=>{request?.abort();recoverySelection=editor.selected()?.id;audio?.pause();document.querySelector('.library').inert=true;renderingRetry.hidden=false;message('Rendering interrupted. The scene is retained; you can export its JSON while waiting for recovery.');});
stage.addEventListener('rendering-recovering',()=>{renderingRetry.disabled=true;message('Restoring scene textures and animation state…');});
stage.addEventListener('rendering-recovered',()=>{renderingRetry.disabled=false;renderingRetry.hidden=true;document.querySelector('.library').inert=view==='export';editor.choose(stage.groups.find(group=>group.id===recoverySelection)||stage.groups.at(-1));editor.changed();message('Rendering restored');});
stage.addEventListener('rendering-recovery-error',event=>{renderingRetry.disabled=false;renderingRetry.hidden=false;message(`Rendering recovery failed: ${event.detail}. The scene can still be saved.`);});
renderingRetry.onclick=()=>stage.recoverRendering().catch(error=>message(error.message));
function describe(group){const gaps=(group.controllers||[]).flatMap(root=>root.missingAnimations()),effects=(group.presentation.effects?.length||0)+(group.presentation.visualAnimations?.filter(row=>row.type==='AnimationClip').length||0);document.querySelector('#details').textContent=`${group.presentation.standalone?'Standalone Spine preview · ':''}${group.presentation.instances.length} skeleton instances · ${group.presentation.hotspots.length} interaction regions${gaps.length?` · Missing source animations: ${[...new Set(gaps.map(row=>row.animation))].join(', ')}`:''}${effects?` · Additional effects unavailable: ${effects}`:''}`;}
function describePortrait(appearance){document.querySelector('#details').textContent=`Static portrait · ${appearance?.portrait?.width} × ${appearance?.portrait?.height}${appearance?.spineStatus==='missing-source'?' · Spine bundle absent from backup':appearance?.spineStatus==='available'?' · Animated version also available':''}`;}
async function selectPortrait(appearance){
  if(editor.busy)return;request?.abort();request=new AbortController();audio?.stop();audio?.stopEffects();if(view==='gallery')audio?.stopAmbients();
  try{const old=[...stage.groups];editor.before();const group=await stage.addPortrait(appearance.portrait.path,[appearance.characterName,appearance.name].filter(Boolean).join(' · '),appearance.id,request.signal);if(view==='gallery')for(const previous of old)stage.remove(previous.id);stage.fit();editor.choose(group);editor.changed();message('Static portrait loaded');}catch(error){if(error.name!=='AbortError')message(error.message);}
}
async function select(presentation) {
  if(editor.busy)return;
  request?.abort();request=new AbortController();
  audio?.stop();
  audio?.stopEffects();
  if(view==='gallery')audio?.stopAmbients();
  message(`Loading ${presentation.id}…`);
  try {
    const old=[...stage.groups];editor.before();
    const group=await stage.add(presentation,runtime.entries.filter(entry=>entry.bundle===presentation.id),request.signal);
    if(view==='gallery')for(const previous of old)stage.remove(previous.id);
    stage.fit();
    editor.choose(group);editor.changed();
    describe(group);
    message(presentation.id);
    voicePanel(presentation);
  } catch(error) { if(error.name!=='AbortError')message(error.message); }
}
function library() {
  const search=document.querySelector('#search').value.toLowerCase(),category=document.querySelector('#category').value;
  const container=document.querySelector('#assets');container.replaceChildren();
  for (const presentation of catalog.presentations.filter(p=>p.instances.length&&(!category||p.category===category)&&`${p.id} ${p.label || ''}`.toLowerCase().includes(search))) {
    const button=document.createElement('button');button.className='asset';button.dataset.asset=presentation.id;
    const name=document.createElement('strong');name.textContent=presentation.label || presentation.id.split('/').at(-1);
    const appearance=libraryData.appearances.find(row=>row.bundle===presentation.id);if(appearance?.portrait)button.append(thumbnail(appearance.portrait));
    const detail=document.createElement('small');detail.textContent=`${presentation.category} · ${presentation.instances.length} layers`;
    button.append(name,detail);button.onclick=()=>select(presentation);container.append(button);
  }
  for(const entry of libraryData.appearances.filter(row=>(category==='portrait'?Boolean(row.portrait):row.status!=='available')&&(!category||category==='portrait'||row.kind===category)&&`${row.name} ${row.characterName} ${row.bundle||row.portraitResource}`.toLowerCase().includes(search))) {
    const button=document.createElement('button');button.className='asset';button.dataset.asset=entry.bundle;
    button.dataset.appearance=entry.id;
    const title=document.createElement('strong');title.textContent=[entry.characterName,entry.name].filter(Boolean).join(' · ');
    const note=document.createElement('small');note.textContent=entry.portrait?entry.spineStatus==='missing-source'?'Static preview · Spine absent from backup':'Static portrait':entry.portraitStatus==='unavailable'?'Spine and portrait absent from backup':'Display resource not extracted';
    if(entry.portrait)button.append(thumbnail(entry.portrait));
    button.append(title,note);button.onclick=()=>{if(entry.portrait)selectPortrait(entry);else{message(`Display unavailable: ${entry.name}`);voicePanel({appearanceId:entry.id});}};container.append(button);
  }
}
function thumbnail(sprite){const img=document.createElement('img');img.src=`${import.meta.env.BASE_URL}assets/${sprite.thumbnail}`;img.loading='lazy';img.alt='';img.width=50;img.height=65;return img;}
function voicePanel(presentation) {
  createVoicePanel(presentation,libraryData,audio,editor,message);
}
document.querySelector('#search').oninput=library;document.querySelector('#category').onchange=library;
document.querySelector('#editor-toggle').onclick=event=>{event.target.setAttribute('aria-expanded',String(document.body.classList.toggle('inspector-open')));};
document.querySelector('#background').onchange=event=>{const value=event.target.value;editor.mutate(()=>stage.background=value);};
document.querySelector('#speed').onchange=event=>{const value=Number(event.target.value);editor.mutate(()=>stage.speed=value);};
document.querySelector('#pause').onclick=()=>{if(window.mteSequence.togglePause())return;editor.mutate(()=>{stage.paused=!stage.paused;if(stage.paused)audio?.pause();else audio?.resume().catch(error=>message(error.message));});};
document.querySelector('#fit').onclick=()=>editor.mutate(()=>{stage.evaluate(0);stage.fit();});
for (const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{
  view=button.dataset.view;
  for(const tab of document.querySelectorAll('[data-view]'))tab.classList.toggle('selected',tab===button);
  exporter.setOpen(view==='export');
  document.querySelector('.library').inert=view==='export';document.querySelector('.library').classList.toggle('export-disabled',view==='export');
};
let drag;
const canvas=document.querySelector('#stage');
canvas.onpointerdown=event=>{if(editor.busy&&!(view==='gallery'&&window.mteSequence.recorder.active))return;if(view==='gallery'){const result=stage.interact(event.clientX,event.clientY);if(result.accepted){editor.changed();message(`Interaction: ${result.animation||'reset'}`);}else if(result.reason!=='No interaction region here')message(result.reason);return;}if(view!=='studio')return;const group=stage.hitTest(event.clientX,event.clientY);if(!group)return;editor.choose(group);if(group.locked)return;canvas.setPointerCapture(event.pointerId);editor.before();drag={group,x:event.clientX,y:event.clientY,startX:group.x,startY:group.y};};
canvas.onpointermove=event=>{if(!drag)return;const width=Math.max(stage.camera.width,stage.camera.height*canvas.clientWidth/canvas.clientHeight);drag.group.x=drag.startX+(event.clientX-drag.x)*width/canvas.clientWidth;drag.group.y=drag.startY-(event.clientY-drag.y)*width/canvas.clientWidth;};
const endDrag=()=>{if(drag){drag=null;editor.changed();}};canvas.onpointerup=endDrag;canvas.onpointercancel=endDrag;
let wheelTimer;
stage.addEventListener('sound-request',event=>{if(!audio||stage.paused||!stage.groups.some(group=>group.id===event.detail.group&&group.visible))return;audio.playEffect(event.detail.name,event.detail.category,event.detail.lateness||0,true,event.detail.group).catch(error=>message(error.message));});
stage.addEventListener('interaction-change',()=>{if(!editor.busy)editor.changed();});
stage.addEventListener('effect-request',()=>message('This interaction requests an effect that is not rendered yet.'));
stage.addEventListener('voice-request',event=>{
  if(!audio||stage.paused)return;
  if(event.detail.group&&!stage.groups.some(group=>group.id===event.detail.group&&group.visible))return;
  const effect=explicitInteractionEffect(event.detail,audio);if(effect)audio.playEffect(effect.name,effect.category,0,true,event.detail.group).catch(error=>message(error.message));
  const language=document.querySelector('#voice-language')?.value||audio.language,voice=resolveInteractionVoice(event.detail,libraryData,audio,language);if(!voice)return;
  audio.play(voice,language,{group:event.detail.group||''}).catch(error=>message(error.message));
});
canvas.onwheel=event=>{event.preventDefault();if(editor.busy||view==='export')return;if(!wheelTimer)editor.before();const factor=Math.exp(event.deltaY*.001);stage.camera.width=Math.max(.01,Math.min(1e6,stage.camera.width*factor));stage.camera.height=Math.max(.01,Math.min(1e6,stage.camera.height*factor));clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{wheelTimer=null;editor.changed();},150);};
try {
  await resourceCache.ready;
  const base=import.meta.env.BASE_URL;
  [catalog,runtime,libraryData]=await Promise.all(['presentations.json','runtime-index.json','library.json'].map(async name=>{const response=await fetch(`${base}assets/${name}`);if(!response.ok)throw new Error(`Catalog unavailable (${response.status})`);return response.json();}));
  for(const presentation of catalog.presentations){const appearance=libraryData.appearances.find(row=>row.bundle===presentation.id);if(appearance)presentation.label=[appearance.characterName,appearance.name].filter(Boolean).join(' · ');}
  const portraitResponse=await fetch(`${base}assets/portrait-index.json`);if(portraitResponse.ok)stage.setImageAssets((await portraitResponse.json()).entries);
  const audioResponse=await fetch(`${base}assets/audio-index.json`);
  if(audioResponse.ok){audio=new AudioBus(await audioResponse.json(),libraryData.soundResources,`${base}assets/`,[...libraryData.voices,...libraryData.storyVoices]);audio.addEventListener('subtitle',event=>{const el=document.querySelector('#subtitle');if(el)el.textContent=event.detail?.text||'';});audio.addEventListener('voice-state',()=>{if(!editor.busy)editor.changed({audioOnly:true});});audio.addEventListener('audio-error',event=>message(event.detail));window.mteAudio=audio;createSoundPanel(stage,audio,libraryData,editor,message);}
  library();message(`${catalog.presentations.length} bundles · ${runtime.summary.parsed} parsed skeletons`);
  const recovered=await editor.init(catalog.presentations,runtime.entries);
  const initial=catalog.presentations.find(p=>p.id==='Spines/painting/3014027_spine');if(!recovered&&initial)await select(initial);
}catch(error){message(error.message);}
