export const wallpaperMode=import.meta.env?.MODE==='wallpaper'||Boolean(globalThis.window?.__mteHostState);
const preferenceKeys=['mte-interface-language','mte-gallery-speech','mte-camera-presets','mte-library-favorites','mte-library-recent','mte-ui-shortcut'];

export function wallpaperPreferences(){
  const result={};try{for(const key of preferenceKeys){const value=localStorage.getItem(key);if(value!==null&&value.length<=262144)result[key]=value;}}catch{}
  return result;
}

export function restoreWallpaperPreferences(ui){
  try{for(const key of preferenceKeys){const value=ui?.preferences?.[key];if(typeof value==='string'&&value.length<=262144)localStorage.setItem(key,value);}}catch{}
  if(ui?.preferences)globalThis.document?.dispatchEvent(new Event('mte-preferences-restored'));
}

export function wallpaperUserState(properties){
  const state={},number=(name,min,max,scale=1)=>{const raw=properties?.[name]?.value;if(raw===undefined)return;const value=Number(raw)/scale;if(Number.isFinite(value))state[name==='renderscale'?'renderScale':name]=Math.max(min,Math.min(max,value));};
  if(typeof properties?.muted?.value==='boolean')state.muted=properties.muted.value;
  number('volume',0,1,100);number('speed',.1,2,100);number('renderscale',.25,2,100);
  return state;
}

export function createWallpaperBridge({window:win=window,onError=()=>{}}={}){
  let api,ready=false;
  const pending=win.__mteWallpaperPending||{},state={...(wallpaperMode?{muted:true}:{}),...wallpaperUserState(pending.user),...win.__mteHostState};
  const general=value=>{if(Number.isFinite(value?.fps))state.fps=Math.max(1,Math.min(120,Math.round(value.fps)));};
  general(pending.general);if(typeof pending.paused==='boolean')state.paused=pending.paused;
  const sync=()=>{if(win.__mteHostState)Object.assign(state,win.__mteHostState);return api?.setHostState(state).catch(onError);};
  const listener=win.wallpaperPropertyListener||{};
  Object.assign(listener,{
    applyUserProperties(value){Object.assign(state,wallpaperUserState(value));sync();},
    applyGeneralProperties(value){general(value);sync();},
    setPaused(value){if(typeof value==='boolean'){state.paused=value;sync();}}
  });
  win.wallpaperPropertyListener=listener;
  delete win.__mteWallpaperPending;
  return {
    bind(value){api=value;return sync();},
    sync,
    async ready(){await sync();ready=true;win.dispatchEvent(new CustomEvent('mte-host-ready',{detail:{version:api.version,capabilities:api.capabilities}}));this.changed();},
    changed(){if(ready)win.dispatchEvent(new CustomEvent('mte-session-change'));}
  };
}
