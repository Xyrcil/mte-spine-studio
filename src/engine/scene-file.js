import {Zip,ZipPassThrough,Unzip,UnzipInflate,strToU8,strFromU8} from 'fflate';
import {validateScene} from './scene.js';

export const SCENE_FILE_LIMITS={json:64*1048576,image:64*1048576,decoded:384*1048576,archive:512*1048576,files:401};
const imagePath=/^images\/(0|[1-9]\d*)\.(png|jpeg|webp|gif)$/;
const check=signal=>{if(signal?.aborted)throw new DOMException('Scene file operation cancelled','AbortError');};
const yieldBrowser=()=>new Promise(resolve=>setTimeout(resolve,0));
const imageObjects=scene=>[...scene.objects,...(scene.sequence?.initial.objects||[])].filter(object=>object.kind==='image'&&!object.asset);
const decodeImage=src=>{const match=/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(src);if(!match)throw new Error('Invalid embedded scene image');const text=atob(match[2]),bytes=new Uint8Array(text.length);for(let i=0;i<text.length;i++)bytes[i]=text.charCodeAt(i);return {type:match[1],bytes};};
function rasterHeader(bytes,type){
  const matches=values=>values.every((value,index)=>bytes[index]===value);
  return type==='png'?matches([137,80,78,71,13,10,26,10]):type==='jpeg'?matches([255,216,255]):type==='gif'?['GIF87a','GIF89a'].includes(strFromU8(bytes.subarray(0,6))):type==='webp'?strFromU8(bytes.subarray(0,4))==='RIFF'&&strFromU8(bytes.subarray(8,12))==='WEBP':false;
}
function imageSource(bytes,type){const parts=[];for(let offset=0;offset<bytes.length;offset+=32768)parts.push(String.fromCharCode(...bytes.subarray(offset,offset+32768)));return `data:image/${type};base64,${btoa(parts.join(''))}`;}
const crcTable=Uint32Array.from({length:256},(_,value)=>{for(let i=0;i<8;i++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
const crcStep=(crc,bytes)=>{for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return crc>>>0;};

export async function createSceneFile(value,{format='auto',signal,onProgress=()=>{}}={}){
  if(!['auto','json','zip'].includes(format))throw new Error('Unsupported scene file format');check(signal);
  const scene=validateScene(value),packed=structuredClone(scene),images=new Map();let jsonDelta=0;
  for(const object of imageObjects(packed)){let row=images.get(object.src);if(!row){const type=/^data:image\/([^;]+)/.exec(object.src)[1];row={path:`images/${images.size}.${type}`,src:object.src};images.set(object.src,row);}jsonDelta+=object.src.length+JSON.stringify({src:''}).length-JSON.stringify({embeddedImage:row.path}).length;object.embeddedImage=row.path;delete object.src;}
  const metadata=strToU8(JSON.stringify({format:'mte-scene',schema:1,scene:packed}));
  const jsonBytes=metadata.length-strToU8(JSON.stringify({format:'mte-scene',schema:1,scene:null})).length+4+jsonDelta;
  if(format==='json'||format==='auto'&&jsonBytes<=SCENE_FILE_LIMITS.json){if(jsonBytes>SCENE_FILE_LIMITS.json)throw new Error('Scene JSON exceeds 64 MB; choose ZIP to store embedded images separately');const blob=new Blob([JSON.stringify(scene)],{type:'application/json'});check(signal);return {blob,extension:'json',images:images.size};}
  if(metadata.length>SCENE_FILE_LIMITS.json)throw new Error('Scene metadata exceeds 64 MB; remove unused objects or the recorded sequence');
  const chunks=[];let failure,decoded=metadata.length,written=0;
  const zip=new Zip((error,data)=>{if(error){failure=error;return;}written+=data.length;if(written>SCENE_FILE_LIMITS.archive){failure=new Error('Scene archive exceeds 512 MB');return;}chunks.push(data);});
  const add=(path,bytes)=>{check(signal);const file=new ZipPassThrough(path);zip.add(file);file.push(bytes,true);if(failure)throw failure;};
  try{
    add('scene.json',metadata);let count=0;
    for(const row of images.values()){check(signal);const {type,bytes}=decodeImage(row.src);if(bytes.length>SCENE_FILE_LIMITS.image)throw new Error('Scene image exceeds 64 MB');if(!rasterHeader(bytes,type))throw new Error('Invalid raster image in scene');decoded+=bytes.length;if(decoded>SCENE_FILE_LIMITS.decoded)throw new Error('Scene resources exceed the 384 MB import budget');add(row.path,bytes);onProgress({phase:'exporting',images:++count,total:images.size,bytes:written});await yieldBrowser();}
    check(signal);zip.end();if(failure)throw failure;return {blob:new Blob(chunks,{type:'application/zip'}),extension:'zip',images:images.size};
  }catch(error){zip.terminate();throw error;}
}

async function archiveDirectory(file,signal){
  check(signal);if(file.size>SCENE_FILE_LIMITS.archive)throw new Error('Scene archive exceeds 512 MB');
  const tail=new Uint8Array(await file.slice(Math.max(0,file.size-65557)).arrayBuffer()),view=new DataView(tail.buffer);let end=-1;
  for(let i=tail.length-22;i>=0;i--)if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===tail.length){end=i;break;}
  if(end<0)throw new Error('Scene ZIP is truncated or invalid');
  const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),offset=view.getUint32(end+16,true),endOffset=file.size-tail.length+end;
  if(view.getUint16(end+4,true)||view.getUint16(end+6,true)||view.getUint16(end+8,true)!==count||!count||count>SCENE_FILE_LIMITS.files||size>1048576||offset+size!==endOffset)throw new Error('Unsupported scene ZIP directory');
  const bytes=new Uint8Array(await file.slice(offset,offset+size).arrayBuffer()),directory=new DataView(bytes.buffer),rows=new Map();let cursor=0,total=0;
  for(let i=0;i<count;i++){
    check(signal);if(cursor+46>bytes.length||directory.getUint32(cursor,true)!==0x02014b50)throw new Error('Invalid scene ZIP entry');
    const flags=directory.getUint16(cursor+8,true),method=directory.getUint16(cursor+10,true),crc=directory.getUint32(cursor+16,true),compressed=directory.getUint32(cursor+20,true),decoded=directory.getUint32(cursor+24,true),nameLength=directory.getUint16(cursor+28,true),extraLength=directory.getUint16(cursor+30,true),commentLength=directory.getUint16(cursor+32,true),disk=directory.getUint16(cursor+34,true),attributes=directory.getUint32(cursor+38,true),localOffset=directory.getUint32(cursor+42,true),next=cursor+46+nameLength+extraLength+commentLength;
    if(next>bytes.length)throw new Error('Truncated scene ZIP entry');const name=strFromU8(bytes.subarray(cursor+46,cursor+46+nameLength));
    if(name!=='scene.json'&&!imagePath.test(name)||rows.has(name)||flags&1||![0,8].includes(method)||disk||(attributes>>>16&0xf000)===0xa000||localOffset+30+compressed>offset)throw new Error('Unsafe or duplicate scene ZIP entry');
    if(decoded>(name==='scene.json'?SCENE_FILE_LIMITS.json:SCENE_FILE_LIMITS.image))throw new Error('Scene ZIP entry exceeds its import limit');total+=decoded;if(total>SCENE_FILE_LIMITS.decoded)throw new Error('Scene resources exceed the 384 MB import budget');rows.set(name,{name,size:decoded,crc,method});cursor=next;
  }
  if(cursor!==bytes.length||!rows.has('scene.json'))throw new Error('Scene ZIP has no valid scene manifest');return rows;
}

export async function readSceneFile(file,{signal,onProgress=()=>{}}={}){
  check(signal);const header=new Uint8Array(await file.slice(0,4).arrayBuffer());
  if(header[0]!==80||header[1]!==75){if(file.size>SCENE_FILE_LIMITS.json)throw new Error('Scene JSON exceeds 64 MB; import a scene ZIP instead');const text=await file.text();check(signal);return validateScene(JSON.parse(text));}
  const directory=await archiveDirectory(file,signal),contents=new Map(),seen=new Set(),active=new Set();let error,total=0;
  const unzip=new Unzip(entry=>{
    try{
      check(signal);const row=directory.get(entry.name);if(!row||seen.has(entry.name)||entry.compression!==row.method)throw new Error('Scene ZIP entries do not match its directory');seen.add(entry.name);active.add(entry);const chunks=[];let size=0,crc=0xffffffff;
      entry.ondata=(failure,data,final)=>{if(failure){error=failure;return;}try{check(signal);size+=data.length;total+=data.length;if(size>row.size||total>SCENE_FILE_LIMITS.decoded)throw new Error('Scene ZIP expanded beyond its declared size');crc=crcStep(crc,data);chunks.push(data);if(final){if(size!==row.size||((crc^0xffffffff)>>>0)!==row.crc)throw new Error('Scene ZIP entry is damaged');const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}contents.set(entry.name,bytes);chunks.length=0;active.delete(entry);onProgress({phase:'importing',files:contents.size,total:directory.size,bytes:total});}}catch(reason){error=reason;entry.terminate();}};entry.start();
    }catch(reason){error=reason;}
  });unzip.register(UnzipInflate);const reader=file.stream().getReader();
  try{
    while(true){check(signal);if(error)throw error;const {done,value}=await reader.read();unzip.push(value||new Uint8Array(),done);if(error)throw error;if(done)break;await yieldBrowser();}
    if(active.size||contents.size!==directory.size)throw new Error('Scene ZIP ended before its resources were read');
    const manifest=JSON.parse(strFromU8(contents.get('scene.json')));if(manifest?.format!=='mte-scene'||manifest.schema!==1||!Array.isArray(manifest.scene?.objects))throw new Error('Unsupported scene ZIP manifest');
    const scene=manifest.scene,sources=new Map(),used=new Set(['scene.json']);
    for(const object of imageObjects(scene)){
      check(signal);const path=object.embeddedImage;if(typeof path!=='string'||!imagePath.test(path)||object.src!==undefined)throw new Error('Invalid scene image reference');const bytes=contents.get(path),type=path.split('.').at(-1);if(!bytes||!rasterHeader(bytes,type))throw new Error('Scene image is missing or invalid');if(!sources.has(path)){sources.set(path,imageSource(bytes,type));await yieldBrowser();}object.src=sources.get(path);delete object.embeddedImage;used.add(path);
    }
    if(used.size!==contents.size)throw new Error('Scene ZIP contains unreferenced resources');check(signal);return validateScene(scene);
  }finally{for(const entry of active)entry.terminate();await reader.cancel().catch(()=>{});}
}
