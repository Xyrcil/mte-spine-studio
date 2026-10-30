export const defaultHostState=Object.freeze({paused:false,muted:false,volume:1,speed:1,fps:60,renderScale:1});

export function validateHostState(value,current=defaultHostState){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid host state');
  const next={...current},ranges={volume:[0,1],speed:[.1,2],fps:[1,120],renderScale:[.25,2]};
  for(const [key,item] of Object.entries(value)){
    if(key==='paused'||key==='muted'){if(typeof item!=='boolean')throw new Error('Invalid host '+key);}
    else if(ranges[key]){const [min,max]=ranges[key];if(!Number.isFinite(item)||item<min||item>max||key==='fps'&&!Number.isInteger(item))throw new Error('Invalid host '+key);}
    else throw new Error('Unknown host control: '+key);
    next[key]=item;
  }
  return next;
}

export function createHostApi({stage,editor,getAudio,clearInput,getReady=()=>true,onPreferencesChange=()=>{},getSessionUI=()=>({}),restoreSessionUI=()=>{},setMode=()=>{},onError=()=>{}}){
  let host={...defaultHostState};
  const available=()=>{if(stage.disposed)throw new Error('Viewer is closed');};
  const editable=()=>{available();if(!getReady())throw new Error('Resource catalogue is not ready');if(editor.busy)throw new Error('Finish the current operation before changing the scene');};
  const audio=()=>{const bus=getAudio();if(!bus)throw new Error('Audio resources are not ready');return bus;};
  const changed=()=>{editor.changed({audioOnly:true});onPreferencesChange();};
  const apply=()=>{stage.setHostPlayback?.(host);return getAudio()?.setHostState?.({muted:host.muted,volume:host.volume,speed:host.speed,paused:host.paused});};
  const api={
    version:2,
    capabilities:Object.freeze({hostState:true,session:true,editor:true}),
    getState(){return {ready:Boolean(getReady()),paused:Boolean(stage.paused||host.paused),recovering:Boolean(stage.recoveryPending),busy:Boolean(editor.busy),muted:Boolean((getAudio()?.muted??true)||host.muted),volumes:getAudio()?{voice:getAudio().volume,effects:getAudio().effectVolume,ambient:getAudio().ambientVolume}:null,host:{...host},width:stage.canvas.width,height:stage.canvas.height};},
    getScene(){available();return structuredClone(editor.snapshot());},
    pause(){available();clearInput();stage.paused=true;if(stage.recoverySnapshot)stage.recoverySnapshot.paused=true;getAudio()?.pause();host={...host,paused:true};Promise.resolve(apply()).catch(onError);stage.dispatchEvent(new CustomEvent('host-playback-change',{detail:{paused:true}}));editor.refresh();},
    async resume(){available();if(stage.recoveryPending||stage.resourceImportBusy||stage.packReloadRequired||editor.busy&&!stage.sequenceBusy)throw new Error('Wait for rendering and resources to become ready');clearInput();stage.paused=false;host={...host,paused:false};await apply();stage.dispatchEvent(new CustomEvent('host-playback-change',{detail:{paused:false}}));editor.refresh();if(getAudio())await getAudio().resume();},
    setMuted(value){if(typeof value!=='boolean')throw new Error('Mute must be true or false');editable();audio().setMuted(value);changed();},
    setVolume(value,channel='all'){if(!Number.isFinite(value)||value<0||value>1||!['all','voice','effects','ambient'].includes(channel))throw new Error('Invalid channel or volume');editable();const bus=audio();if(channel==='all'||channel==='voice')bus.setVolume(value);if(channel==='all'||channel==='effects')bus.setEffectVolume(value);if(channel==='all'||channel==='ambient')bus.setAmbientVolume(value);changed();},
    resize(){available();stage.resize();if(!stage.recoveryPending)stage.draw();return {width:stage.canvas.width,height:stage.canvas.height};},
    async loadScene(value,{signal}={}){editable();clearInput();await editor.restore(value,signal);await apply();editor.changed();return structuredClone(editor.snapshot());},
    async setHostState(value){
      available();const next=validateHostState(value,host),pauseChanged=next.paused!==host.paused;
      if(pauseChanged)clearInput();host=next;
      try{await apply();}catch(error){onError(error);}
      if(pauseChanged)stage.dispatchEvent(new CustomEvent('host-playback-change',{detail:{paused:api.getState().paused}}));
      return api.getState();
    },
    getSession(){editable();if(stage.sequenceBusy||stage.activeLoads)throw new Error('Finish the current operation before saving a session');return {schema:1,scene:api.getScene(),ui:structuredClone(getSessionUI())};},
    async restoreSession(value,{signal}={}){
      editable();if(value?.schema!==1||!value.scene||typeof value.scene!=='object')throw new Error('Invalid wallpaper session');
      clearInput();await editor.restore(value.scene,signal);await restoreSessionUI(value.ui||{});await apply();editor.changed();
      return api.getState();
    },
    setMode(value){editable();if(!['gallery','studio'].includes(value))throw new Error('Invalid wallpaper mode');setMode(value);}
  };
  return Object.freeze(api);
}
