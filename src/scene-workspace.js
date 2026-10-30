import {loadLocalScene,listLocalScenes} from './engine/scene.js';
import {saveWorkspaceScene,loadWorkspaceScene,listWorkspaceScenes,deleteWorkspaceScene,saveWorkspaceDraft,loadWorkspaceDraft,listWorkspaceDrafts,deleteWorkspaceDraft,savePreview,loadPreview} from './engine/workspace-store.js';
import {moveSceneLayer,duplicateSceneObject} from './engine/background-layers.js';
import {createSceneFile} from './engine/scene-file.js';
import {t,getLocale} from './i18n.js';

const uid=()=>crypto.randomUUID();
const blank=()=>({schema:1,name:t('Untitled scene'),background:'#191b20',camera:{x:0,y:0,width:20,height:20},speed:1,paused:false,objects:[]});
// Animation clocks are playback state, not edits. Preserve the selected animation and layer settings.
function signature(scene){
  return JSON.stringify({name:scene.name,background:scene.background,camera:scene.camera,speed:scene.speed,paused:scene.paused,sequence:scene.sequence,audio:scene.audio?{voiceVolume:scene.audio.voiceVolume,effectVolume:scene.audio.effectVolume,ambientVolume:scene.audio.ambientVolume,muted:scene.audio.muted,ambientEnabled:scene.audio.ambientEnabled,language:scene.audio.language,ambientTracks:scene.audio.ambientTracks?.map(({id,name,category,enabled,loop,gain})=>({id,name,category,enabled,loop,gain}))}:undefined,objects:scene.objects.map(object=>{
    const {interactions,effects,nativeAnimations,layers,...authored}=object;
    return {...authored,...(layers?{layers:layers.map(layer=>({id:layer.id,active:layer.active,tracks:layer.tracks.map(({index,name,loop,timeScale})=>({index,name,loop,timeScale}))}))}: {})};
  })});
}
function thumbnail(canvas){try{const image=document.createElement('canvas');image.width=320;image.height=180;image.getContext('2d').drawImage(canvas,0,0,320,180);return image.toDataURL('image/jpeg',.72);}catch{return '';}}
function cameraCopy(camera){const {sourcePreview,...result}=structuredClone(camera);return result;}

export function storyRowLengths(total,axis,amount){
  if(!Number.isInteger(total)||total<0)throw new Error('Invalid artwork count');
  const limit=Math.max(1,Math.floor(Number(amount)||1));
  if(axis==='columns')return Array.from({length:Math.ceil(total/limit)},(_,index)=>Math.min(limit,total-index*limit));
  if(axis!=='rows')throw new Error('Invalid arrangement');
  const rows=Math.min(total,limit);if(!rows)return [];
  return Array.from({length:rows},(_,index)=>Math.floor(total/rows)+(index<total%rows?1:0));
}

export function storyPositions(sizes,{axis='columns',amount=4,gap=-2.5,origin={x:0,y:0}}={}){
  const lengths=storyRowLengths(sizes.length,axis,amount),rows=[];let offset=0;
  for(const length of lengths){const items=sizes.slice(offset,offset+length);offset+=length;
    const widths=items.map(item=>Math.max(.01,item.width)),height=Math.max(...items.map(item=>Math.max(.01,item.height)));
    const gaps=widths.slice(1).map((width,index)=>Math.max(gap,-.45*Math.min(width,widths[index])));
    rows.push({widths,height,gaps,width:widths.reduce((sum,value)=>sum+value,0)+gaps.reduce((sum,value)=>sum+value,0)});
  }
  const verticalGaps=rows.slice(1).map((row,index)=>Math.max(gap,-.45*Math.min(row.height,rows[index].height)));
  let top=origin.y+(rows.reduce((sum,row)=>sum+row.height,0)+verticalGaps.reduce((sum,value)=>sum+value,0))/2;const result=[];
  rows.forEach((row,rowIndex)=>{let left=origin.x-row.width/2;const y=top-row.height/2;
    row.widths.forEach((width,index)=>{result.push({x:left+width/2,y});left+=width+(row.gaps[index]||0);});
    top-=row.height+(verticalGaps[rowIndex]||0);
  });
  return result;
}

