import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';
const engine=process.argv[2]||'chromium',{browser,close}=await launchTestBrowser(engine);
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteHost?.getState().ready&&!window.mteEditor.busy);
  const result=await page.evaluate(async()=>{
    const api=window.mteHost,stage=window.mteStudio,audio=window.mteAudio;api.pause();const time=stage.groups[0].layers[0].state.getCurrent(0).trackTime;await new Promise(resolve=>setTimeout(resolve,100));if(stage.groups[0].layers[0].state.getCurrent(0).trackTime!==time||!audio.paused)throw new Error('Host pause did not freeze playback');
    api.setVolume(.25,'voice');api.setVolume(.35,'effects');api.setVolume(.45,'ambient');api.setMuted(true);if(!audio.element.muted||document.querySelector('#voice-volume').value!=='.25'&&document.querySelector('#voice-volume').value!=='0.25'||document.querySelector('#effect-volume').value!=='0.35'||document.querySelector('#ambient-volume').value!=='0.45'||!document.querySelector('#sound-muted').checked)throw new Error('Host preferences did not synchronize');
    const scene=api.getScene(),copy=api.getScene();copy.objects[0].x+=100;if(api.getScene().objects[0].x!==scene.objects[0].x)throw new Error('Host snapshot was not isolated');const changed=structuredClone(scene);changed.objects[0].x+=2;await api.loadScene(changed);if(stage.groups[0].x!==changed.objects[0].x)throw new Error('Host scene was not loaded');
    const bad=structuredClone(changed);bad.objects[0].layers[0].tracks[0].name='missing';let rejected=false;try{await api.loadScene(bad);}catch{rejected=true;}if(!rejected||stage.groups[0].x!==changed.objects[0].x)throw new Error('Invalid host scene changed the viewer');
    const size=api.resize();if(size.width!==stage.canvas.width||size.height!==stage.canvas.height)throw new Error('Host resize did not measure canvas');await api.resume();await new Promise(resolve=>setTimeout(resolve,100));if(stage.paused||audio.paused||stage.groups[0].layers[0].state.getCurrent(0).trackTime<=time)throw new Error('Host resume did not resume playback');api.pause();return {version:api.version,size,volumes:api.getState().volumes};
  });assert.deepEqual(errors,[]);console.log(engine+': host pause, audio preferences, resize, isolated scene reads and atomic scene loads passed',result);
}finally{await close();}
