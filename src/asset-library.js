import {stationVoiceBinding} from './engine/voice-catalog.js';

export function artworkPreviewView(presentation,appearance,artworkViews){
  const sourceId=(presentation.sourceBundle||presentation.id).match(/^Spines\/painting\/(\d+)_spine(?:_hx)?$/)?.[1];
  const view=artworkViews?.views?.find(row=>row.id===appearance.id)||artworkViews?.views?.find(row=>row.id===sourceId);
  return view?{...view,camera:artworkViews.camera}:undefined;
}

export function buildAssetLibrary(catalog,library){
  const presentations=new Map(catalog.presentations.filter(p=>(p.instances.length||p.unassignedInstances?.length)&&!p.skillDisplay).map(p=>[p.id,p]));
  const voices=new Set(library.voices.map(v=>String(v.targetId))),voiceIds=new Set(library.voices.map(v=>v.id)),names=new Map(library.characters.map(c=>[String(c.id),c.name]));
  for(const row of library.appearances)if(row.kind==='painting'&&String(row.id)===String(row.characterId)&&row.characterName)names.set(String(row.characterId),row.characterName);
  const rows=library.appearances.map(appearance=>{
    const presentation=presentations.get(appearance.bundle),characterId=appearance.characterId?String(appearance.characterId):'',characterName=names.get(characterId)||appearance.characterName||'',station=stationVoiceBinding(library,{appearanceId:appearance.id});
    return {key:`appearance:${appearance.id}`,appearance,presentation,characterId,characterName,name:appearance.name||appearance.bundle||appearance.id,category:appearance.kind,portrait:appearance.portrait,voiceIndexed:voices.has(String(appearance.variantOf||appearance.id))||voices.has(characterId)||Boolean(station&&(voices.has(station.targetId)||station.voiceIds.some(id=>voiceIds.has(id))))||(appearance.hotSpringRoleIds||[]).some(id=>voices.has(id))};
  });
  const linked=new Set(rows.map(r=>r.presentation?.id));
  for(const presentation of presentations.values())if(!linked.has(presentation.id))rows.push({key:`bundle:${presentation.id}`,presentation,characterId:'',characterName:'',name:presentation.label||presentation.id.split('/').at(-1),category:presentation.category,voiceIndexed:false});
  for(const row of rows){row.status=row.presentation?.instances.length?'animated':row.portrait?'static':'missing';row.search=[row.name,row.characterName,row.characterId,row.appearance?.characterName,row.appearance?.id,row.appearance?.portraitResource,row.presentation?.id,row.appearance?.bundle,row.category].filter(Boolean).join(' ').toLocaleLowerCase();}
  return rows;
}

export function queryAssetLibrary(rows,{search='',character='',category='',collection='',favorites=[],recent=[]}={}){
  const terms=search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean),favoriteSet=new Set(favorites),recentOrder=new Map(recent.map((key,index)=>[key,index]));
  const result=rows.filter(row=>(!character||(character==='unassigned'?!row.characterId:row.characterId===character))&&(!category||(category==='portrait'?Boolean(row.portrait):category==='painting'?['painting','skin'].includes(row.category):row.category===category))&&(!collection||(collection==='favorites'?favoriteSet.has(row.key):recentOrder.has(row.key)))&&terms.every(term=>row.search.includes(term)));
  return result.sort((a,b)=>collection==='recent'?recentOrder.get(a.key)-recentOrder.get(b.key):a.characterName.localeCompare(b.characterName)||a.characterId.localeCompare(b.characterId)||(['painting','skin','story','storyCG','portrait','ui'].indexOf(a.category)-['painting','skin','story','storyCG','portrait','ui'].indexOf(b.category))||a.name.localeCompare(b.name)||a.key.localeCompare(b.key));
}