export function createSceneWorkspace({stage,editor,viewer,setView,getView,message,getLibrary,getSelection=()=>null,selectRow,startSceneSpeech=()=>{}}){
  let mode='role',id='',baseId=null,legacyKey=null,dirty=false,baseline='',outputCamera=null,previewBefore=null,previewSelectedId=null,transitioning=false,loading=false,hiddenReturnToEdit=false,revision=0,duoPending=0,replacementId=null,hubScenes=[],hubDrafts=[],insertTemplate=false;
  const header=document.querySelector('.viewer-header');
  const nav=document.createElement('nav');nav.className='workspace-nav';nav.setAttribute('aria-label','Workspace');nav.innerHTML='<button type="button" data-workspace="role">Artwork</button><button type="button" data-workspace="scenes">Scenes</button>';
  header.querySelector('.brand').after(nav);
  const menuArtwork=document.querySelector('button[data-view="gallery"]'),menuScenes=document.querySelector('button[data-view="studio"]');menuArtwork.innerHTML='Artwork <small>Single artwork preview</small>';menuScenes.innerHTML='Scenes <small>Browse and arrange scenes</small>';
  const toolbar=document.createElement('div');toolbar.className='scene-toolbar';toolbar.hidden=true;toolbar.innerHTML='<div class="scene-title"><strong data-scene-title data-i18n-skip></strong><small data-scene-state></small></div><div class="scene-actions"><button type="button" data-action="library">Add artwork</button><button type="button" data-action="replace">Replace artwork</button><button type="button" data-action="templates">Templates</button><button type="button" data-action="controls">Controls</button><button type="button" data-action="save">Save scene</button><button type="button" data-action="preview">Preview scene</button><button type="button" data-action="output">Use current view for output</button></div>';
  document.querySelector('.workspace').append(toolbar);
  const hub=document.createElement('section');hub.className='scene-hub';hub.hidden=true;hub.innerHTML='<div class="scene-hub-inner"><div class="scene-hub-head"><div><p class="eyebrow">Your collection</p><h1>Scenes</h1><p>Arrange artwork together and save scenes in this browser.</p></div><div class="scene-hub-actions"><button type="button" data-action="import">Import scene</button><button type="button" data-action="new">New scene</button></div></div><label class="scene-search">Search scenes<input data-scene-search type="search" placeholder="Search by name"></label><section><div class="section-title"><h2>Templates</h2></div><div class="template-grid"><button data-template="blank"><strong>Empty canvas</strong><span>Start with an empty scene.</span></button><button data-template="duo"><strong>Side by side</strong><span>Add two artworks and arrange them automatically.</span></button><button data-template="skins"><strong>Compare skins</strong><span>Arrange one character’s available appearances.</span></button><button data-template="story"><strong>Story portraits</strong><span>Arrange story artwork from the library.</span></button></div></section><section><div class="section-title"><h2>Drafts</h2><span>Saved automatically on this device</span></div><div class="scene-grid" data-list="drafts"></div></section><section><div class="section-title"><h2>Saved scenes</h2><span>Available on this device</span></div><div class="scene-grid" data-list="scenes"></div></section></div>';
  document.querySelector('.workspace').append(hub);
  const modal=document.createElement('dialog');modal.className='workspace-dialog';modal.innerHTML='<form method="dialog"><h2>Unsaved changes</h2><p>Save this scene before leaving, or keep its draft to continue later.</p><div class="dialog-actions"><button value="cancel">Cancel</button><button value="draft">Keep draft and leave</button><button value="discard">Discard changes</button><button value="save" class="primary">Save and leave</button></div></form>';document.querySelector('#app').append(modal);
  const context=document.createElement('div');context.className='scene-context';context.hidden=true;context.setAttribute('role','menu');document.querySelector('#app').append(context);
  const templateDialog=document.createElement('dialog');templateDialog.className='workspace-dialog';templateDialog.innerHTML='<form method="dialog"><h2>Story portraits</h2><p>Choose how many story artworks to arrange. Loading many animated artworks can take time.</p><label>Artwork selection <select name="scope"><option value="characters">One story portrait per character</option><option value="all">All available story portraits</option></select></label><label class="check-label"><input name="include-hx" type="checkbox">Include HX variants</label><label>Number of artworks <input name="count" type="number" min="1" max="512" value="12"></label><label>Arrange by <select name="layout-axis"><option value="columns">Columns</option><option value="rows">Rows</option></select></label><label data-layout-field="columns">Columns <input name="columns" type="number" min="1" max="512" value="4"></label><label data-layout-field="rows" hidden>Rows <input name="rows" type="number" min="1" max="512" value="2" disabled></label><label>Gap (% of portrait height) <input name="gap" type="number" min="-50" max="100" step="1" value="-25"></label><p>Negative values overlap neighboring portraits.</p><div class="dialog-actions"><button value="cancel" formnovalidate>Cancel</button><button value="create" class="primary">Create scene</button></div></form>';document.querySelector('#app').append(templateDialog);
  const insertDialog=document.createElement('dialog');insertDialog.className='workspace-dialog';insertDialog.innerHTML='<form method="dialog"><h2>Add a template</h2><p>Add an arrangement to the current scene.</p><div class="dialog-actions"><button value="cancel">Cancel</button><button value="skins">Compare skins</button><button value="story">Story portraits</button></div></form>';document.querySelector('#app').append(insertDialog);
  const skinDialog=document.createElement('dialog');skinDialog.className='workspace-dialog';skinDialog.innerHTML='<form method="dialog"><h2>Compare skins</h2><label>Character<select name="character"></select></label><label>Columns<input name="columns" type="number" min="1" max="20" value="4"></label><label>Spacing<input name="spacing" type="number" min="1" max="100" step="0.5" value="12"></label><div class="dialog-actions"><button value="cancel">Cancel</button><button value="create" class="primary">Create scene</button></div></form>';document.querySelector('#app').append(skinDialog);
  function arrange(group,target,spacing){
    const bounds=stage.objectBounds(group);if(!bounds)return;const extent=Math.max(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY);if(!(extent>0))return;
    group.scale=Math.max(.01,Math.min(1000,group.scale*spacing*.82/extent));for(const layer of group.layers)stage.transformLayer(group,layer);const resized=stage.objectBounds(group);
    if(resized){group.x+=target.x-(resized.minX+resized.maxX)/2;group.y+=target.y-(resized.minY+resized.maxY)/2;for(const layer of group.layers)stage.transformLayer(group,layer);}
  }
  function state(){return {mode,id,baseId,dirty,loading};}
  function libraryPurpose(){return mode==='scene-edit'?(replacementId?'replace':'scene'):'role';}
  function cancelReplacement(){replacementId=null;update();}
  function requestReplacement(group=editor.selected()){
    if(mode!=='scene-edit'||!group||group.locked||!(group.kind==='spine'||group.asset)){message('Select an unlocked artwork to replace.');return;}
    replacementId=group.id;update();getLibrary()?.focusCharacter?.(group);viewer.openLibrary();
  }
  function finishReplacement(){replacementId=null;update();viewer.closeLibrary();}
  function output(scene){if(mode==='scene-edit'||mode==='scene-preview'||mode==='scene-export')scene.camera=cameraCopy(outputCamera||scene.camera);return scene;}
  function update(){
    document.body.dataset.workspace=mode;hub.hidden=mode!=='hub';toolbar.hidden=!['scene-edit','scene-preview','scene-export'].includes(mode);
    nav.querySelector('[data-workspace="role"]').classList.toggle('selected',mode==='role');nav.querySelector('[data-workspace="scenes"]').classList.toggle('selected',mode!=='role');
    const scene=editor.snapshot();toolbar.querySelector('[data-scene-title]').textContent=scene.name;
    toolbar.querySelector('[data-scene-state]').textContent=mode==='scene-preview'?'Scene preview':mode==='scene-export'?'Scene export':dirty?'Unsaved changes':baseId?'Saved scene':'New scene';
    toolbar.querySelector('[data-action="preview"]').textContent=mode==='scene-preview'||mode==='scene-export'?'Return to editing':'Preview scene';
    for(const key of ['library','replace','templates','controls','save','output'])toolbar.querySelector(`[data-action="${key}"]`).hidden=mode!=='scene-edit';
    toolbar.querySelector('[data-action="preview"]').hidden=false;
    document.querySelector('#viewer-mode').textContent={role:'Artwork preview',hub:'Scenes','scene-edit':'Scene editor','scene-preview':'Scene preview','scene-export':'Scene export'}[mode];
    if(mode==='role')document.querySelector('#inspector-title').textContent='Artwork controls';
    const libraryToggle=document.querySelector('#library-toggle');libraryToggle.firstChild.nodeValue=mode==='scene-edit'?'Add artwork':'Library';libraryToggle.querySelector('small').textContent=mode==='scene-edit'?'Add to this scene':'Characters & skins';
    document.querySelector('#notice').textContent=mode==='scene-edit'?'Drag artwork to move it. Drag empty space or hold Control to pan. Shift-click to select more; right-click for layer actions. Scroll or pinch to zoom.':'Click artwork to interact. Drag empty space to pan; scroll or pinch to zoom.';
    const purpose=libraryPurpose(),label=document.querySelector('#library-title');if(label)label.textContent=purpose==='replace'?'Replace artwork':purpose==='scene'?'Add artwork to scene':'Asset library';
    const note=document.querySelector('#library-purpose');if(note)note.textContent=purpose==='replace'?'Choose artwork to replace the selected object. Its position and background will be kept.':purpose==='scene'?'Choose artwork to add it to this scene.':'Choose artwork to replace the current preview.';
    getLibrary()?.setPurpose?.(purpose);
  }
  function changed(detail){
    if(transitioning||mode!=='scene-edit'||detail?.cameraOnly||detail?.audioOnly||detail?.runtimeOnly)return;
    revision++;dirty=signature(output(editor.snapshot()))!==baseline;update();
  }
  async function persist(scene,scope){
    if(!scope||transitioning)return;
    if(scope.mode==='role')await savePreview(scene);
    else if(scope.mode==='scene-edit'&&scope.id&&scope.dirty)await saveWorkspaceDraft(scope.id,{...scene,camera:scope.camera},{baseId:scope.baseId,legacyKey:scope.legacyKey});
  }
  editor.setPersistence({scope:()=>({mode,id,baseId,legacyKey,dirty,camera:cameraCopy(outputCamera||stage.camera)}),onChange:changed,save:persist,saveScene:save,beforeReplace:guard,canReplace:group=>mode==='scene-edit'&&!group.locked&&(group.kind==='spine'||group.asset),replace:requestReplacement,afterImport:scene=>{id=uid();baseId=null;legacyKey=null;outputCamera=cameraCopy(scene.camera);baseline='';dirty=true;},output,historySnapshot:scene=>mode==='scene-edit'?{...scene,__workspaceOutputCamera:cameraCopy(outputCamera||scene.camera)}:scene,historyRestored:scene=>{if(scene.__workspaceOutputCamera)outputCamera=cameraCopy(scene.__workspaceOutputCamera);}});
  async function flush(){await editor.flushAutosave();}
  async function save(){
    if(mode!=='scene-edit')return;
    await flush();const scene=output(editor.snapshot()),savedRevision=revision,saveId=baseId||uid();
    await saveWorkspaceScene(saveId,scene,{thumbnail:thumbnail(stage.canvas),legacyKey});
    baseId=saveId;baseline=signature(scene);dirty=revision===savedRevision?false:signature(output(editor.snapshot()))!==baseline;
    await flush();if(dirty)await saveWorkspaceDraft(id,output(editor.snapshot()),{baseId,legacyKey});else await deleteWorkspaceDraft(id);update();message('Scene saved on this device',{transient:true});
  }
  async function keepDraft(){await flush();if(mode==='scene-edit'&&id&&dirty)await saveWorkspaceDraft(id,output(editor.snapshot()),{baseId,legacyKey});}
  function ask(dialog){return new Promise(resolve=>{const onClose=()=>{dialog.removeEventListener('close',onClose);resolve(dialog.returnValue||'cancel');};dialog.addEventListener('close',onClose);dialog.returnValue='';dialog.showModal();});}
  async function guard(){
    if(mode==='scene-preview')await stopPreview();
    if(!['scene-edit','scene-export'].includes(mode)||!dirty)return true;
    if(mode==='scene-export'){mode='scene-edit';setView('studio');}
    const answer=await ask(modal);if(answer==='cancel')return false;
    try{if(answer==='save')await save();else if(answer==='discard'){dirty=false;await editor.cancelAutosave();if(id)await deleteWorkspaceDraft(id);}else await keepDraft();return true;}catch(error){dirty=true;message(`Scene could not be saved: ${error.message}`);return false;}
  }
  async function restore(scene){transitioning=true;try{await editor.restore(scene);editor.resetHistory();}finally{transitioning=false;}}
  async function openScene(scene,{newId=uid(),savedId=null,legacy=null,isDraft=false,needsSave=false}={}){
    await flush();await restore(scene);id=newId;baseId=savedId;legacyKey=legacy;outputCamera=cameraCopy(scene.camera);mode='scene-edit';baseline=signature(output(editor.snapshot()));dirty=Boolean(isDraft||needsSave);previewBefore=null;duoPending=0;replacementId=null;setView('studio');viewer.closePanels({focus:false});update();
  }
  async function scenes(){if(loading)return;if(!await guard())return;try{await flush();if(mode==='role')await savePreview(editor.snapshot());mode='hub';replacementId=null;viewer.closePanels({focus:false});setView('gallery');await refreshHub();update();}catch(error){message(error.message);}}
  async function role(){if(loading)return;if(!await guard())return;try{await flush();const scene=await loadPreview();if(scene)await restore(scene);mode='role';replacementId=null;id='';baseId=null;dirty=false;previewBefore=null;setView('gallery');viewer.showView('gallery');update();if(!scene&&!stage.groups.length)viewer.openLibrary();}catch(error){message(error.message);}}
  async function refreshHub(){
    const [scenes,drafts,legacy,previous]=await Promise.all([listWorkspaceScenes(),listWorkspaceDrafts(),listLocalScenes(),loadLocalScene()]);
    const used=new Set(scenes.map(row=>row.legacyKey).filter(Boolean));
    hubScenes=[...scenes.map(row=>({...row,type:'saved'})),...legacy.filter(key=>!used.has(key)).map(key=>({id:key,name:key,type:'legacy'}))];
    hubDrafts=[...drafts.map(row=>({...row,type:'draft'})),...(previous?[{id:'autosave',name:previous.name,type:'legacy-draft'}]:[])];renderHub();
  }
  function renderHub(){const query=hub.querySelector('[data-scene-search]').value.trim().toLocaleLowerCase(),match=row=>!query||row.name.toLocaleLowerCase().includes(query);renderCards(hub.querySelector('[data-list="scenes"]'),hubScenes.filter(match),query?'No scenes match this search.':'No saved scenes yet.');renderCards(hub.querySelector('[data-list="drafts"]'),hubDrafts.filter(match),query?'No scenes match this search.':'No drafts yet.');}
  hub.querySelector('[data-scene-search]').oninput=renderHub;
  function renderCards(container,rows,empty){
    container.replaceChildren();if(!rows.length){const p=document.createElement('p');p.className='scene-empty';p.textContent=empty;container.append(p);return;}
    for(const row of rows){const card=document.createElement('article');card.className='scene-card';const open=document.createElement('button');open.className='scene-card-open';
      if(row.thumbnail){const image=document.createElement('img');image.src=row.thumbnail;image.alt='';open.append(image);}else{const image=document.createElement('span');image.className='scene-card-placeholder';image.setAttribute('aria-hidden','true');image.textContent='✦';open.append(image);}
      const title=document.createElement('strong');title.textContent=row.name;title.dataset.i18nSkip='';const info=document.createElement('small');info.textContent=row.type==='legacy'?'Previous saved scene':row.type==='legacy-draft'?'Previous automatic save':row.type==='draft'?'Draft':'Saved scene';open.setAttribute('aria-label',`Preview ${row.name}`);open.append(title,info);if(Number.isInteger(row.artworkCount)){const meta=document.createElement('small');meta.textContent=`${row.artworkCount} artworks · ${row.backgroundCount} backgrounds`;open.append(meta);}if(row.updated){const time=document.createElement('small');time.textContent=new Intl.DateTimeFormat(getLocale(),{dateStyle:'medium',timeStyle:'short'}).format(row.updated);time.dataset.i18nSkip='';open.append(time);}open.onclick=()=>openCard(row,{preview:true});card.append(open);
      const actions=document.createElement('div');actions.className='scene-card-actions';const action=(label,fn)=>{const button=document.createElement('button');button.textContent=label;button.onclick=fn;actions.append(button);};
      action('Edit',()=>openCard(row));
      if(row.type==='saved'||row.type==='draft')action('Rename',()=>renameCard(row));
      action('Duplicate',()=>duplicateCard(row));action('Export',()=>exportCard(row));
      if(row.type==='saved'||row.type==='draft')action('Delete',async()=>{const ok=await confirmDelete(row);if(!ok)return;try{if(row.type==='saved')await deleteWorkspaceScene(row.id);else await deleteWorkspaceDraft(row.id);await refreshHub();}catch(error){message(error.message);}});
      card.append(actions);container.append(card);}
  }
  const readCard=row=>row.type==='saved'?loadWorkspaceScene(row.id):row.type==='draft'?loadWorkspaceDraft(row.id):loadLocalScene(row.id);
  async function renameCard(row){
    const dialog=document.createElement('dialog');dialog.className='workspace-dialog';dialog.innerHTML='<form method="dialog"><h2>Rename scene</h2><label>Scene name<input name="name" maxlength="512" required></label><div class="dialog-actions"><button value="cancel" formnovalidate>Cancel</button><button value="rename" class="primary">Rename</button></div></form>';dialog.querySelector('input').value=row.name;document.querySelector('#app').append(dialog);const answer=await ask(dialog),name=dialog.querySelector('input').value.trim();dialog.remove();if(answer!=='rename'||!name)return;
    try{const scene=await readCard(row);if(!scene)throw new Error('Scene is no longer available');scene.name=name;if(row.type==='draft')await saveWorkspaceDraft(row.id,scene,{baseId:row.baseId,legacyKey:row.legacyKey});else await saveWorkspaceScene(row.id,scene,{thumbnail:row.thumbnail||'',legacyKey:row.legacyKey});await refreshHub();}catch(error){message(error.message);}
  }
  async function duplicateCard(row){try{const scene=await readCard(row);if(!scene)throw new Error('Scene is no longer available');scene.name=`${scene.name.slice(0,507)} copy`;await saveWorkspaceScene(uid(),scene,{thumbnail:row.thumbnail||''});await refreshHub();}catch(error){message(error.message);}}
  async function exportCard(row){try{const scene=await readCard(row);if(!scene)throw new Error('Scene is no longer available');const result=await createSceneFile(scene,{format:'auto'}),url=URL.createObjectURL(result.blob),link=document.createElement('a');link.href=url;link.download=`${scene.name.replace(/[^a-z0-9_-]/gi,'_')||'scene'}.${result.extension}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){message(error.message);}}
  async function confirmDelete(row){const d=document.createElement('dialog');d.className='workspace-dialog';d.innerHTML='<form method="dialog"><h2>Delete this scene?</h2><p>This removes the selected copy from this browser.</p><div class="dialog-actions"><button value="cancel">Cancel</button><button value="delete">Delete</button></div></form>';document.querySelector('#app').append(d);const answer=await ask(d);d.remove();return answer==='delete';}
  async function openCard(row,{preview=false}={}){if(loading)return;loading=true;try{const scene=await readCard(row);if(!scene)throw new Error('Scene is no longer available');await openScene(scene,{newId:row.type==='draft'?row.id:uid(),savedId:row.type==='saved'?row.id:row.baseId||null,legacy:row.type==='legacy'?row.id:row.legacyKey||null,isDraft:row.type==='draft'||row.type==='legacy-draft'});if(preview)await startPreview();}catch(error){message(error.message);}finally{loading=false;}}
  async function newScene(){if(loading)return;loading=true;try{await openScene(blank());}catch(error){message(error.message);}finally{loading=false;}}
  async function startPreview({forHidden=false}={}){if(mode!=='scene-edit')return;await flush();if(forHidden&&!viewer.uiHidden)return;previewBefore=editor.snapshot();previewSelectedId=editor.selected()?.id||null;replacementId=null;mode='scene-preview';stage.camera=cameraCopy(outputCamera||stage.camera);setView('gallery');startSceneSpeech(stage.groups.find(group=>group.id===stage.mainViewSpeech.value.group)||editor.selected());viewer.showView('gallery');update();}
  async function stopPreview(){if(mode!=='scene-preview')return;const scene=previewBefore;mode='scene-edit';if(scene)await restore(scene);if(previewSelectedId)editor.choose(stage.groups.find(group=>group.id===previewSelectedId));previewBefore=null;previewSelectedId=null;setView('studio');viewer.closePanels({focus:false});update();}
  async function navigate(view){try{if(view==='gallery')return role();if(view==='studio'){if(mode==='scene-export'){mode='scene-edit';setView('studio');viewer.openInspector();update();return;}return scenes();}if(view==='export'){if(mode==='scene-preview')await stopPreview();if(mode==='hub')return;if(mode==='scene-edit')mode='scene-export';setView('export');viewer.showView('export');update();}}catch(error){message(error.message);}}
  nav.querySelector('[data-workspace="role"]').onclick=role;nav.querySelector('[data-workspace="scenes"]').onclick=scenes;
  hub.querySelector('[data-action="new"]').onclick=newScene;hub.querySelector('[data-action="import"]').onclick=async()=>{await newScene();if(mode==='scene-edit')document.querySelector('#scene-file').click();};
  toolbar.querySelector('[data-action="library"]').onclick=()=>{cancelReplacement();viewer.openLibrary();};toolbar.querySelector('[data-action="replace"]').onclick=()=>requestReplacement();toolbar.querySelector('[data-action="templates"]').onclick=async()=>{const choice=await ask(insertDialog);if(!['story','skins'].includes(choice))return;insertTemplate=true;try{await hub.querySelector(`[data-template="${choice}"]`).onclick();}catch(error){message(error.message);}finally{insertTemplate=false;}};toolbar.querySelector('[data-action="controls"]').onclick=()=>viewer.openInspector();
  toolbar.querySelector('[data-action="save"]').onclick=()=>save().catch(error=>message(error.message));
  toolbar.querySelector('[data-action="preview"]').onclick=()=>{if(mode==='scene-export'){mode='scene-edit';setView('studio');viewer.openInspector();update();return;}(mode==='scene-preview'?stopPreview():startPreview()).catch(error=>message(error.message));};
  toolbar.querySelector('[data-action="output"]').onclick=()=>{if(mode!=='scene-edit'||!editor.before())return;outputCamera=cameraCopy(stage.camera);editor.changed();message('Output view updated',{transient:true});};
  hub.querySelector('[data-template="blank"]').onclick=newScene;
  hub.querySelector('[data-template="duo"]').onclick=async()=>{await newScene();if(mode==='scene-edit'){duoPending=2;editor.setName(t('Side by side'));editor.changed();message('Choose two artworks for this scene.',{transient:true});viewer.openLibrary();}};
  hub.querySelector('[data-template="story"]').onclick=async()=>{
    const source=getLibrary()?.rows.filter(row=>row.category==='story'&&row.status==='animated'&&row.presentation.id.startsWith('Spines/story/'))||[];
    if(!source.length){message('No story portraits are available');return;}
    const input=templateDialog.querySelector('[name="count"]'),scope=templateDialog.querySelector('[name="scope"]'),includeHx=templateDialog.querySelector('[name="include-hx"]'),axis=templateDialog.querySelector('[name="layout-axis"]');includeHx.checked=false;
    const available=()=>{const rows=source.filter(row=>includeHx.checked||!/_hx(?:\/|$)/i.test(row.presentation.id)),unique=[...new Map(rows.map(row=>[row.presentation.id,row])).values()];if(scope.value!=='characters')return unique;const characters=new Map();for(const row of unique.filter(row=>row.characterId)){const old=characters.get(row.characterId);if(!old||/_hx(?:\/|$)/i.test(old.presentation.id)&&!/_hx(?:\/|$)/i.test(row.presentation.id))characters.set(row.characterId,row);}return [...characters.values()];};
    const resetCount=()=>{input.max=String(Math.min(512,available().length));input.value=input.max;};scope.onchange=resetCount;includeHx.onchange=resetCount;scope.value='characters';if(!available().length)scope.value='all';resetCount();
    const syncAxis=()=>{for(const name of ['rows','columns']){const visible=name===axis.value;templateDialog.querySelector(`[data-layout-field="${name}"]`).hidden=!visible;templateDialog.querySelector(`[name="${name}"]`).disabled=!visible;}};axis.onchange=syncAxis;syncAxis();
    if(await ask(templateDialog)!=='create')return;
    const rows=available(),count=Math.max(1,Math.min(Number(input.value)||1,Number(input.max))),amount=Math.max(1,Math.min(Math.floor(Number(templateDialog.querySelector(`[name="${axis.value}"]`).value)||1),512)),gap=Math.max(-50,Math.min(Number(templateDialog.querySelector('[name="gap"]').value)||0,100));
    await buildGrid(rows.slice(0,count),t('Story portraits'),4,12,{axis:axis.value,amount,gap:gap/10});
  };
  hub.querySelector('[data-template="skins"]').onclick=async()=>{
    const rows=getLibrary()?.rows.filter(row=>['painting','skin'].includes(row.category)&&row.status==='animated'&&row.characterId&&row.presentation.id.startsWith('Spines/painting/')&&!row.appearance?.variantOf&&!/_hx(?:\/|$)/i.test(row.presentation.id))||[];
    const groups=new Map();for(const row of rows){const value=groups.get(row.characterId)||{name:row.characterName||row.characterId,rows:new Map()};value.rows.set(row.presentation.id,row);groups.set(row.characterId,value);}
    for(const [id,value] of groups)if(value.rows.size<2)groups.delete(id);
    const character=skinDialog.querySelector('[name="character"]');character.replaceChildren();for(const [id,value] of [...groups].sort((a,b)=>a[1].name.localeCompare(b[1].name))){const option=new Option(`${value.name} (${value.rows.size})`,id);option.dataset.i18nSkip='';character.append(option);}
    if(!character.options.length){message('No character appearances are available');return;}
    if(await ask(skinDialog)!=='create')return;const chosen=groups.get(character.value);if(!chosen)return;
    const columns=Math.max(1,Math.min(Number(skinDialog.querySelector('[name="columns"]').value)||4,20)),spacing=Math.max(1,Math.min(Number(skinDialog.querySelector('[name="spacing"]').value)||12,100));
    await buildGrid([...chosen.rows.values()],t('Skin comparison: {name}',{name:chosen.name}),columns,spacing);
  };
  async function buildGrid(rows,name,columns,spacing,storyLayout){
    const append=insertTemplate;if(append){if(mode!=='scene-edit'||editor.busy)return;if(stage.groups.length+rows.length>512){message('A scene supports up to 512 objects.');return;}await flush();}else await newScene();
    if(mode!=='scene-edit')return;const initial=editor.historySnapshot(),viewport=cameraCopy(stage.camera),origin=append?{x:viewport.x,y:viewport.y}:{x:0,y:0};if(!append)editor.setName(name);duoPending=0;loading=true;stage.templateBusy=true;editor.beginBatch();let complete=true;const added=[];
    try{for(let i=0;i<rows.length;i++){message(`Adding artwork ${i+1} / ${rows.length}…`);const target=storyLayout?origin:{x:origin.x+(i%columns-(columns-1)/2)*spacing,y:origin.y-Math.floor(i/columns)*spacing},ok=await selectRow(rows[i],target,{batch:true,...(rows.length>4?{textureLimit:rows.length>24?(rows.length>120?256:512):1024}:{})});if(!ok){complete=false;message(`Stopped at artwork ${i+1}`);break;}const group=stage.groups.at(-1);if(storyLayout)added.push(group);else arrange(group,target,spacing);}}
    finally{
      loading=false;stage.templateBusy=false;stage.evaluate(0);
      if(storyLayout&&added.length){
        const boxes=added.map(group=>{const bounds=stage.objectBounds(group),height=bounds&&bounds.maxY-bounds.minY;if(height>0){group.scale=Math.max(.01,Math.min(1000,group.scale*10/height));for(const layer of group.layers)stage.transformLayer(group,layer);}return stage.objectBounds(group);});
        const sizes=boxes.map(bounds=>bounds?{width:bounds.maxX-bounds.minX,height:bounds.maxY-bounds.minY}:{width:10,height:10}),positions=storyPositions(sizes,{...storyLayout,origin});
        added.forEach((group,index)=>{const bounds=boxes[index],center=bounds?{x:(bounds.minX+bounds.maxX)/2,y:(bounds.minY+bounds.maxY)/2}:{x:group.x,y:group.y};group.x+=positions[index].x-center.x;group.y+=positions[index].y-center.y;for(const layer of group.layers)stage.transformLayer(group,layer);});
        stage.evaluate(0);
      }
      if(append)stage.camera=viewport;else{stage.fit();outputCamera=cameraCopy(stage.camera);editor.resetHistory();}editor.before(initial);editor.endBatch();
    }
    if(complete)message(append?'Template added to scene':'Scene template created',{transient:true});
  }
  viewer.setCanvasContextMenu(event=>{
    if(mode!=='scene-edit'||viewer.uiHidden)return false;const group=stage.hitTestDetailed(event.clientX,event.clientY,{includeLocked:true});context.replaceChildren();
    const add=(label,fn)=>{const b=document.createElement('button');b.textContent=label;b.setAttribute('role','menuitem');b.onclick=()=>{context.hidden=true;fn();};context.append(b);};
    if(group){const selection=getSelection();if(selection&&!selection.has(group))selection.select(group);else editor.choose(group);const selected=selection?.getSelected().filter(item=>!item.locked)||[group];
      if(selected.length>1){const align=(axis,edge)=>editor.mutate(()=>{const rows=selected.filter(item=>!(item.parentId&&selected.some(owner=>owner.id===item.parentId))).map(item=>({item,bounds:stage.objectBounds(item)})).filter(row=>row.bounds);if(!rows.length)return;const key=axis==='x'?(edge==='min'?'minX':'maxX'):(edge==='min'?'minY':'maxY'),value=edge==='min'?Math.min(...rows.map(row=>row.bounds[key])):Math.max(...rows.map(row=>row.bounds[key]));for(const row of rows){const delta=value-row.bounds[key],local=stage.objectDragDelta(row.item,axis==='x'?delta:0,axis==='y'?delta:0);row.item.x+=local.x;row.item.y+=local.y;}});
        add('Align left',()=>align('x','min'));add('Align right',()=>align('x','max'));add('Align top',()=>align('y','max'));add('Align bottom',()=>align('y','min'));
        if(selected.length>2){const distribute=axis=>editor.mutate(()=>{const lo=axis==='x'?'minX':'minY',hi=axis==='x'?'maxX':'maxY',rows=selected.filter(item=>!(item.parentId&&selected.some(owner=>owner.id===item.parentId))).map(item=>({item,bounds:stage.objectBounds(item)})).filter(row=>row.bounds).sort((a,b)=>(a.bounds[lo]+a.bounds[hi])-(b.bounds[lo]+b.bounds[hi]));if(rows.length<3)return;const start=(rows[0].bounds[lo]+rows[0].bounds[hi])/2,end=(rows.at(-1).bounds[lo]+rows.at(-1).bounds[hi])/2;rows.forEach((row,index)=>{const delta=start+(end-start)*index/(rows.length-1)-(row.bounds[lo]+row.bounds[hi])/2,local=stage.objectDragDelta(row.item,axis==='x'?delta:0,axis==='y'?delta:0);row.item.x+=local.x;row.item.y+=local.y;});});add('Distribute horizontally',()=>distribute('x'));add('Distribute vertically',()=>distribute('y'));}}
      if(!group.locked&&(group.kind==='spine'||group.asset))add('Replace artwork',()=>requestReplacement(group));add('Move forward',()=>editor.mutate(()=>moveSceneLayer(stage.groups,group,1)));add('Move backward',()=>editor.mutate(()=>moveSceneLayer(stage.groups,group,-1)));add('Bring to front',()=>editor.mutate(()=>{for(let i=0;i<stage.groups.length;i++)moveSceneLayer(stage.groups,group,1);}));add('Send to back',()=>editor.mutate(()=>{for(let i=0;i<stage.groups.length;i++)moveSceneLayer(stage.groups,group,-1);}));
      add(group.locked?'Unlock':'Lock',()=>editor.mutate(()=>group.locked=!group.locked));add('Hide',()=>editor.mutate(()=>group.visible=false));
      add('Focus artwork',()=>{const b=stage.objectBounds(group);if(!b)return;stage.camera={x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2,width:Math.max(.01,(b.maxX-b.minX)*1.2),height:Math.max(.01,(b.maxY-b.minY)*1.2)};editor.changed({cameraOnly:true});});
      if(!group.locked){add('Reset transform',()=>editor.mutate(()=>{group.x=0;group.y=0;group.scale=1;group.rotation=0;group.flipX=false;group.flipY=false;}));if(group.kind==='spine'||group.asset)add('Add character background',()=>{editor.choose(group);document.querySelector('[data-editor-key="Add character background"]')?.click();});}
      add('Duplicate',async()=>{try{const previous=editor.snapshot(),{scene,copy}=duplicateSceneObject(previous,group.id);await editor.restore(scene);editor.before(previous);editor.choose(stage.groups.find(row=>row.id===copy.id));editor.changed();}catch(error){message(error.message);}});add('Delete',()=>editor.mutate(()=>{stage.remove(group.id);editor.choose(stage.groups.at(-1));}));}
    else{add('Add template',()=>toolbar.querySelector('[data-action="templates"]').click());add('Add artwork',()=>viewer.openLibrary());add('Add background image',()=>document.querySelector('#add-background').click());add('Fit scene',()=>document.querySelector('#fit').click());}
    context.hidden=false;context.style.left=`${Math.max(12,Math.min(event.clientX,innerWidth-context.offsetWidth-12))}px`;context.style.top=`${Math.max(12,Math.min(event.clientY,innerHeight-context.offsetHeight-12))}px`;context.querySelector('button')?.focus();return true;
  });
  document.addEventListener('pointerdown',event=>{if(!context.hidden&&!context.contains(event.target))context.hidden=true;},true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!context.hidden){context.hidden=true;event.preventDefault();}});
  document.addEventListener('keydown',event=>{
    if(mode!=='scene-edit'||event.defaultPrevented||event.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){const button=document.querySelector(event.shiftKey?'#redo':'#undo');if(!button.disabled){event.preventDefault();button.click();}return;}
    if(event.key==='Escape'){getSelection()?.clear();return;}
    if(!['Delete','Backspace'].includes(event.key)||editor.busy)return;const selection=getSelection()?.getSelected()||[],items=(selection.length?selection:[editor.selected()]).filter(group=>group&&!group.locked);if(!items.length)return;event.preventDefault();editor.mutate(()=>{for(const group of items)if(stage.groups.includes(group))stage.remove(group.id);editor.choose(stage.groups.at(-1));});
  });
  window.addEventListener('beforeunload',event=>{if(['scene-edit','scene-preview','scene-export'].includes(mode)&&dirty){event.preventDefault();event.returnValue='';}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')editor.flushAutosave().catch(()=>{});});
  document.addEventListener('mte-ui-visibility-change',event=>{if(event.detail.hidden&&mode==='scene-edit'){hiddenReturnToEdit=true;startPreview({forHidden:true}).catch(error=>message(error.message));}else if(!event.detail.hidden&&hiddenReturnToEdit){hiddenReturnToEdit=false;if(mode==='scene-preview'&&previewBefore)stopPreview().catch(error=>message(error.message));}});
  return {state,navigate,role,scenes,update,libraryPurpose,replacementTarget:()=>replacementId,cancelReplacement,finishReplacement,assetAdded(previousCount){if(mode!=='scene-edit')return;if(duoPending>0&&previousCount===2-duoPending){arrange(stage.groups.at(-1),{x:previousCount?6:-6,y:0},12);duoPending--;stage.evaluate(0);stage.fit();outputCamera=cameraCopy(stage.camera);}else if(!previousCount)outputCamera=cameraCopy(stage.camera);},async start(){try{const scene=await loadPreview();if(scene){await restore(scene);update();return true;}}catch(error){message(`Preview could not be restored: ${error.message}`);}update();return false;}};
}
