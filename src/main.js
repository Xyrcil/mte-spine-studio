import './style.css';
import './editor.css';
import {Stage} from './engine/stage.js';
import {AudioBus} from './engine/audio.js';
import {createEditor} from './editor.js';

document.querySelector('#app').innerHTML = `
  <header><div class="brand">MTE <span>Spine Studio</span></div><nav><button data-view="gallery" class="selected">Gallery</button><button data-view="studio">Studio</button><button data-view="export">Export</button></nav><button id="editor-toggle" aria-expanded="false">Controls</button><button id="pause">Pause</button></header>
  <main><aside class="library"><label for="search">Asset library</label><input id="search" placeholder="Search asset or category"><select id="category"><option value="">All categories</option><option>painting</option><option>story</option><option>storyCG</option><option>ui</option></select><div id="assets" role="list"></div></aside>
  <section class="workspace"><canvas id="stage" aria-label="Animated scene"></canvas><div id="status" role="status">Loading asset catalog…</div></section>
  <aside class="inspector"><h2>Scene</h2><div id="layers"></div><label>Background <input id="background" type="color" value="#191b20"></label><label>Playback speed <input id="speed" type="range" min="0.1" max="2" step="0.1" value="1"></label><button id="fit">Fit scene</button><div id="details"></div><p id="notice">Interaction rules and audio are being connected to the extracted source data.</p></aside></main>`;
