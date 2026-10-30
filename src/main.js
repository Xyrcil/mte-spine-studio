import './style.css';
import './editor.css';
import './library.css';
import './viewer.css';
import './workspace.css';
import {createSceneWorkspace} from './scene-workspace.js';
import {createPreviewPool} from './preview-pool.js';
import {createViewerShell,uiHiddenPreference} from './viewer-shell.js';
import {GallerySpeech,speechPreferences} from './gallery-speech.js';
import {appearancePlaybackProfile} from './engine/appearance-playback.js';
import {createI18n,getLocale,setLocale} from './i18n.js';
import {Stage} from './engine/stage.js';
import {loadSpineRuntime} from './engine/runtime.js';
import {AudioBus} from './engine/audio.js';
import {createEditor} from './editor.js';
import {createExportPanel} from './export-panel.js';
import {createSoundPanel} from './sound-panel.js';
import {createVoicePanel,arrivalVoiceAvailability} from './voice-panel.js';
import {createHostApi} from './host-api.js';
import {configureResourceAliases} from './engine/resource-urls.js';
import {configureHostSceneStore,hostSavedScenes} from './engine/scene.js';
import {wallpaperMode,createWallpaperBridge,wallpaperPreferences,restoreWallpaperPreferences} from './wallpaper-bridge.js';
import {createCachePanel} from './cache-panel.js';
import {createSequencePanel} from './sequence-panel.js';
import {createCanvasInput} from './canvas-input.js';
import {createAssetLibrary,artworkPreviewView} from './asset-library.js';
import {createResourcePackPanel} from './resource-pack-panel.js';
import {skillDisplayOptions} from './engine/skill-display.js';
import {expandStationDrawings} from './engine/station-drawing.js';
import {createSkillPanel} from './skill-panel.js';
import {resolveInteractionVoice,explicitInteractionEffect,configureInteractionAmbients} from './engine/interaction-audio.js';

const startupSession=window.__mteHostSession;
if(window.__mteHostState)configureHostSceneStore(startupSession?.ui?.savedScenes||[]);
restoreWallpaperPreferences(startupSession?.ui);
if(['en','zh-CN'].includes(startupSession?.ui?.locale))setLocale(startupSession.ui.locale);
document.querySelector('#app').innerHTML = `
  <header class="viewer-header"><div class="brand">MTE <span>Spine Studio</span></div><button id="menu-toggle" aria-haspopup="menu" aria-controls="viewer-menu" aria-expanded="false">Menu</button></header>
  <section id="viewer-menu" class="t-dropdown" data-origin="top-right" role="menu" aria-label="Viewer options" inert>
    <div class="menu-heading"><span>MTE Spine Studio</span><small id="viewer-mode">Gallery</small></div>
    <button id="library-toggle" role="menuitem" aria-controls="asset-library" aria-expanded="false">Library <small>Characters & skins</small></button>
    <button id="editor-toggle" role="menuitem" aria-controls="scene-inspector" aria-expanded="false">Controls <small>Scene, animation & audio</small></button>
    <nav aria-label="Workspace"><button role="menuitem" data-view="gallery" class="selected">Gallery <small>Watch & interact</small></button><button role="menuitem" data-view="studio">Studio <small>Arrange your scene</small></button><button role="menuitem" data-view="export">Export <small>Video & images</small></button></nav>
    <div class="menu-playback"><button id="pause" role="menuitem">Pause</button><button id="viewer-mute" role="menuitem" disabled>Mute sound</button><button id="viewer-fit" role="menuitem">Fit scene</button><button id="viewer-fullscreen" role="menuitem">Full screen</button></div>
    <button id="viewer-hide-ui" role="menuitem" aria-keyshortcuts="H">Hide UI <small>Right-click to restore · Shortcut optional</small></button>
    <button id="interface-language" role="menuitem" aria-label="Switch interface language" title="Switch interface language">English / 简体中文</button>
  </section>
  <main><aside class="library" id="asset-library" aria-labelledby="library-title" hidden><div class="panel-heading"><div><p class="eyebrow">Collection</p><h2 id="library-title">Asset library</h2></div><button class="panel-close" data-close-panel aria-label="Close library">×</button></div><label for="search">Search artwork</label><input id="search" placeholder="Character, skin or resource"><label for="category">Artwork type</label><select id="category"><option value="">All types</option><option value="painting">Character artwork</option><option value="skin">Skins</option><option value="story">Story portraits</option><option value="storyCG">Story CG</option><option value="ui">Scenes / UI</option><option value="drawing">Other artwork</option><option value="portrait">Static portraits</option></select><div id="assets" role="list"></div></aside>
  <section class="workspace"><canvas id="stage" aria-label="Animated scene"></canvas><div id="status" role="status">Loading asset catalog…</div><button id="enable-sound" hidden>Enable sound</button></section>
  <aside class="inspector" id="scene-inspector" aria-labelledby="inspector-title" hidden><div class="panel-heading"><div><p class="eyebrow" id="inspector-eyebrow">Workspace</p><h2 id="inspector-title">Scene</h2></div><button class="panel-close" data-close-panel aria-label="Close controls">×</button></div><div id="layers"></div><label>Background <input id="background" type="color" value="#191b20"></label><label>Playback speed <input id="speed" type="range" min="0.1" max="2" step="0.1" value="1"></label><button id="fit">Fit scene</button><div id="details"></div><p id="notice">Gallery plays interactions. Studio edits the scene.</p></aside></main>`;
