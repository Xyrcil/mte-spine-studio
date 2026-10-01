import workerUrl from './cache-worker.js?worker&url';
import {sceneCacheUrls} from './engine/cache-policy.js';
import {voiceCatalog} from './engine/voice-catalog.js';
import {sequenceCacheResources} from './engine/sequence-cache.js';

export function createCachePanel(stage,editor,getData,message){
  const panel=document.createElement('section');panel.id='cache-panel';panel.innerHTML=`<h2>Resource cache</h2><p id="cache-status" role="status">Starting resource cache…</p><label class="check-label"><input id="cache-enabled" type="checkbox" checked>Cache resources I open</label><label>Resource limit (MiB)<input id="cache-budget" type="number" min="64" max="2048" step="64" value="256"></label><label class="check-label"><input id="cache-voices" type="checkbox">Include selected character voices</label><div class="actions"><button id="cache-scene">Prepare scene offline</button><button id="cache-cancel" disabled>Cancel preparation</button><button id="cache-clear">Clear resource cache</button><button id="cache-refresh">Refresh cache status</button><button id="cache-persist">Request persistent storage</button><button id="cache-update" hidden>Apply app update</button></div><p>Only prepared or previously cached resources work offline. Clearing this cache does not remove saved scenes. Browser storage may still be evicted.</p>`;
  const sequenceLabel=document.createElement('label');sequenceLabel.className='check-label';sequenceLabel.innerHTML='<input id="cache-sequence" type="checkbox" checked>Include recorded sequence resources';panel.querySelector('.actions').before(sequenceLabel);
  document.querySelector('.inspector').append(panel);const field=id=>panel.querySelector(`#cache-${id}`);let registration,busy=false,job,controller;
  const status=value=>field('status').textContent=value;
  function request(type,data={},progress){return new Promise((resolve,reject)=>{
    const worker=navigator.serviceWorker.controller||registration?.active;if(!worker){reject(new Error('Resource cache is not ready'));return;}
    const channel=new MessageChannel();let timer;
    const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>{channel.port1.close();if(type==='PREFETCH'){const cancel=new MessageChannel();worker.postMessage({type:'CANCEL',id:data.id},[cancel.port2]);cancel.port1.close();}reject(new Error('Resource cache did not respond'));},120000);};
    channel.port1.onmessage=event=>{if(event.data.progress){arm();progress?.(event.data.progress);return;}clearTimeout(timer);channel.port1.close();event.data.error?reject(new Error(event.data.error)):resolve(event.data.result);};arm();worker.postMessage({type,...data},[channel.port2]);
  });}
  async function refresh(){const result=await request('STATUS');field('enabled').checked=result.enabled;field('budget').value=result.budget/1048576;const estimate=await navigator.storage?.estimate?.();status(`${(result.bytes/1048576).toFixed(1)} MiB cached · ${result.entries} resources${estimate?.quota?` · ${(estimate.quota/1048576).toFixed(0)} MiB browser quota`:''}${navigator.onLine?'':' · Offline'}`);return result;}
  const ready=(async()=>{
    if(import.meta.env.DEV){status('Resource caching is available in the production build');for(const button of panel.querySelectorAll('button,input'))button.disabled=true;return false;}
    if(!('serviceWorker' in navigator)||!isSecureContext){status('Offline caching is unavailable in this browser or connection');for(const button of panel.querySelectorAll('button,input'))button.disabled=true;return false;}
    const bounded=(promise)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Offline cache startup timed out; online playback remains available')),10000);promise.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});
    try{registration=await bounded(navigator.serviceWorker.register(workerUrl,{scope:import.meta.env.BASE_URL,updateViaCache:'none'}));await bounded(navigator.serviceWorker.ready);if(!navigator.serviceWorker.controller)await bounded(new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true})));
      navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='CACHE_NOTICE')status(event.data.message);});
      const update=()=>{field('update').hidden=!registration.waiting;};update();registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',update));
      await bounded(refresh());return true;
    }catch(error){status(`Cache unavailable: ${error.message}`);return false;}
  })();
  field('refresh').onclick=()=>refresh().catch(error=>status(error.message));
  const config=()=>request('CONFIG',{enabled:field('enabled').checked,budget:Number(field('budget').value)*1048576}).then(refresh).catch(error=>{status(error.message);message(error.message);});field('enabled').onchange=config;field('budget').onchange=config;
  field('clear').onclick=()=>request('CLEAR').then(refresh).catch(error=>status(error.message));
  field('persist').onclick=async()=>{try{status(await navigator.storage?.persist?.()?'Persistent storage granted':'Persistent storage was not granted; keep backups of saved scenes');}catch(error){status(error.message);}};
  field('update').onclick=()=>{const channel=new MessageChannel();registration.waiting?.postMessage({type:'UPDATE'},[channel.port2]);navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});};
  field('scene').onclick=async()=>{
    if(busy)return;if(editor.busy){status('Stop recording, playback or scene loading before preparing resources');return;}
    busy=true;job=crypto.randomUUID();controller=new AbortController();field('cancel').disabled=false;field('scene').disabled=true;
    try{
      if(!await ready)throw new Error('Offline preparation is unavailable');
      const {audio,library,catalog,runtime}=getData(),group=editor.selected(),base=new URL(import.meta.env.BASE_URL,location.origin).href,voices=field('voices').checked&&library&&group?voiceCatalog(library,[group.kind==='spine'?{id:group.presentation.id}:{appearanceId:group.appearanceId}]):[],urls=new Set(sceneCacheUrls(stage.groups,base,audio,voices,audio?.language));let warnings=[];
      if(field('sequence').checked&&stage.sequence){
        status('Checking recorded sequence resources…');
        const result=await sequenceCacheResources(stage.sequence,{catalog:catalog.presentations,entries:runtime.entries,imageAssets:stage.imageAssets,audio,library,base,sourceAspect:stage.canvas.width/stage.canvas.height,signal:controller.signal,onProgress:(at,total)=>status(`Checking sequence · ${at.toFixed(2)} / ${total.toFixed(2)} s`)});
        for(const url of result.urls)urls.add(url);warnings=result.warnings;
      }
      if(controller.signal.aborted)throw new DOMException('Cache preparation cancelled','AbortError');
      if(!urls.size)throw new Error('No scene resources to prepare');
      const catalogues=['runtime-index.json','presentations.json','library.json','audio-index.json','portrait-index.json'].map(name=>new URL('assets/'+name,base).href);
      await request('PREFETCH',{id:job,urls:[...new Set([...catalogues,...urls])]},info=>status(`Preparing ${info.done} / ${info.total} resources`));await refresh();if(warnings.length)status(field('status').textContent+' · '+warnings.join('; '));
    }catch(error){status(error.name==='AbortError'?'Cache preparation cancelled':error.message);}finally{busy=false;controller=null;field('cancel').disabled=true;field('scene').disabled=false;}
  };
  field('cancel').onclick=()=>{controller?.abort();request('CANCEL',{id:job}).catch(error=>status(error.message));};
  window.addEventListener('online',()=>registration&&refresh().catch(()=>{}));window.addEventListener('offline',()=>registration&&refresh().catch(()=>{}));
  return {ready,request,refresh};
}