const status = document.querySelector('#status');
const stage = new Stage(document.querySelector('#stage'));
window.mteStudio = stage;
let view = 'gallery', selection, catalog, runtime, request, libraryData, audio;
const message = value => {status.textContent=value;};
const editor=createEditor(stage,message,group=>{if(group?.kind==='spine'){selection=group.presentation;voicePanel(group.presentation);}});
window.mteEditor=editor;
function refreshLayers() {
  editor.refresh();
}
async function select(presentation) {
  if(editor.busy)return;
  request?.abort();request=new AbortController();selection=presentation;
  audio?.stop();
  message(`Loading ${presentation.id}…`);
  try {
    const old=[...stage.groups];editor.before();
    const group=await stage.add(presentation,runtime.entries.filter(entry=>entry.bundle===presentation.id),request.signal);
    if(view==='gallery')for(const previous of old)stage.remove(previous.id);
    editor.choose(group);editor.changed();
    refreshLayers();
    document.querySelector('#details').textContent=`${presentation.instances.length} skeleton instances · ${presentation.hotspots.length} interaction regions`;
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
    const detail=document.createElement('small');detail.textContent=`${presentation.category} · ${presentation.instances.length} layers`;
    button.append(name,detail);button.onclick=()=>select(presentation);container.append(button);
  }
  for(const entry of libraryData.appearances.filter(row=>row.status!=='available'&&(!category||row.kind===category)&&`${row.name} ${row.characterName} ${row.bundle}`.toLowerCase().includes(search))) {
    const button=document.createElement('button');button.className='asset';button.dataset.asset=entry.bundle;
    const title=document.createElement('strong');title.textContent=[entry.characterName,entry.name].filter(Boolean).join(' · ');
    const note=document.createElement('small');note.textContent='Animation not extracted yet';
    button.append(title,note);button.onclick=()=>{message(`Animation not extracted: ${entry.bundle}`);voicePanel({id:entry.bundle});};container.append(button);
  }
}
function voicePanel(presentation) {
  document.querySelector('#voice-panel')?.remove();
  if(!audio)return;
  const appearance=libraryData.appearances.find(row=>row.bundle===presentation.id);
  const targets=new Set([appearance?.id,appearance?.characterId].filter(Boolean));
  const rows=libraryData.voices.filter(row=>targets.has(row.targetId));
  const panel=document.createElement('section');panel.id='voice-panel';
  const heading=document.createElement('h2');heading.textContent=`Voices (${rows.length})`;
  const language=document.createElement('select');language.setAttribute('aria-label','Voice track');
  for(const [value,text] of [['a_sound_voiceeff','Original track'],['a_sound_voiceeff_ch','Chinese track']]){const option=document.createElement('option');option.value=value;option.textContent=text;language.append(option);}
  const list=document.createElement('select');list.setAttribute('aria-label','Voice');
  for(const row of rows){const option=document.createElement('option');option.value=row.id;option.textContent=row.title;list.append(option);}
  const play=document.createElement('button');play.textContent='Play voice';play.disabled=!rows.length;
  play.onclick=async()=>{try{await audio.play(rows.find(row=>row.id===list.value),language.value);}catch(error){message(error.message);}};
  const stop=document.createElement('button');stop.textContent='Stop voice';stop.onclick=()=>audio.stop();
  const volume=document.createElement('input');volume.type='range';volume.min='0';volume.max='1';volume.step='.05';volume.value=audio.volume;volume.setAttribute('aria-label','Voice volume');volume.oninput=()=>audio.setVolume(Number(volume.value));
  const subtitle=document.createElement('p');subtitle.id='subtitle';
  panel.append(heading,language,list,play,stop,volume,subtitle);document.querySelector('.inspector').append(panel);
}
document.querySelector('#search').oninput=library;document.querySelector('#category').onchange=library;
document.querySelector('#editor-toggle').onclick=event=>{event.target.setAttribute('aria-expanded',String(document.body.classList.toggle('inspector-open')));};
document.querySelector('#background').onchange=event=>{const value=event.target.value;editor.mutate(()=>stage.background=value);};
document.querySelector('#speed').onchange=event=>{const value=Number(event.target.value);editor.mutate(()=>stage.speed=value);};
document.querySelector('#pause').onclick=()=>editor.mutate(()=>{stage.paused=!stage.paused;if(stage.paused)audio?.pause();else audio?.resume().catch(error=>message(error.message));});
document.querySelector('#fit').onclick=()=>editor.mutate(()=>{stage.evaluate(0);stage.fit();});
for (const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{
  view=button.dataset.view;
  for(const tab of document.querySelectorAll('[data-view]'))tab.classList.toggle('selected',tab===button);
  if(view==='export')message('Export controls are not implemented yet.');
};
let drag;
const canvas=document.querySelector('#stage');
canvas.onpointerdown=event=>{if(view!=='studio'||editor.busy)return;const group=stage.hitTest(event.clientX,event.clientY);if(!group)return;editor.choose(group);if(group.locked)return;canvas.setPointerCapture(event.pointerId);editor.before();drag={group,x:event.clientX,y:event.clientY,startX:group.x,startY:group.y};};
canvas.onpointermove=event=>{if(!drag)return;const width=Math.max(stage.camera.width,stage.camera.height*canvas.clientWidth/canvas.clientHeight);drag.group.x=drag.startX+(event.clientX-drag.x)*width/canvas.clientWidth;drag.group.y=drag.startY-(event.clientY-drag.y)*width/canvas.clientWidth;};
const endDrag=()=>{if(drag){drag=null;editor.changed();}};canvas.onpointerup=endDrag;canvas.onpointercancel=endDrag;
let wheelTimer;
canvas.onwheel=event=>{event.preventDefault();if(editor.busy)return;if(!wheelTimer)editor.before();const factor=Math.exp(event.deltaY*.001);stage.camera.width=Math.max(.01,Math.min(1e6,stage.camera.width*factor));stage.camera.height=Math.max(.01,Math.min(1e6,stage.camera.height*factor));clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{wheelTimer=null;editor.changed();},150);};
try {
  const base=import.meta.env.BASE_URL;
  [catalog,runtime,libraryData]=await Promise.all(['presentations.json','runtime-index.json','library.json'].map(async name=>{const response=await fetch(`${base}assets/${name}`);if(!response.ok)throw new Error(`Catalog unavailable (${response.status})`);return response.json();}));
  for(const presentation of catalog.presentations){const appearance=libraryData.appearances.find(row=>row.bundle===presentation.id);if(appearance)presentation.label=[appearance.characterName,appearance.name].filter(Boolean).join(' · ');}
  const audioResponse=await fetch(`${base}assets/audio-index.json`);
  if(audioResponse.ok){audio=new AudioBus(await audioResponse.json(),libraryData.soundResources,`${base}assets/`);audio.addEventListener('subtitle',event=>{const el=document.querySelector('#subtitle');if(el)el.textContent=event.detail?.text||'';});audio.addEventListener('audio-error',event=>message(event.detail));window.mteAudio=audio;}
  library();message(`${catalog.presentations.length} bundles · ${runtime.summary.parsed} parsed skeletons`);
  const recovered=await editor.init(catalog.presentations,runtime.entries);
  const initial=catalog.presentations.find(p=>p.id==='Spines/painting/3014027_spine');if(!recovered&&initial)await select(initial);
}catch(error){message(error.message);}
