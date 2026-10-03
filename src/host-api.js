export function createHostApi({stage,editor,getAudio,clearInput,getReady=()=>true,onPreferencesChange=()=>{}}){
  const available=()=>{if(stage.disposed)throw new Error('Viewer is closed');};
  const editable=()=>{available();if(!getReady())throw new Error('Resource catalogue is not ready');if(editor.busy)throw new Error('Finish the current operation before changing the scene');};
  const audio=()=>{const bus=getAudio();if(!bus)throw new Error('Audio resources are not ready');return bus;};
  const changed=()=>{editor.changed({audioOnly:true});onPreferencesChange();};
  return Object.freeze({
    version:1,
    getState(){return {ready:Boolean(getReady()),paused:stage.paused,recovering:Boolean(stage.recoveryPending),busy:Boolean(editor.busy),muted:getAudio()?.muted??true,volumes:getAudio()?{voice:getAudio().volume,effects:getAudio().effectVolume,ambient:getAudio().ambientVolume}:null,width:stage.canvas.width,height:stage.canvas.height};},
    getScene(){available();return structuredClone(editor.snapshot());},
    pause(){available();clearInput();stage.paused=true;if(stage.recoverySnapshot)stage.recoverySnapshot.paused=true;getAudio()?.pause();stage.dispatchEvent(new CustomEvent('host-playback-change',{detail:{paused:true}}));editor.refresh();},
    async resume(){available();if(stage.recoveryPending||stage.resourceImportBusy||stage.packReloadRequired||editor.busy&&!stage.sequenceBusy)throw new Error('Wait for rendering and resources to become ready');clearInput();stage.paused=false;stage.dispatchEvent(new CustomEvent('host-playback-change',{detail:{paused:false}}));editor.refresh();if(getAudio())await getAudio().resume();},
    setMuted(value){if(typeof value!=='boolean')throw new Error('Mute must be true or false');editable();audio().setMuted(value);changed();},
    setVolume(value,channel='all'){if(!Number.isFinite(value)||value<0||value>1||!['all','voice','effects','ambient'].includes(channel))throw new Error('Invalid channel or volume');editable();const bus=audio();if(channel==='all'||channel==='voice')bus.setVolume(value);if(channel==='all'||channel==='effects')bus.setEffectVolume(value);if(channel==='all'||channel==='ambient')bus.setAmbientVolume(value);changed();},
    resize(){available();stage.resize();if(!stage.recoveryPending)stage.draw();return {width:stage.canvas.width,height:stage.canvas.height};},
    async loadScene(value,{signal}={}){editable();clearInput();await editor.restore(value,signal);editor.changed();return structuredClone(editor.snapshot());}
  });
}
