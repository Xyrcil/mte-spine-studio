import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {cacheKind,validCatalogue,evictionCandidates,rangeBounds} from '../src/engine/cache-policy.js';

const source=(await readFile(new URL('../src/cache-worker.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
function worker({failOpen=false,failRead=false,fetch:network,caches:storage}={}){
  const connections=[],rows=new Map(),listeners=new Map();let opens=0,reads=0,closes=0,claims=0;
  const indexedDB={open(){const request={};opens++;queueMicrotask(()=>{
    if(failOpen){failOpen=false;request.error=new Error('Temporary open failure');request.onerror();return;}
    const database={close(){closes++;},transaction(){const read=value=>{const result={};reads++;queueMicrotask(()=>{if(failRead){failRead=false;tx.error=new Error('Temporary read failure');tx.onabort();return;}result.result=value;result.onsuccess();tx.oncomplete();});return result;},tx={objectStore(){return {get:key=>read(rows.get(key)),getAll:()=>read([]),delete:()=>read(undefined),put:value=>read(value)};}};return tx;}};
    connections.push(database);request.result=database;request.onsuccess();
  });return request;}};
  const context={indexedDB,URL,Request,Response,Headers,TextDecoder,Uint8Array,queueMicrotask,cacheKind,validCatalogue,evictionCandidates,rangeBounds,fetch:network,caches:storage,__MTE_BUILD_ID__:'test',self:{registration:{scope:'https://studio.invalid/'},clients:{matchAll:async()=>[],claim:async()=>{claims++;}},addEventListener(type,handler){listeners.set(type,handler);}}};
  runInNewContext(source+'\nglobalThis.api={db,settings,localPack,handle,store,warmShell};',context);
  return {api:context.api,connections,rows,listeners,get opens(){return opens;},get reads(){return reads;},get closes(){return closes;},get claims(){return claims;}};
}

test('cache metadata retries a failed database open without restarting the worker',async()=>{
  const state=worker({failOpen:true});await assert.rejects(state.api.db(),/Temporary open failure/);
  const database=await state.api.db();assert.equal(database,state.connections[0]);assert.equal(await state.api.db(),database);assert.equal(state.opens,2);
});
test('failed cache settings and pack reads can be retried',async()=>{
  for(const method of ['settings','localPack'])for(const failure of ['failOpen','failRead']){
    const state=worker({[failure]:true});await assert.rejects(state.api[method](),/Temporary .* failure/);
    const expected=method==='settings'?{key:'config',enabled:false,budget:67108864}:{key:'pack',name:'local-pack'};state.rows.set(method==='settings'?'config':'pack',expected);
    assert.equal(await state.api[method](),expected);const reads=state.reads;assert.equal(await state.api[method](),expected);assert.equal(state.reads,reads);
  }
});
test('closed cache metadata connections reopen and reload settings and local pack references',async()=>{
  const state=worker();state.rows.set('config',{enabled:true});state.rows.set('pack',{name:'first'});
  await state.api.settings();await state.api.localPack();assert.equal(state.opens,1);
  for(const event of ['onversionchange','onclose']){
    const database=state.connections.at(-1);database[event]();const config={enabled:false},pack={name:event};state.rows.set('config',config);state.rows.set('pack',pack);
    assert.equal(await state.api.settings(),config);assert.equal(await state.api.localPack(),pack);
  }
  assert.equal(state.opens,3);assert.equal(state.closes,1);
  state.connections[0].onclose();await state.api.db();assert.equal(state.opens,3);
});
test('unavailable local storage does not block online resources or strip range headers',async()=>{
  for(const failure of ['failOpen','failRead','cacheOpen']){
    const calls=[],pending=[],state=worker({[failure]:true,caches:{async open(){throw new Error('Cache unavailable');}},fetch:async request=>{calls.push(request);return new Response('online resource',{status:206,headers:{'content-range':'bytes 1-2/4'}});}});
    const response=await state.api.handle(new Request('https://studio.invalid/assets/example.wav',{headers:{range:'bytes=1-2'}}),{waitUntil:promise=>pending.push(promise)},'asset');
    assert.equal(response.status,206);assert.equal(await response.text(),'online resource');assert.equal(calls.length,1);assert.equal(calls[0].headers.get('range'),'bytes=1-2');await Promise.all(pending);
  }
});
test('combined storage and network failures return an explicit unavailable response',async()=>{
  const pending=[],state=worker({failOpen:true,fetch:async()=>{throw new Error('Offline');}}),response=await state.api.handle(new Request('https://studio.invalid/assets/example.wav'),{waitUntil:promise=>pending.push(promise)},'asset');
  assert.equal(response.status,503);assert.match(await response.text(),/local storage.*network request failed/);await Promise.all(pending);
});
test('catalogue cache write failure preserves the successful online response',async()=>{
  for(const failure of ['open','put']){
    const pending=[],data={schema:1,entries:[]};let writes=0,opens=0;
    const state=worker({caches:{async open(){if(++opens===2&&failure==='open')throw new Error('Cache connection closed');return {match:async()=>undefined,put:async()=>{writes++;throw new Error('Quota exceeded');},delete:async()=>true};}},fetch:async()=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}})});
    const response=await state.api.handle(new Request('https://studio.invalid/assets/runtime-index.json'),{waitUntil:promise=>pending.push(promise)},'catalog');
    assert.equal(response.status,200);assert.deepEqual(await response.json(),data);assert.equal(writes,failure==='put'?1:0);await Promise.all(pending);
  }
});
test('application shell installation and requests do not require the resource database',async()=>{
  const cached=new Map(),pending=[],state=worker({failOpen:true,caches:{async open(){return {match:async url=>cached.get(url)?.clone(),put:async(url,response)=>cached.set(url,response.clone())};}},fetch:async request=>{const url=typeof request==='string'?request:request.url;return url.endsWith('app-shell.json')?new Response(JSON.stringify({schema:1,files:['index.html','app-shell.json']}),{headers:{'content-type':'application/json'}}):new Response('<!doctype html><title>Studio</title>',{headers:{'content-type':'text/html'}});}});
  await state.api.warmShell();assert.equal(cached.size,2);assert.equal(state.opens,0);
  const response=await state.api.handle(new Request('https://studio.invalid/index.html'),{waitUntil:promise=>pending.push(promise)},'shell');
  assert.equal(response.status,200);assert.match(await response.text(),/Studio/);await Promise.all(pending);assert.equal(state.opens,0);
});
test('worker activation still claims pages when optional cache maintenance fails',async()=>{
  for(const failure of ['database','cache']){
    const state=worker({failOpen:true,caches:{keys:async()=>{if(failure==='cache')throw new Error('Cache unavailable');return [];},open:async()=>({})}});let completion;
    state.listeners.get('activate')({waitUntil:promise=>{completion=promise;}});await completion;assert.equal(state.claims,1);
  }
});
