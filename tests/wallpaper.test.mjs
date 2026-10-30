import test from 'node:test';
import assert from 'node:assert/strict';
import {configureResourceAliases,resourceUrl,mapAssetManager} from '../src/engine/resource-urls.js';
import {Stage} from '../src/engine/stage.js';
import {AudioBus} from '../src/engine/audio.js';
import {createHostApi,validateHostState} from '../src/host-api.js';
import {createWallpaperBridge,wallpaperUserState} from '../src/wallpaper-bridge.js';
import {configureHostSceneStore,hostSavedScenes,saveLocalScene,loadLocalScene,listLocalScenes,deleteLocalScene} from '../src/engine/scene.js';

test('native named scenes survive session serialization without IndexedDB or duplicate autosave',async()=>{
  const scene={schema:1,name:'Named',background:'#191b20',camera:{x:0,y:0,width:10,height:10},speed:1,paused:true,objects:[]};
  try{
    configureHostSceneStore([]);await saveLocalScene(scene,'My scene');await saveLocalScene(scene);
    const saved=hostSavedScenes();assert.equal(saved.length,1);configureHostSceneStore(JSON.parse(JSON.stringify(saved)));
    assert.deepEqual(await listLocalScenes(),['My scene']);const loaded=await loadLocalScene('My scene');loaded.name='Changed';assert.equal((await loadLocalScene('My scene')).name,'Named');
    assert.equal(await loadLocalScene(),null);await deleteLocalScene('My scene');assert.deepEqual(hostSavedScenes(),[]);
  }finally{configureHostSceneStore(null);}
});

test('resource aliases preserve logical keys, relative atlas directories and explicit data URIs',()=>{
  configureResourceAliases({schema:1,aliases:{'spines/b/image.png':'spines/a/image.png'}},'http://127.0.0.1:1234/token/');
  assert.equal(resourceUrl('./assets/spines/b/image.png'),'http://127.0.0.1:1234/token/assets/spines/a/image.png');
  assert.equal(resourceUrl('https://example.test/image.png'),'https://example.test/image.png');
  const manager=mapAssetManager({rawDataUris:{'./assets/override.png':'data:image/png;base64,AA=='}});
  assert.equal(manager.rawDataUris['./assets/spines/b/image.png'],resourceUrl('./assets/spines/b/image.png'));
  assert.equal(manager.rawDataUris['./assets/override.png'],'data:image/png;base64,AA==');
  assert.equal(manager.rawDataUris['./assets/unmapped.atlas'],undefined);
  for(const path of ['../escape','/escape','x%2Fy','x?y','x\\y'])assert.throws(()=>configureResourceAliases({schema:1,aliases:{[path]:'safe.png'}},'http://localhost/'),/alias/);
  assert.throws(()=>configureResourceAliases({schema:1,aliases:{a:'b',b:'c'}},'http://localhost/'),/alias/);
  configureResourceAliases({schema:1,aliases:{}},'http://localhost/');
});

test('host patches validate atomically and keep authored scene settings separate',async()=>{
  const stage=new EventTarget(),scene={paused:false,speed:1.4,name:'Saved'},editor={busy:false,snapshot:()=>scene,refresh(){},changed(){throw new Error('Host controls must not save preferences');},restore:async()=>{}};
  Object.assign(stage,{canvas:{width:10,height:10},setHostPlayback(value){this.hostPaused=value.paused;}});
  const api=createHostApi({stage,editor,getAudio:()=>null,clearInput(){}});
  await api.setHostState({paused:true,muted:true,volume:.25,speed:1.5,fps:24,renderScale:.5});
  assert.equal(api.getState().paused,true);assert.equal(api.getScene().paused,false);assert.equal(api.getScene().speed,1.4);
  const before=api.getState().host;
  await assert.rejects(api.setHostState({volume:.3,fps:0}),/fps/);assert.deepEqual(api.getState().host,before);
  assert.throws(()=>validateHostState({muted:'true'}),/muted/);assert.throws(()=>validateHostState({volume:NaN}),/volume/);
  editor.busy=true;await api.setHostState({paused:false});assert.throws(()=>api.getSession(),/operation/);
});

test('session snapshots are isolated and a restore does not invoke entry playback',async()=>{
  const stage=new EventTarget(),original={schema:1,name:'Snapshot',paused:false,objects:[]};Object.assign(stage,{canvas:{width:1,height:1}});
  let scene=original,ui={locale:'en'},changed=0;
  const editor={busy:false,snapshot:()=>scene,refresh(){},changed(){changed++;},async restore(value){scene=structuredClone(value);}};
  const api=createHostApi({stage,editor,getAudio:()=>null,clearInput(){},getSessionUI:()=>ui,restoreSessionUI:value=>{ui=structuredClone(value);}});
  const value=api.getSession();value.ui.locale='zh-CN';value.scene.name='Restored';assert.equal(ui.locale,'en');
  await api.restoreSession(value);assert.equal(scene.name,'Restored');assert.equal(ui.locale,'zh-CN');assert.equal(changed,1);
});