export function createAssetLibrary(catalog,library,{select,selectPortrait,showUnavailable,isBusy,base=''}){
  const rows=buildAssetLibrary(catalog,library),container=document.querySelector('#assets'),search=document.querySelector('#search'),category=document.querySelector('#category');
  container.addEventListener('mousedown',event=>{if(event.button===0&&matchMedia('(max-width:540px)').matches&&document.activeElement===search&&event.target.closest('.asset,.asset-favorite'))event.preventDefault();});
  const controls=document.createElement('section');controls.className='library-controls';controls.innerHTML='<label>Character<select id="library-character"><option value="">All characters</option><option value="unassigned">Unassigned artwork</option></select></label><label>Collection<select id="library-collection"><option value="">All artwork</option><option value="favorites">Favorites</option><option value="recent">Recently opened</option></select></label><p id="library-count" role="status"></p>';
  category.after(controls);const character=controls.querySelector('#library-character'),collection=controls.querySelector('#library-collection'),count=controls.querySelector('#library-count');
  const characters=new Map();for(const row of rows)if(row.characterId){const group=characters.get(row.characterId)||{name:row.characterName,count:0};group.count++;characters.set(row.characterId,group);}
  for(const [id,value] of [...characters].sort((a,b)=>a[1].name.localeCompare(b[1].name)))character.append(new Option(`${value.name||id} (${value.count})`,id));
  const valid=new Set(rows.map(row=>row.key)),read=key=>{try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?[...new Set(value.filter(item=>typeof item==='string'&&valid.has(item)))]:[];}catch{return [];}};
  let favorites=read('mte-library-favorites'),recent=read('mte-library-recent').slice(0,20),page=0,active='',preferenceError=false;const size=24;
  const persist=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{preferenceError=true;}};
  const pager=document.createElement('div');pager.className='library-pagination';const previous=document.createElement('button'),next=document.createElement('button'),pageLabel=document.createElement('span');previous.textContent='Previous';next.textContent='Next';pager.append(previous,pageLabel,next);container.after(pager);
  function render(){
    const oldCards=[...container.querySelectorAll('.asset-card')],focused=oldCards.find(card=>card.contains(document.activeElement)),focusKey=focused?.querySelector('.asset').dataset.libraryKey,focusIndex=oldCards.indexOf(focused),favoriteFocused=document.activeElement?.classList.contains('asset-favorite');
    const result=queryAssetLibrary(rows,{search:search.value,category:category.value,character:character.value,collection:collection.value,favorites,recent});page=Math.min(page,Math.max(0,Math.ceil(result.length/size)-1));
    container.replaceChildren();count.textContent=`${result.length} artwork entries${preferenceError?' · Preferences could not be saved':''}`;pageLabel.textContent=`${result.length?page+1:0} / ${Math.ceil(result.length/size)}`;previous.disabled=page===0;next.disabled=(page+1)*size>=result.length;
    if(!result.length){const empty=document.createElement('p');empty.className='library-empty';empty.textContent='No artwork matches these filters.';container.append(empty);if(focused)search.focus({preventScroll:true});return;}
    let group;
    for(const row of result.slice(page*size,(page+1)*size)){
      if(group!==row.characterId){group=row.characterId;const heading=document.createElement('h3');heading.textContent=row.characterName||'Unassigned artwork';container.append(heading);}
      const card=document.createElement('div');card.className='asset-card';card.setAttribute('role','listitem');
      const button=document.createElement('button');button.className='asset';button.dataset.libraryKey=row.key;button.setAttribute('aria-pressed',String(row.key===active));
      if(row.presentation)button.dataset.asset=row.presentation.id;else if(row.appearance?.bundle)button.dataset.asset=row.appearance.bundle;
      if(row.appearance)button.dataset.appearance=row.appearance.id;
      if(row.portrait){const img=document.createElement('img');img.src=`${base}assets/${row.portrait.thumbnail}`;img.loading='lazy';img.alt='';img.width=50;img.height=65;button.append(img);}
      const title=document.createElement('strong');title.textContent=row.name;const note=document.createElement('small');
      if(row.presentation?.stationDrawingWarnings?.length)note.className='asset-warning';
      const kind=row.appearance?.hotSpringRoleId?'Hot spring':row.category==='skin'?'Skin':row.category==='painting'?'Artwork':row.category==='story'?'Story':row.category==='storyCG'?'Story CG':row.category==='portrait'?'Portrait':row.category==='ui'?'Scene / UI':row.category;
      const status=category.value==='portrait'&&row.portrait?`Static portrait${row.status==='animated'?' · Animated version available':row.appearance?.spineStatus==='missing-source'?' · Spine missing':''}`:row.status==='animated'?`${row.presentation.instances.length} Spine layers`:row.status==='static'?(row.appearance?.spineStatus==='missing-source'?'Static preview · Spine missing':'Static portrait'):'Display missing';
      note.textContent=`${kind} · ${status}${row.presentation?.stationDrawingWarnings?.length?' · Station unavailable':''}${row.presentation?.unassignedInstances?.length?' · Unassigned source components':''}${row.characterId&&!row.voiceIndexed?' · No indexed character voice':''}`;button.append(title,note);
      button.onclick=async()=>{if(isBusy())return;const selected=category.value==='portrait'&&row.portrait?await selectPortrait(row.appearance):row.status==='animated'?await select(row.presentation):row.portrait?await selectPortrait(row.appearance):showUnavailable(row.appearance||{id:row.presentation.id,name:row.name});if(selected===false||row.status==='missing')return;active=row.key;recent=[row.key,...recent.filter(key=>key!==row.key)].slice(0,20);persist('mte-library-recent',recent);render();};
      const favorite=document.createElement('button');favorite.className='asset-favorite';favorite.textContent=favorites.includes(row.key)?'★':'☆';favorite.setAttribute('aria-label',`Favorite ${row.name}`);favorite.setAttribute('aria-pressed',String(favorites.includes(row.key)));favorite.onclick=()=>{favorites=favorites.includes(row.key)?favorites.filter(key=>key!==row.key):[...favorites,row.key];persist('mte-library-favorites',favorites);render();};
      card.append(button,favorite);container.append(card);
    }
    if(focused){const cards=[...container.querySelectorAll('.asset-card')],target=cards.find(card=>card.querySelector('.asset').dataset.libraryKey===focusKey)||cards[Math.min(focusIndex,cards.length-1)];target?.querySelector(favoriteFocused?'.asset-favorite':'.asset').focus({preventScroll:true});}
  }
  const reset=()=>{page=0;render();},navigate=delta=>{page+=delta;render();container.querySelector('.asset')?.focus({preventScroll:true});container.scrollIntoView({block:'start'});};search.oninput=reset;category.onchange=reset;character.onchange=reset;collection.onchange=reset;previous.onclick=()=>navigate(-1);next.onclick=()=>navigate(1);render();
  return {rows,render,setActive(group){active=rows.find(row=>group?.appearanceId?row.appearance?.id===group.appearanceId:group?.presentation?.id&&row.presentation?.id===group.presentation.id)?.key||'';for(const button of container.querySelectorAll('.asset'))button.setAttribute('aria-pressed',String(button.dataset.libraryKey===active));},reveal(id){const row=rows.find(row=>row.key===id||row.presentation?.id===id||row.appearance?.bundle===id);if(!row)throw new Error(`Artwork not indexed: ${id}`);category.value='';character.value='';collection.value='';search.value=row.appearance?.id||row.presentation.id;page=0;render();return row.key;}};
}
