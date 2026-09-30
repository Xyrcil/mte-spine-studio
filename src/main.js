import './style.css';
import {Stage} from './engine/stage.js';

document.querySelector('#app').innerHTML = `
  <header><div class="brand">MTE <span>Spine Studio</span></div><nav><button data-view="gallery" class="selected">Gallery</button><button data-view="studio">Studio</button><button data-view="export">Export</button></nav><button id="pause">Pause</button></header>
  <main><aside class="library"><label for="search">Asset library</label><input id="search" placeholder="Search asset or category"><select id="category"><option value="">All categories</option><option>painting</option><option>story</option><option>storyCG</option><option>ui</option></select><div id="assets" role="list"></div></aside>
  <section class="workspace"><canvas id="stage" aria-label="Animated scene"></canvas><div id="status" role="status">Loading asset catalog…</div></section>
  <aside class="inspector"><h2>Scene</h2><div id="layers"></div><label>Background <input id="background" type="color" value="#191b20"></label><label>Playback speed <input id="speed" type="range" min="0.1" max="2" step="0.1" value="1"></label><button id="fit">Fit scene</button><div id="details"></div><p id="notice">Interaction rules and audio are being connected to the extracted source data.</p></aside></main>`;
const status = document.querySelector('#status');
const stage = new Stage(document.querySelector('#stage'));
window.mteStudio = stage;
let view = 'gallery', selection, catalog, runtime, request;
const message = value => {status.textContent=value;};
function refreshLayers() {
  const container=document.querySelector('#layers'); container.replaceChildren();
  for (const group of stage.groups) {
    const row=document.createElement('div'); row.className='layer';
    const title=document.createElement('span'); title.textContent=group.presentation.id.split('/').at(-1);
    const remove=document.createElement('button'); remove.textContent='×'; remove.title='Remove layer'; remove.onclick=()=>{stage.remove(group.id);refreshLayers();};
    const scale=document.createElement('input');scale.type='range';scale.min='.1';scale.max='3';scale.step='.05';scale.value=group.scale;scale.title='Scale';scale.oninput=()=>{group.scale=Number(scale.value);};
    row.append(title,remove,scale);container.append(row);
  }
}
async function select(presentation) {
  request?.abort();request=new AbortController();selection=presentation;
  message(`Loading ${presentation.id}…`);
  try {
    if (view==='gallery') for (const group of [...stage.groups]) stage.remove(group.id);
    await stage.add(presentation,runtime.entries.filter(entry=>entry.bundle===presentation.id),request.signal);
    refreshLayers();
    document.querySelector('#details').textContent=`${presentation.instances.length} skeleton instances · ${presentation.hotspots.length} interaction regions`;
    message(presentation.id);
  } catch(error) { if(error.name!=='AbortError')message(error.message); }
}
function library() {
  const search=document.querySelector('#search').value.toLowerCase(),category=document.querySelector('#category').value;
  const container=document.querySelector('#assets');container.replaceChildren();
  for (const presentation of catalog.presentations.filter(p=>p.instances.length&&(!category||p.category===category)&&p.id.toLowerCase().includes(search))) {
    const button=document.createElement('button');button.className='asset';button.dataset.asset=presentation.id;
    const name=document.createElement('strong');name.textContent=presentation.id.split('/').at(-1);
    const detail=document.createElement('small');detail.textContent=`${presentation.category} · ${presentation.instances.length} layers`;
    button.append(name,detail);button.onclick=()=>select(presentation);container.append(button);
  }
}
document.querySelector('#search').oninput=library;document.querySelector('#category').onchange=library;
document.querySelector('#background').oninput=event=>{stage.background=event.target.value;};
document.querySelector('#speed').oninput=event=>{stage.speed=Number(event.target.value);};
document.querySelector('#pause').onclick=event=>{stage.paused=!stage.paused;event.target.textContent=stage.paused?'Play':'Pause';};
document.querySelector('#fit').onclick=()=>stage.fit();
for (const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{
  view=button.dataset.view;
  for(const tab of document.querySelectorAll('[data-view]'))tab.classList.toggle('selected',tab===button);
  if(view==='export')message('Export controls are not implemented yet.');
};
let drag;
const canvas=document.querySelector('#stage');
canvas.onpointerdown=event=>{if(view!=='studio'||!stage.groups.length)return;canvas.setPointerCapture(event.pointerId);const group=stage.groups.at(-1);drag={group,x:event.clientX,y:event.clientY,startX:group.x,startY:group.y};};
canvas.onpointermove=event=>{if(!drag)return;const width=Math.max(stage.camera.width,stage.camera.height*canvas.clientWidth/canvas.clientHeight);drag.group.x=drag.startX+(event.clientX-drag.x)*width/canvas.clientWidth;drag.group.y=drag.startY-(event.clientY-drag.y)*width/canvas.clientWidth;};
canvas.onpointerup=()=>{drag=null;};canvas.onpointercancel=()=>{drag=null;};
canvas.onwheel=event=>{event.preventDefault();const factor=Math.exp(event.deltaY*.001);stage.camera.width*=factor;stage.camera.height*=factor;};
try {
  const base=import.meta.env.BASE_URL;
  [catalog,runtime]=await Promise.all(['presentations.json','runtime-index.json'].map(async name=>{const response=await fetch(`${base}assets/${name}`);if(!response.ok)throw new Error(`Catalog unavailable (${response.status})`);return response.json();}));
  library();message(`${catalog.presentations.length} bundles · ${runtime.summary.parsed} parsed skeletons`);
  const initial=catalog.presentations.find(p=>p.id==='Spines/painting/3014027_spine');if(initial)await select(initial);
}catch(error){message(error.message);}