test('host freeze cancels drawing, resumes without catch-up and limits rendered frames',()=>{
  const oldRequest=globalThis.requestAnimationFrame,oldCancel=globalThis.cancelAnimationFrame;
  let queued=0,cancelled=0,evaluated=0,drawn=0;
  globalThis.requestAnimationFrame=()=>++queued;globalThis.cancelAnimationFrame=()=>cancelled++;
  try{
    const stage=Object.create(Stage.prototype);Object.assign(stage,{options:{},previous:0,frame:1,hostPaused:false,hostFPS:30,hostSpeed:1,speed:1,renderScale:1,evaluate(value){evaluated+=value;},draw(){drawn++;}});
    stage.tick(16);assert.equal(drawn,0);stage.tick(34);assert.equal(drawn,1);
    stage.setHostPlayback({paused:true});const saved=evaluated;stage.tick(10000);assert.equal(drawn,1);assert.equal(evaluated,saved);assert.equal(cancelled,1);
    stage.setHostPlayback({paused:false});assert.ok(stage.previous>0);assert.equal(queued,3);
  }finally{globalThis.requestAnimationFrame=oldRequest;globalThis.cancelAnimationFrame=oldCancel;}
});

class Media extends EventTarget{
  constructor(src=''){super();Object.assign(this,{src,currentTime:0,duration:8,readyState:1,paused:true,ended:false});}
  async play(){this.paused=false;}
  pause(){this.paused=true;}
  removeAttribute(){this.src='';}
  load(){}
}
test('host audio controls cover detached current and future media without saving master gain',async()=>{
  const previous=globalThis.Audio;globalThis.Audio=Media;
  try{
    const entries=['voice','effect','ambient'].map((name,index)=>({name,category:index?'a_sound_ui':'a_sound_voiceeff',errors:[],clips:[{path:name+'.m4a'}]})),bus=new AudioBus({entries},[],'/assets/');
    bus.setVolume(.7);bus.setEffectVolume(.6);bus.setAmbientVolume(.4);
    await bus.play({resourceName:'voice'});const effect=await bus.playEffect('effect');bus.element.currentTime=2.5;
    await bus.setHostState({volume:.5,muted:true,speed:1.5,paused:true});
    assert.equal(bus.element.muted,true);assert.equal(effect.muted,true);assert.equal(bus.element.volume,.35);assert.equal(effect.volume,.3);assert.equal(bus.element.paused,true);
    assert.equal(bus.snapshot().muted,false);assert.equal(bus.snapshot().voiceVolume,.7);assert.equal(bus.snapshot().voiceTrack.time,2.5);
    const fresh=await bus.playEffect('effect');assert.equal(fresh.muted,true);assert.equal(fresh.paused,true);
    bus.element.currentTime=0;await bus.setHostState({paused:false,muted:false,volume:1});assert.equal(bus.element.currentTime,2.5);assert.equal(bus.element.paused,false);assert.equal(bus.element.volume,.7);
    bus.dispose();
  }finally{globalThis.Audio=previous;}
});

test('WE properties received before readiness are buffered and retain partial updates',async()=>{
  const win=new EventTarget();win.__mteWallpaperPending={user:{volume:{value:40}},general:{fps:24},paused:true};
  const calls=[],bridge=createWallpaperBridge({window:win}),api={version:2,capabilities:{hostState:true},async setHostState(value){calls.push({...value});}};
  win.wallpaperPropertyListener.applyUserProperties({speed:{value:150}});await bridge.bind(api);
  assert.deepEqual(calls.at(-1),{volume:.4,speed:1.5,fps:24,paused:true});
  let ready=0,changes=0;win.addEventListener('mte-host-ready',()=>ready++);win.addEventListener('mte-session-change',()=>changes++);await bridge.ready();assert.equal(ready,1);assert.equal(changes,1);
  win.wallpaperPropertyListener.setPaused(false);await Promise.resolve();assert.equal(calls.at(-1).paused,false);assert.equal(calls.at(-1).volume,.4);
  assert.deepEqual(wallpaperUserState({volume:{value:'bad'},muted:{value:false},renderscale:{value:50}}),{muted:false,renderScale:.5});
});