const status = document.querySelector('#status');
const resourceDetails=document.createElement('details'),resourceSummary=document.createElement('summary'),detailBody=document.querySelector('#details');resourceDetails.id='resource-details';resourceSummary.textContent='Resource details';detailBody.before(resourceDetails);resourceDetails.append(resourceSummary,detailBody);
const viewerPreferences=document.createElement('details');viewerPreferences.id='viewer-preferences';viewerPreferences.innerHTML=`<summary>Interface</summary><label for="viewer-ui-shortcut">Hide UI shortcut</label><select id="viewer-ui-shortcut"><option value="">Off</option>${Array.from({length:26},(_,index)=>String.fromCharCode(65+index)).map(key=>`<option value="${key}">${key}</option>`).join('')}</select><p>You can always hide UI from the menu and restore it with a right-click.</p>`;resourceDetails.before(viewerPreferences);
const interfaceText=createI18n(document.querySelector('#app'));window.mteI18n={getLocale,setLocale,refresh:interfaceText.refresh};
document.querySelector('#interface-language').onclick=()=>setLocale(getLocale()==='en'?'zh-CN':'en');
let stage;
try{await loadSpineRuntime(new URL(import.meta.env.BASE_URL,document.baseURI));stage=new Stage(document.querySelector('#stage'));}catch(error){status.textContent=`Rendering could not start: ${error.message}. Check browser graphics support and reload.`;document.querySelector('.library').inert=true;document.querySelector('.inspector').inert=true;for(const button of document.querySelectorAll('header button'))button.disabled=true;window.mteStartupError=error.message;}
if(stage){
window.mteStudio = stage;
const previewPool=createPreviewPool(stage);window.mtePreviewPool=previewPool;
for(const name of ['rendering-pausing','resource-import-start'])stage.addEventListener(name,()=>previewPool.clear());
let view = 'gallery', catalog, runtime, request, libraryData, audio,gallerySpeech,workspace,appReady=false,statusTimer;
const message = (value,{transient=false}={}) => {clearTimeout(statusTimer);status.textContent=value;status.classList.remove('is-quiet');if(transient)statusTimer=setTimeout(()=>status.classList.add('is-quiet'),4000);};
const speechNotices=new Map();let refreshDialogueStatus=()=>{};
const reportSpeechIssue=detail=>{const group=detail.group||stage.mainViewSpeech.value.group;if(!group)return;speechNotices.set(group,{language:detail.language||audio?.language,resourceName:detail.resourceName||'',reason:detail.reason||''});if(speechNotices.size>64)speechNotices.delete(speechNotices.keys().next().value);refreshDialogueStatus();};
const audioError=error=>{if(error.name==='NotAllowedError'){if(gallerySpeech)gallerySpeech.playbackBlocked();else{document.querySelector('#enable-sound').hidden=false;message('Your browser paused automatic audio. Choose Enable sound to continue.');}}else message(error.message);};
const wallpaper=createWallpaperBridge({onError:audioError});
const quietAudio=channel=>{const warning=audio?.hostOutput&&(audio.hostOutput.muted||audio.hostOutput.volume===0)?'Sound is muted by your wallpaper app.':audio?.muted?'All sound is muted. Open Menu to unmute.':channel==='effects'&&audio?.effectVolume===0?'Effect volume is zero. Raise Effect volume in Controls.':channel==='voice'&&audio?.volume===0?'Voice volume is zero. Raise Voice volume in Controls.':'';if(warning)queueMicrotask(()=>message(warning));};
const sourcePreview=document.createElement('button');sourcePreview.id='source-preview';sourcePreview.textContent='Source preview';document.querySelector('#fit').after(sourcePreview);
const closeLibrary=()=>viewer.closeLibrary();
const editor=createEditor(stage,message,group=>{window.mteLibrary?.setActive(group);window.mteSkills?.setActive(group);if(group?.kind==='spine'){describe(group);voicePanel(group.presentation);}else if(group?.appearanceId){const appearance=libraryData.appearances.find(row=>row.id===group.appearanceId);describePortrait(appearance);voicePanel({appearanceId:group.appearanceId});}else{document.querySelector('#details').textContent=group?'Image layer':'';document.querySelector('#voice-panel')?.remove();}});
window.mteEditor=editor;
const viewer=createViewerShell({stage,getView:()=>view,setView:value=>setView(value),canSelect:()=>!editor.busy&&view!=='export'&&workspace?.state().mode!=='scene-preview',canHide:()=>!editor.busy,message,preserveWorkspace:!wallpaperMode&&!window.__mteHostState,uiHidden:startupSession?.ui?.uiHidden});
const exporter=createExportPanel(stage,editor,()=>({catalog,runtime,library:libraryData,audio}),message);window.mteExporter=exporter;
const resourceCache=wallpaperMode?{ready:Promise.resolve(false)}:createCachePanel(stage,editor,()=>({library:libraryData,audio,catalog,runtime}),message);window.mteCache=resourceCache;
window.mtePack=wallpaperMode?{setLibrary:()=>{}}:createResourcePackPanel(resourceCache,editor,message,stage);
window.mteSequence=createSequencePanel(stage,editor,message);
stage.addEventListener('sequence-paused',()=>audio?.pause());
stage.addEventListener('resource-import-start',()=>audio?.pause());
stage.addEventListener('resource-import-ended',()=>{if(!stage.paused)audio?.resume().catch(error=>message(error.message));});
stage.addEventListener('sequence-playing',()=>audio?.resume().catch(error=>message(error.message)));
const renderingRetry=document.createElement('button');renderingRetry.id='rendering-retry';renderingRetry.textContent='Retry rendering';renderingRetry.hidden=true;document.querySelector('.viewer-header').append(renderingRetry);
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
  const regions=group.presentation.hotspots.length+(group.controllers||[]).filter(root=>root.source.id==='hot-spring'||root.source.class==='StationDrawingAnim').reduce((count,root)=>count+root.hotspots.filter(hit=>root.source.id!=='hot-spring'||hit.role).length,0);
  const parts=[...(group.presentation.standalone?['Standalone Spine preview']:[]),`${group.presentation.instances.length} skeleton instances`,`${regions} interaction regions`];
  parts.push(...(group.presentation.stationDrawingWarnings||[]));
  const inactiveRegions=group.presentation.hotspots.filter(hit=>hit.enabled===0||hit.enabled===false||!group.isActiveTransform(hit.transform)).length;
  if(inactiveRegions)parts.push(`${inactiveRegions} interaction regions disabled in the source configuration`);
  if(group.presentation.previewView)parts.push(group.previewReason?`Source preview unavailable: ${group.previewReason}`:group.presentation.previewView.origin==='archive'?'Archive-client preview configuration':'Legacy-client preview configuration');
  if(group.presentation.unassignedInstances?.length)parts.push(`Unassigned source skeleton components: ${group.presentation.unassignedInstances.map(instance=>instance.name).join(', ')}`);
  if(group.presentation.nativeBehaviours?.some(row=>row.class==='SpineAniDragBone'&&row.data.m_Enabled))parts.push('Source bone dragging · original-client verification pending');
  if(group.presentation.hotSpringHouse){const root=group.controllers.find(root=>root.source.id==='hot-spring');parts.push(!root?'Hot spring focus configuration unavailable':root.decorationModels.size&&!root.decorationReason?root.dialoguePanelAvailable?group.dialogueTypography?.slots.length===2&&!group.dialogueTypography.reason?'Hot spring conversations · original fonts and panel · browser text rasterization needs visual verification':'Hot spring conversations · original decorations and panel · dialogue text not yet restored':'Hot spring conversations · original decorations · dialogue panel layout not yet restored':'Hot spring conversations · original dialogue decorations not yet restored');}
  if(group.presentation.id.startsWith('Spines/storyCG/')&&group.layers.some(layer=>layer.instance.renderType==='SkeletonAnimation'))parts.push('Story CG playback · original-client visual comparison pending');
  if(libraryData?.appearances.some(row=>row.bundle===group.presentation.id&&row.hotSpringRoleId)&&!group.controllers.length)parts.push('Hot spring click behavior unavailable in this standalone asset');
  if(gaps.length)parts.push(`Unavailable animations in active layers: ${[...new Set(gaps.map(row=>row.animation))].join(', ')}`);
  const storyCues=(group.controllers||[]).flatMap(root=>root.missingTransitionEvents?.()||[]);if(storyCues.length)parts.push(`Story CG source transition events unavailable: ${storyCues.map(row=>row.layer).join(', ')}`);
  if(effects)parts.push(`Additional effects unavailable: ${effects}`);
  if(group.effects?.some(effect=>effect.verification))parts.push('Effect visual verification pending');
  const ordering=group.layers.filter(layer=>layer.instance.renderOrderStatus&&(!layer.materialMapping||layer.materialMapping.reason)).length;
  if(ordering)parts.push(`Material ordering unavailable: ${ordering}`);
  const bindingErrors=group.layers.filter(layer=>layer.materialMapping?.reason?.includes('bindings')).length;if(bindingErrors)parts.push(`Material bindings unavailable: ${bindingErrors}`);
  const tintErrors=group.layers.filter(layer=>layer.materialMapping?.reason?.includes('tint')).length;if(tintErrors)parts.push(`Material tint unavailable: ${tintErrors}`);
  const powerErrors=group.layers.filter(layer=>layer.materialMapping?.reason?.includes('color power')).length;if(powerErrors)parts.push(`Material color power unavailable: ${powerErrors}`);
  const materialEffects=[...new Set(group.layers.filter(layer=>layer.active).flatMap(layer=>layer.materialLimitations||[]))];if(materialEffects.length)parts.push(`Material effects not yet rendered: ${materialEffects.join(', ')}`);
  if(group.layers.some(layer=>layer.materialMapping?.pages))parts.push('Material segment visual verification pending');
  if(group.layers.some(layer=>layer.active&&layer.materialMapping?.distorted))parts.push('Material distortion filtering and color-space verification pending');
  document.querySelector('#details').textContent=parts.join(' · ');
}
function describePortrait(appearance){document.querySelector('#details').textContent=`Static portrait · ${appearance?.portrait?.width} × ${appearance?.portrait?.height}${appearance?.spineStatus==='missing-source'?' · Spine bundle absent from backup':appearance?.spineStatus==='available'?' · Animated version also available':''}`;}
const cancelAsset=document.createElement('button');cancelAsset.id='cancel-asset-load';cancelAsset.textContent='Cancel loading';cancelAsset.hidden=true;document.querySelector('.workspace').append(cancelAsset);
function finishAssetLoading(){stage.assetLoadBusy=false;cancelAsset.hidden=true;stage.canvas.setAttribute('aria-busy','false');if(!stage.recoveryPending)stage.resize();editor.refresh();}
function cancelAssetLoading(){if(!request)return;const pending=request;request=null;pending.abort();finishAssetLoading();message('Asset loading cancelled');}
cancelAsset.onclick=cancelAssetLoading;
async function loadAsset(label,create,loadedMessage=label,position,options={}){
  if(editor.assetSelectionBusy)return false;
  canvasInput.clear();request?.abort();const current=new AbortController();request=current;
  const previous=options.batch?null:editor.snapshot(),old=[...stage.groups],selectedView=view,replaced=options.replaceId?stage.groups.find(item=>item.id===options.replaceId):null;
  if(options.replaceId&&(!replaced||selectedView!=='studio'||replaced.locked)){request=null;message('The selected artwork cannot be replaced.');return false;}
  stage.assetLoadBusy=true;cancelAsset.hidden=false;stage.canvas.setAttribute('aria-busy','true');editor.refresh();message(`Loading ${label}…`);
  let group,replacementInstalled=false;
  try{
    group=await create(current.signal);
    if(current.signal.aborted||request!==current||view!==selectedView)throw new DOMException('Loading cancelled','AbortError');
    finishAssetLoading();if(!options.batch)editor.before(previous);audio?.stop();audio?.stopEffects();if(selectedView==='gallery')audio?.stopAmbients();
    if(replaced){const index=stage.groups.indexOf(replaced);if(index<0)throw new Error('The selected artwork is no longer available');for(const key of ['id','x','y','scale','rotation','opacity','flipX','flipY','visible','locked'])group[key]=replaced[key];stage.mainViewSpeech?.detach(replaced.id);stage.groups.splice(index,1,group);replacementInstalled=true;}else stage.groups.push(group);
    if(selectedView==='gallery')for(const previousGroup of old){if(workspace?.state().mode==='role'&&previousGroup.kind==='spine'&&stage.parkPreview(previousGroup))previewPool.put(previousGroup);else stage.remove(previousGroup.id);}
    stage.evaluate(0);if(selectedView==='gallery'&&workspace?.state().mode==='role'&&group.kind==='spine'&&!group.previewInitial)group.previewInitial=stage.snapshot().objects.find(row=>row.id===group.id);
    const arrival=selectedView==='gallery'?gallerySpeech?.enter(group):null;
    if(selectedView==='studio'&&workspace&&!replaced){if(position){group.x=position.x;group.y=position.y;}else if(old.length){group.x=stage.camera.x+Math.min(stage.camera.width*.18,old.length*2);group.y=stage.camera.y;}}
    stage.evaluate(0);if(selectedView==='gallery'||!old.length){stage.fit();if(selectedView==='gallery')stage.fitPreview(group);}editor.choose(group);if(!replaced)workspace?.assetAdded(old.length);else{audio?.releaseAmbient(replaced.id);audio?.ambientPreferences.delete(replaced.id);}editor.changed();if(replaced){stage.release(replaced);replacementInstalled=false;workspace?.finishReplacement();}request=null;message(loadedMessage,{transient:!group.presentation?.stationDrawingWarnings?.length});if(arrival?.accepted===false)reportSpeechIssue({group:group.id,language:audio.language,resourceName:arrival.resourceName});if(selectedView!=='studio'||!workspace)closeLibrary();return true;
  }catch(error){if(replacementInstalled&&replaced&&stage.groups.includes(group)){const index=stage.groups.indexOf(group);stage.groups.splice(index,1,replaced);stage.release(group);if(previous?.audio)stage.applyAudio?.(previous.audio);editor.choose(replaced);editor.changed();}else if(group&&!stage.groups.includes(group))stage.release(group);if(request===current&&error.name!=='AbortError')message(error.message);return false;}
  finally{if(request===current){request=null;finishAssetLoading();}}
}
function selectPortrait(appearance,position,options={}){return loadAsset(appearance.name||appearance.id,signal=>stage.addPortrait(appearance.portrait.path,[appearance.characterName,appearance.name].filter(Boolean).join(' · '),appearance.id,signal,true),'Static portrait loaded',position,options);}
function select(presentation,position,options={}){return loadAsset(presentation.id,signal=>{const cached=workspace?.state().mode==='role'?previewPool.take(presentation.id):null;if(cached){try{stage.resetPreview(cached);return Promise.resolve(cached);}catch(error){stage.release(cached);throw error;}}return stage.add(presentation,runtime.entries.filter(entry=>entry.bundle===(presentation.resourceBundle||presentation.id)),signal,true,options);},presentation.stationDrawingWarnings?.join(' ')||presentation.id,position,options);}
function voicePanel(presentation) {
  createVoicePanel(presentation,libraryData,audio,editor,message,stage);
}
document.querySelector('#background').onchange=event=>{const value=event.target.value;editor.mutate(()=>stage.background=value);};
document.querySelector('#speed').onchange=event=>{const value=Number(event.target.value);editor.mutate(()=>stage.speed=value);};
document.querySelector('#pause').onclick=()=>{if(window.mteSequence.togglePause())return;canvasInput.clear();editor.mutate(()=>{stage.paused=!stage.paused;if(stage.paused)audio?.pause();else audio?.resume().catch(error=>message(error.message));});};
document.querySelector('#fit').onclick=()=>{if(workspace?.state().mode==='scene-edit'){stage.evaluate(0);stage.fit();editor.changed({cameraOnly:true});}else editor.mutate(()=>{stage.evaluate(0);stage.fit();});};
sourcePreview.onclick=()=>editor.mutate(()=>{const group=editor.selected();if(!stage.fitPreview(group))message(`Source preview unavailable: ${group?.previewReason||'No matching configuration'}`);if(view==='studio')delete stage.camera.sourcePreview;});
stage.addEventListener('preview-resized',()=>{if(!editor.busy)editor.changed({cameraOnly:true});});
function setView(next){
  if(next!==view)cancelAssetLoading();
  canvasInput.clear();
  view=next;
  stage.previewResponsive=view==='gallery';if(view==='studio')delete stage.camera.sourcePreview;
  document.querySelector('#library-toggle').disabled=view==='export';
  for(const tab of document.querySelectorAll('button[data-view]'))tab.classList.toggle('selected',tab.dataset.view===view);
  exporter.setOpen(view==='export');
  document.querySelector('.library').inert=view==='export';document.querySelector('.library').classList.toggle('export-disabled',view==='export');
  viewer.setMode(view);
  gallerySpeech?.sync();
}
for (const button of document.querySelectorAll('button[data-view]'))button.onclick=()=>{if(workspace){workspace.navigate(button.dataset.view);return;}setView(button.dataset.view);viewer.showView(view);};
const canvasInput=createCanvasInput(stage,editor,{getView:()=>view,enableSelection:!wallpaperMode&&!window.__mteHostState,isRecording:()=>window.mteSequence.recorder.active,interact:(x,y)=>gallerySpeech?gallerySpeech.interactAt(x,y):stage.interact(x,y),onInteraction:result=>{if(result.accepted){editor.changed();message(`Interaction: ${result.animation||'reset'}`,{transient:true});}else if(result.resourceName)reportSpeechIssue({group:result.group,resourceName:result.resourceName});else if(result.reason!=='No interaction region here')message(result.reason);}});
stage.canvas.addEventListener('dragover',event=>{if(workspace?.state().mode==='scene-edit'&&event.dataTransfer.types.includes('application/x-mte-artwork')){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
stage.canvas.addEventListener('drop',event=>{if(workspace?.state().mode!=='scene-edit')return;const key=event.dataTransfer.getData('application/x-mte-artwork');if(!key)return;event.preventDefault();window.mteLibrary?.addByKey(key,stage.screenToWorld(event.clientX,event.clientY));});
window.mteHost=createHostApi({stage,editor,getAudio:()=>audio,getReady:()=>appReady,clearInput:()=>canvasInput.clear(),onError:audioError,
  getSessionUI:()=>({view:view==='studio'?'studio':'gallery',uiHidden:viewer.uiHidden,locale:getLocale(),selected:editor.selected()?.id,preferences:wallpaperPreferences(),savedScenes:hostSavedScenes(),speech:gallerySpeech?{group:gallerySpeech.groupId,blocked:gallerySpeech.blocked}:undefined}),
  restoreSessionUI:async ui=>{
    if(window.__mteHostState)configureHostSceneStore(ui.savedScenes||[]);
    restoreWallpaperPreferences(ui);if(['en','zh-CN'].includes(ui.locale))setLocale(ui.locale);
    await editor.restorePreferences?.();window.mteLibrary?.restorePreferences?.();
    if(gallerySpeech){let value;try{value=JSON.parse(localStorage.getItem('mte-gallery-speech'));}catch{}gallerySpeech.preferences=speechPreferences(value);gallerySpeech.groupId=stage.groups.some(group=>group.id===ui.speech?.group)?ui.speech.group:stage.mainViewSpeech.value.group||'';gallerySpeech.blocked=ui.speech?.blocked===true;}
    if(['gallery','studio'].includes(ui.view)){setView(ui.view);viewer.showView(ui.view);}
    if(typeof ui.uiHidden==='boolean')viewer.setUiHidden(uiHiddenPreference(location.search,ui.uiHidden),{persist:false,focus:false});
    const selected=stage.groups.find(group=>group.id===ui.selected);if(selected)editor.choose(selected);
  },
  setMode:mode=>{setView(mode);viewer.showView(mode);},
  onPreferencesChange:()=>{for(const [id,value] of [['voice-volume',audio?.volume],['effect-volume',audio?.effectVolume]]){const field=document.getElementById(id);if(field)field.value=value;}}});
await wallpaper.bind(window.mteHost);
stage.addEventListener('scene-change',()=>wallpaper.changed());
for(const name of ['click','change','mte-language-change','mte-ui-visibility-change'])document.addEventListener(name,()=>wallpaper.changed());
document.querySelector('#notice').textContent='Click to interact in Gallery; drag objects in Studio. Drag empty space to pan, or hold Space to pan anywhere. Scroll or pinch to zoom. With the canvas focused, use arrow keys to pan, +/− to zoom, and Home to fit.';
stage.addEventListener('sound-request',event=>{if(!audio||stage.paused||!stage.groups.some(group=>group.id===event.detail.group&&group.visible))return;if(!audio.soundInfo(event.detail.name,event.detail.category).clip){reportSpeechIssue({group:event.detail.group,resourceName:event.detail.name,language:audio.language});return;}quietAudio('effects');audio.playEffect(event.detail.name,event.detail.category,event.detail.lateness||0,true,event.detail.group).catch(audioError);});
stage.addEventListener('interaction-change',()=>{if(!editor.busy)editor.changed({runtimeOnly:true});});
stage.addEventListener('scene-change',()=>{const group=editor.selected();if(group?.kind==='spine')describe(group);});
stage.addEventListener('effect-request',()=>message('This interaction requests an effect that is not rendered yet.'));
stage.addEventListener('voice-request',event=>{
  if(!audio||stage.paused)return;
  if(event.detail.group&&!stage.groups.some(group=>group.id===event.detail.group&&group.visible))return;
  const effect=explicitInteractionEffect(event.detail,audio);if(effect)audio.playEffect(effect.name,effect.category,0,true,event.detail.group).catch(audioError);
  const language=event.detail.language||document.querySelector('#voice-language')?.value||audio.language,voice=resolveInteractionVoice(event.detail,libraryData,audio,language,{onUnavailable:warning=>reportSpeechIssue({group:event.detail.group,language,reason:warning})});if(!voice)return;
  quietAudio('voice');
  audio.play(voice,language,{group:event.detail.group||'',time:event.detail.lateness||0}).then(()=>{if(audio.currentVoice?.group!==event.detail.group||audio.currentVoice.voice.resourceName!==voice.resourceName)return;speechNotices.delete(event.detail.group);refreshDialogueStatus();gallerySpeech?.playbackReady(event.detail.group,voice.resourceName);document.querySelector('#enable-sound').hidden=true;if(voice.sourceMainView&&!stage.mainViewSpeech.value.wordsVisible)audio.hideSourceSubtitle(event.detail.group);}).catch(audioError);
});
stage.addEventListener('voice-stop-request',event=>{if(audio?.currentVoice?.group===event.detail.group)audio.stop();});
stage.addEventListener('voice-caption-hide-request',event=>audio?.hideSourceSubtitle(event.detail.group));
stage.addEventListener('source-caption-request',event=>{if(audio){audio.showSourceCaption(event.detail.group,event.detail.text);speechNotices.delete(event.detail.group);refreshDialogueStatus();}});
stage.addEventListener('speech-unavailable',event=>reportSpeechIssue(event.detail));
try {
  await resourceCache.ready;
  const base=import.meta.env.BASE_URL;
  const importedPack=import.meta.env.MODE==='web'&&await resourceCache.ready?await resourceCache.request('PACK_STATUS'):null;
  const useAliases=import.meta.env.MODE==='wallpaper'||import.meta.env.MODE==='web'&&!importedPack;
  const readIndex=async(name,optional=false)=>{const response=await fetch(`${base}assets/${name}`);if(!response.ok){if(optional)return null;throw new Error(`Catalog unavailable (${response.status})`);}return response.json();};
  const [presentationIndex,runtimeIndex,libraryIndex,portraitIndex,audioIndex,aliases]=await Promise.all([
    readIndex('presentations.json'),readIndex('runtime-index.json'),readIndex('library.json'),readIndex('portrait-index.json',true),readIndex('audio-index.json',true),useAliases?readIndex('resource-map.json'):null
  ]);
  [catalog,runtime,libraryData]=[presentationIndex,runtimeIndex,libraryIndex];
  if(aliases)configureResourceAliases(aliases,new URL(base,document.baseURI));
  window.mtePack.setLibrary(libraryData);
  configureInteractionAmbients(stage,libraryData);
  const {expandHotSpringPresentations}=await import('./engine/hot-spring.js');catalog.presentations=expandHotSpringPresentations(catalog.presentations,libraryData.hotSpringHouses,libraryData.hotSpringRoles,libraryData.voices,libraryData.characters);
  const skills=skillDisplayOptions(catalog.presentations,libraryData);catalog.presentations.push(...skills.flatMap(row=>row.presentation?[row.presentation]:[]));
  catalog.presentations=expandStationDrawings(catalog.presentations,libraryData,runtime.entries);
  for(const presentation of catalog.presentations){const appearance=libraryData.appearances.find(row=>row.bundle===presentation.id);if(appearance){presentation.label=[appearance.characterName,appearance.name].filter(Boolean).join(' · ');const view=artworkPreviewView(presentation,appearance,libraryData.artworkViews);if(view)presentation.previewView=view;}}
  if(portraitIndex)stage.setImageAssets(portraitIndex.entries);
  if(audioIndex){const sourceRows=[...(libraryData.mainViewVoices?.voices||[]),...(libraryData.mainViewVoices?.stationVoices||[]),...(libraryData.mainViewVoices?.favorVoices||[]),...(libraryData.mainViewVoices?.entryVoices||[])].map(row=>({...row,mainViewText:libraryData.mainViewVoices?.captions?.[row.resourceName]||''}));audio=new AudioBus(audioIndex,libraryData.soundResources,`${base}assets/`,[...libraryData.voices,...libraryData.storyVoices,...sourceRows]);stage.mainViewSpeech.configure(libraryData,audio);audio.addEventListener('subtitle',event=>{const el=document.querySelector('#subtitle');if(el)el.textContent=event.detail?.text||'';});for(const name of ['voice-state','effect-state'])audio.addEventListener(name,()=>{if(!editor.busy)editor.changed({audioOnly:true});});audio.addEventListener('audio-error',event=>message(event.detail));window.mteAudio=audio;createSoundPanel(stage,audio,libraryData,editor,message);}
  await wallpaper.sync();
  if(audio){
    let preferences;try{preferences=JSON.parse(localStorage.getItem('mte-gallery-speech'));}catch{}
    gallerySpeech=new GallerySpeech({stage,library:libraryData,audio,getView:()=>view,preferences:speechPreferences(preferences),onBlocked:()=>{document.querySelector('#enable-sound').hidden=false;message('Your browser paused automatic audio. Choose Enable sound to continue.');},onReady:()=>{document.querySelector('#enable-sound').hidden=true;quietAudio('voice');},onError:message});window.mteGallerySpeech=gallerySpeech;
    const controls=document.createElement('section');controls.id='automatic-voices';controls.innerHTML='<h3>Arrival and dialogue</h3><label id="entrance-label">Entrance animation<select id="entrance-mode"><option value="unlocked">Unlocked preview</option><option value="locked">Locked preview</option><option value="off">Off</option></select></label><p id="entrance-status"></p><label class="check-label"><input type="checkbox" data-speech="entry">Entry greeting</label><label>Greeting preview<select id="entry-greeting"><option value="login">Login greeting</option><option value="birthday">Birthday greeting</option></select></label><label class="check-label"><input type="checkbox" data-speech="touch">Click dialogue</label><label class="check-label"><input type="checkbox" data-speech="idle">Idle dialogue</label><button id="replay-arrival">Replay arrival</button><p>Preview settings do not change a game account. Idle dialogue follows the original two-minute timer; dedicated animation events keep their own sounds.</p>';
    document.querySelector('#sound-panel').before(controls);
    const dialogueStatus=document.createElement('p');dialogueStatus.id='dialogue-status';dialogueStatus.className='availability-note';dialogueStatus.setAttribute('role','status');controls.append(dialogueStatus);
    refreshDialogueStatus=()=>{
      const group=editor.selected();dialogueStatus.hidden=!group;if(!group)return;
      const availability=arrivalVoiceAvailability(libraryData,audio,{appearanceId:group.appearanceId??group.presentation?.appearanceId,bundle:group.presentation?.id},{birthday:gallerySpeech.preferences.birthday}),notice=speechNotices.get(group.id),missing=notice?.language===audio.language;
      dialogueStatus.dataset.state=missing?'missing':availability.state;
      dialogueStatus.textContent=missing?'Audio file is missing for this language. Animation remains available.':availability.state==='available'?'Entry voice available.':availability.label;
      dialogueStatus.title=missing?notice.resourceName||notice.reason:'';
    };
    const mute=document.querySelector('#viewer-mute');mute.disabled=false;mute.onclick=()=>editor.mutate(()=>audio.setMuted(!audio.muted));
    const refreshMute=()=>{mute.textContent=audio.muted?'Unmute sound':'Mute sound';mute.setAttribute('aria-pressed',String(audio.muted));};stage.addEventListener('scene-change',refreshMute);refreshMute();
    const persistSpeech=()=>{try{localStorage.setItem('mte-gallery-speech',JSON.stringify(gallerySpeech.preferences));}catch{}};
    const entrance=controls.querySelector('#entrance-mode'),greeting=controls.querySelector('#entry-greeting'),replay=controls.querySelector('#replay-arrival');
    const refreshArrival=()=>{
      const group=editor.selected(),profile=appearancePlaybackProfile(libraryData,group),preferences=gallerySpeech.preferences;
      entrance.value=!preferences.entrance?'off':preferences.entranceUnlocked?'unlocked':'locked';entrance.disabled=!profile?.available;
      controls.querySelector('#entrance-label').hidden=!profile;
      controls.querySelector('#entrance-status').textContent=!profile?'':profile.entranceItem===null?'Entrance metadata unavailable. Import an updated resource pack.':!profile.entranceItem?'No unlockable entrance is configured for this appearance.':!profile.available?'The configured entrance is unavailable in this source variant.':!preferences.entrance?'Entrance animation is off.':preferences.entranceUnlocked?'Entrance plays once, then returns to idle.':'Locked preview uses the idle animation.';
      greeting.value=preferences.birthday?'birthday':'login';greeting.disabled=!preferences.entry;
      replay.disabled=!gallerySpeech.eligible(group)||editor.busy;
      refreshDialogueStatus();
    };
    for(const field of controls.querySelectorAll('[data-speech]')){field.checked=gallerySpeech.preferences[field.dataset.speech];field.onchange=()=>{gallerySpeech.setPreference(field.dataset.speech,field.checked);persistSpeech();refreshArrival();};}
    entrance.onchange=()=>{gallerySpeech.setPreference('entrance',entrance.value!=='off');gallerySpeech.setPreference('entranceUnlocked',entrance.value!=='locked');persistSpeech();refreshArrival();};
    greeting.onchange=()=>{gallerySpeech.setPreference('birthday',greeting.value==='birthday');speechNotices.delete(editor.selected()?.id);persistSpeech();refreshDialogueStatus();};
    replay.onclick=()=>{if(editor.busy)return;if(stage.paused){message('Playback is paused');return;}const group=editor.selected();if(!gallerySpeech.eligible(group))return;setView('gallery');let result;editor.mutate(()=>{stage.triggerMainViewSpeech(group.id,'stop');audio.stop();for(const effect of [...audio.effects])if(effect.effectGroup===group.id)audio.releaseEffect(effect);result=gallerySpeech.enter(group);stage.evaluate(0);stage.draw();});if(result?.accepted!==false)message('Arrival replayed',{transient:true});};
    stage.addEventListener('scene-change',refreshArrival);refreshArrival();
    document.querySelector('#enable-sound').onclick=async()=>{try{await gallerySpeech.unlock();document.querySelector('#enable-sound').hidden=true;message('Sound enabled',{transient:true});}catch(error){message(error.name==='NotAllowedError'?'Audio is still blocked. Check this browser’s sound permissions.':error.message);}};
    stage.addEventListener('scene-change',()=>gallerySpeech.sync());
  }
  window.mteLibrary=createAssetLibrary(catalog,libraryData,{select,selectPortrait,isBusy:()=>editor.assetSelectionBusy,base,getPurpose:()=>workspace?.libraryPurpose()||'role',getReplaceTarget:()=>workspace?.replacementTarget()||null,onCancelReplace:()=>workspace?.cancelReplacement(),showUnavailable:entry=>{message(`Display unavailable: ${entry.name}`);voicePanel({appearanceId:entry.id});}});message(`${catalog.presentations.length} bundles · ${runtime.summary?.parsed??runtime.entries.filter(entry=>entry.status==='parsed').length} parsed skeletons`);
  window.mteSkills=createSkillPanel(skills,editor,select,message);
  let recovered=await editor.init(catalog.presentations,runtime.entries,{recover:wallpaperMode&&!window.__mteHostState});
  if(!wallpaperMode&&!window.__mteHostState){workspace=createSceneWorkspace({stage,editor,viewer,setView,getView:()=>view,message,getLibrary:()=>window.mteLibrary,getSelection:()=>canvasInput.selection,selectRow:(row,position,options)=>window.mteLibrary.addRow(row,position,false,options)});window.mteWorkspace=workspace;recovered=await workspace.start();}
  appReady=true;
  if(startupSession){await window.mteHost.restoreSession(startupSession);window.__mteHostSessionConsumed=true;recovered=true;}
  if(recovered)message('Scene restored',{transient:true});
  if(recovered&&!startupSession)gallerySpeech?.enter(editor.selected(),{entry:!stage.mainViewSpeech.value.group,animations:false});
  const initial=catalog.presentations.find(p=>p.id==='Spines/painting/3014027_spine');if(!recovered&&initial){await select(initial);stage.fit();editor.changed({cameraOnly:true});}
  await wallpaper.ready();
}catch(error){message(error.message);}
}
