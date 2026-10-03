import {cacheKind,rangeBounds,evictionCandidates,validCatalogue} from './engine/cache-policy.js';
import {verifyPackCache} from './engine/resource-pack.js';
const scope=self.registration.scope,prefix=`mte-studio:${new URL(scope).pathname}:`,assetName=prefix+'assets:1',shellName=prefix+'shell:'+__MTE_BUILD_ID__,dbName=prefix+'metadata';
const MAX_ITEM=64*1024*1024,jobs=new Map();let dbPromise,settingsPromise,packPromise,writes=Promise.resolve();
const queue=action=>writes=writes.catch(()=>{}).then(action);
function db(){return dbPromise??=new Promise((resolve,reject)=>{const request=indexedDB.open(dbName,1);request.onupgradeneeded=()=>{request.result.createObjectStore('entries',{keyPath:'url'});request.result.createObjectStore('settings',{keyPath:'key'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function record(store,method,value){const database=await db();return new Promise((resolve,reject)=>{const transaction=database.transaction(store,method==='get'||method==='getAll'?'readonly':'readwrite'),request=transaction.objectStore(store)[method](value);let result;request.onsuccess=()=>result=request.result;transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||new Error('Cache storage transaction failed'));});}
function settings(){return settingsPromise??=record('settings','get','config').then(row=>row||{key:'config',enabled:true,budget:256*1024*1024});}
function localPack(){return packPromise??=record('settings','get','pack').then(row=>row||null);}
async function packResponse(url,header){const pack=await localPack();if(!pack)return null;const response=await (await caches.open(pack.name)).match(url);if(!response)return new Response('File absent from imported resource pack',{status:404,headers:{'content-type':'text/plain'}});return header?cachedRange(response,header):response;}
async function notify(message){for(const client of await self.clients.matchAll({type:'window'}))client.postMessage({type:'CACHE_NOTICE',message});}
async function packChanged(){for(const client of await self.clients.matchAll({type:'window'}))if(client.url.startsWith(scope))client.postMessage({type:'PACK_CHANGED'});}
async function bytes(response){const length=Number(response.headers.get('content-length'));if(length>MAX_ITEM)throw new Error('Resource exceeds the per-file cache limit');const reader=response.body?.getReader();if(!reader)return new Uint8Array();const chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_ITEM)throw new Error('Resource exceeds the per-file cache limit');chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}return data;}
async function valid(response,url){if(response.status!==200)return false;const path=new URL(url).pathname,type=response.headers.get('content-type')||'';if((cacheKind(url,scope)!=='shell'||/\.(js|css)$/.test(path))&&type.includes('text/html'))return false;if(/\.(png|webp|jpg|jpeg)$/.test(path)&&!type.startsWith('image/'))return false;if(/\.json$/.test(path)){try{const data=await response.clone().json();if(cacheKind(url,scope)==='catalog'&&!validCatalogue(data,path.split('/').at(-1)))return false;}catch{return false;}}return true;}
async function removeUrls(urls){const cache=await caches.open(assetName);for(const url of urls){await cache.delete(url);await record('entries','delete',url);}}
async function reconcile(){const cache=await caches.open(assetName),entries=await record('entries','getAll'),known=new Set(entries.map(row=>row.url));for(const row of entries)if(!await cache.match(row.url))await record('entries','delete',row.url);for(const request of await cache.keys())if(!known.has(request.url)){const response=await cache.match(request);await record('entries','put',{url:request.url,size:Number(response.headers.get('x-mte-cache-size'))||0,used:Date.now(),checked:0,kind:cacheKind(request.url,scope)});}}
async function store(url,response,kind,explicit=false){
  if(kind!=='shell'&&!explicit&&!(await settings()).enabled)return false;
  if(!await valid(response,url))return false;const data=await bytes(response.clone());if(!data.length)return false;
  return queue(async()=>{
    const config=await settings();if(kind!=='shell'&&!config.enabled&&!explicit)return false;
    const cache=await caches.open(kind==='shell'?shellName:assetName),previous=await cache.match(url);
    if(kind==='catalog'&&previous){const oldTag=previous.headers.get('etag'),newTag=response.headers.get('etag'),same=oldTag&&newTag?oldTag===newTag:await previous.clone().text()===new TextDecoder().decode(data);if(!same)await removeUrls((await record('entries','getAll')).filter(row=>row.kind==='asset').map(row=>row.url));}
    const old=kind==='shell'?null:await record('entries','get',url);
    if(kind!=='shell'){const candidates=evictionCandidates(await record('entries','getAll'),config.budget,data.length-(old?.size||0),url);await removeUrls(candidates.remove);if(candidates.total>config.budget)return false;}
    const headers=new Headers(response.headers);headers.delete('content-encoding');headers.set('content-length',String(data.length));headers.set('x-mte-cache-size',String(data.length));
    try{await cache.put(url,new Response(data,{status:200,headers}));if(kind!=='shell')await record('entries','put',{url,size:data.length,used:Date.now(),checked:Date.now(),kind});return true;}
    catch(error){await cache.delete(url);if(kind!=='shell')await record('entries','delete',url);await notify('Resource caching is unavailable or storage is full; online playback remains available');return false;}
  });
}
async function cachedRange(response,header){const blob=await response.blob(),bounds=rangeBounds(header,blob.size);if(bounds===undefined)return new Response(blob,{headers:response.headers});const headers=new Headers(response.headers);headers.set('accept-ranges','bytes');if(!bounds){headers.set('content-range',`bytes */${blob.size}`);headers.set('content-length','0');return new Response(null,{status:416,headers});}headers.set('content-range',`bytes ${bounds.start}-${bounds.end}/${blob.size}`);headers.set('content-length',String(bounds.end-bounds.start+1));return new Response(blob.slice(bounds.start,bounds.end+1),{status:206,headers});}
async function handle(request,event,kind){
  if(kind!=='shell'){const response=await packResponse(request.url,request.headers.get('range'));if(response)return response;}
  const url=request.url,config=await settings(),cache=await caches.open(kind==='shell'?shellName:assetName),cached=await cache.match(url),metadata=kind==='shell'?null:await record('entries','get',url);
  if(cached&&kind==='asset'&&Date.now()-(metadata?.checked||0)<30000){event.waitUntil(queue(()=>record('entries','put',{...metadata,used:Date.now()})).catch(()=>{}));return request.headers.has('range')?cachedRange(cached,request.headers.get('range')):cached;}
  try{
    const response=await fetch(new Request(request,{cache:'no-cache'}));
    if(response.status>=500)throw new Error('Resource server is unavailable');
    if(response.status===200&&!await valid(response,url)){if(cached){await notify('An invalid resource response was ignored; using the cached copy');return request.headers.has('range')?cachedRange(cached,request.headers.get('range')):cached;}return response;}
    if(response.status===200){if(kind==='catalog')await store(url,response,kind);else event.waitUntil(store(url,response,kind).catch(()=>{}));}
    if(response.status===206&&config.enabled){const total=Number(response.headers.get('content-range')?.split('/').at(-1));if(total>0&&total<=MAX_ITEM)event.waitUntil(fetch(url,{cache:'no-cache'}).then(full=>store(url,full,kind)).catch(()=>{}));}
    return response;
  }catch(error){if(cached)return request.headers.has('range')?cachedRange(cached,request.headers.get('range')):cached;return new Response('Resource unavailable offline. Open it online or prepare the scene cache first.',{status:503,headers:{'content-type':'text/plain'}});}
}
async function warmShell(){const url=new URL('app-shell.json',scope).href,response=await fetch(url,{cache:'no-cache'});if(!response.ok)throw new Error('Offline application manifest unavailable');const manifest=await response.clone().json();if(manifest.schema!==1||!Array.isArray(manifest.files))throw new Error('Invalid offline application manifest');for(const file of manifest.files){const target=new URL(file,scope).href;if(cacheKind(target,scope)!=='shell')throw new Error('Invalid application cache resource');const item=target===url?response:await fetch(target,{cache:'no-cache'});if(!item.ok||!await store(target,item,'shell'))throw new Error('Offline application resource unavailable');}}
self.addEventListener('install',event=>event.waitUntil(warmShell()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith(prefix+'shell:')&&name!==shellName)await caches.delete(name);await reconcile();await self.clients.claim();})()));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const kind=cacheKind(event.request.url,scope);if(kind)event.respondWith(handle(event.request,event,kind));});
self.addEventListener('message',event=>{
  if(!event.source?.url?.startsWith(scope))return;const message=event.data,port=event.ports[0];if(!message||!port)return;
  event.waitUntil((async()=>{try{
    if(message.type==='STATUS'){await queue(reconcile);const entries=await record('entries','getAll');port.postMessage({result:{...(await settings()),bytes:entries.reduce((sum,row)=>sum+row.size,0),entries:entries.length,build:__MTE_BUILD_ID__,pack:await localPack()}});}
    else if(message.type==='PACK_STATUS')port.postMessage({result:await localPack()});
    else if(message.type==='PACK_COMMIT'){
      if(typeof message.name!=='string'||!message.name.startsWith(prefix+'pack:')||!/^[-a-z0-9]+$/.test(message.name.slice((prefix+'pack:').length))||!Number.isSafeInteger(message.files)||message.files<5||message.files>100000||!Number.isSafeInteger(message.bytes)||message.bytes<0)throw new Error('Invalid imported pack');
      const cache=await caches.open(message.name),verified=await verifyPackCache(cache,message.manifest,scope,(done,total)=>port.postMessage({progress:{done,total}}));if(verified.files!==message.files||verified.bytes!==message.bytes)throw new Error('Imported pack files do not match');
      for(const file of ['presentations.json','runtime-index.json','library.json','audio-index.json','portrait-index.json']){const url=new URL('assets/'+file,scope).href,response=await cache.match(url);if(!response||!await valid(response,url))throw new Error(`Invalid imported catalogue: ${file}`);}
      await queue(async()=>{const previous=await localPack(),pack={key:'pack',name:message.name,files:message.files,bytes:message.bytes};await record('settings','put',pack);packPromise=Promise.resolve(pack);if(previous?.name&&previous.name!==pack.name)await caches.delete(previous.name).catch(()=>notify('The previous pack copy could not be cleaned up'));});port.postMessage({result:true});await packChanged();
    }
    else if(message.type==='PACK_REMOVE'){await queue(async()=>{const previous=await localPack();await record('settings','delete','pack');packPromise=Promise.resolve(null);if(previous)await caches.delete(previous.name);});port.postMessage({result:true});await packChanged();}
    else if(message.type==='CONFIG'){if(typeof message.enabled!=='boolean'||!Number.isInteger(message.budget)||message.budget<64*1024*1024||message.budget>2048*1024*1024)throw new Error('Invalid cache settings');await queue(async()=>{const config={key:'config',enabled:message.enabled,budget:message.budget};await record('settings','put',config);settingsPromise=Promise.resolve(config);await removeUrls(evictionCandidates(await record('entries','getAll'),config.budget).remove);});port.postMessage({result:true});}
    else if(message.type==='CLEAR'){await queue(async()=>{await caches.delete(assetName);await record('entries','clear');});port.postMessage({result:true});}
    else if(message.type==='CANCEL'){jobs.get(message.id)?.abort();port.postMessage({result:true});}
    else if(message.type==='PREFETCH'){
      if(!Array.isArray(message.urls)||message.urls.length>25000||typeof message.id!=='string'||message.id.length>128)throw new Error('Invalid cache request');const urls=[...new Set(message.urls)];for(const url of urls)if(!['asset','catalog'].includes(cacheKind(url,scope)))throw new Error('Only this application’s resource files can be cached');
      const controller=new AbortController();jobs.set(message.id,controller);let stored=0;
      try{const pack=await localPack();for(let i=0;i<urls.length;i++){if(controller.signal.aborted)throw new DOMException('Cache preparation cancelled','AbortError');const response=pack?await packResponse(urls[i]):await fetch(urls[i],{cache:'no-cache',signal:controller.signal});if(!response.ok)throw new Error(`Resource unavailable (${response.status})`);if(!pack&&!await store(urls[i],response,cacheKind(urls[i],scope),true))throw new Error('Resource could not be cached; check cache capacity and storage availability');stored++;port.postMessage({progress:{done:stored,total:urls.length}});}const cache=await caches.open(pack?.name||assetName);for(const url of urls)if(!await cache.match(url))throw new Error('Prepared resources exceed the cache budget; increase the limit or prepare a smaller scene');port.postMessage({result:{stored}});}finally{jobs.delete(message.id);}
    }else if(message.type==='UPDATE'){await self.skipWaiting();port.postMessage({result:true});}
    else throw new Error('Unknown cache request');
  }catch(error){port.postMessage({error:error.message});}})());
});
