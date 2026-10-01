import {Unzip,UnzipInflate} from 'fflate';
import {packPath,packUrl,resourceType,PACK_CATALOGS} from './resource-pack.js';
const catalogueReader=(cache,url)=>async()=>{const response=await cache.match(url);return response.text();};
export async function stageResourceZip(file,cache,base,{signal,onProgress=()=>{},budget=Infinity}={}){
  const rows=[],seen=new Set(),active=new Set();let bytes=0,excluded=0,readBytes=0,error,pending=Promise.resolve();
  const check=()=>{if(signal?.aborted)throw new DOMException('Resource import cancelled','AbortError');if(error)throw error;};
  const unzip=new Unzip(entry=>{
    try{
      if(entry.name.endsWith('/')){packPath(entry.name.slice(0,-1));return;}const path=packPath(entry.name);
      if(!/\.(json|skel|atlas|png|webp|jpg|jpeg|m4a|ogg|mp3|wav)$/i.test(path)){excluded++;return;}
      if(seen.has(path)||seen.size>=100000)throw new Error('Duplicate or excessive archive resources');seen.add(path);
      const chunks=[];let size=0;active.add(entry);
      entry.ondata=(failure,data,final)=>{
        if(failure){error=failure;return;}try{check();size+=data.length;bytes+=data.length;if(size>128*1048576)throw new Error(`Archive resource exceeds the memory limit: ${path}`);if(bytes>budget)throw new Error('Not enough browser storage for this archive; the previous pack is retained');chunks.push(data);
          if(final){active.delete(entry);const blob=new Blob(chunks,{type:resourceType(path)});chunks.length=0;pending=pending.then(async()=>{check();const url=packUrl(path,base);try{await cache.put(url,new Response(blob,{headers:{'content-type':resourceType(path),'content-length':String(size)}}));}catch(reason){throw new Error(`Could not store ${path}: ${reason.message}`);}rows.push({path,file:{size,...(PACK_CATALOGS.includes(path)?{text:catalogueReader(cache,url)}:{})}});onProgress({files:rows.length,bytes,readBytes,total:file.size});});pending.catch(reason=>error=reason);}
        }catch(reason){error=reason;}
      };entry.start();
    }catch(reason){error=reason;}
  });unzip.register(UnzipInflate);
  const reader=file.stream().getReader();
  try{while(true){check();const {done,value}=await reader.read();readBytes+=value?.length||0;unzip.push(value||new Uint8Array(),done);check();await pending;if(done)break;}check();if(active.size)throw new Error('Archive ended before all files were read');return {rows,bytes,excluded};}
  finally{for(const entry of active)entry.terminate();await reader.cancel().catch(()=>{});}
}
