import {validCatalogue} from './cache-policy.js';
export const PACK_CATALOGS=['presentations.json','runtime-index.json','library.json','audio-index.json','portrait-index.json'];
export function playbackMetadataStatus(library){
  const skins=library?.appearances?.filter(row=>row.kind==='skin')||[],entrances=skins.filter(row=>Number.isSafeInteger(row.entranceItem)&&row.entranceItem>=0).length;
  const greetings=Array.isArray(library?.mainViewVoices?.entryVoices);
  return {ready:Boolean(greetings&&entrances===skins.length),entrances,greetings:greetings?library.mainViewVoices.entryVoices.length:0};
}
const extensions=/\.(json|skel|atlas|png|webp|jpg|jpeg|m4a|ogg|mp3|wav|otf|ttf)$/i;
export function packPath(value){
  if(typeof value!=='string'||value.length>2048||value.startsWith('/')||/[\\\u0000-\u001f?#%]/.test(value))throw new Error('Invalid resource path');
  const parts=value.split('/');if(parts.some(part=>!part||part==='.'||part==='..'||part.includes(':')))throw new Error('Invalid resource path');return parts.join('/');
}
export function packUrl(path,base){return new URL('assets/'+packPath(path).split('/').map(encodeURIComponent).join('/'),base).href;}
export function resourceFiles(files){
  const rows=[],seen=new Set();let excluded=0,total=0;
  const roots=new Set([...files].filter(file=>file.webkitRelativePath?.endsWith('/presentations.json')).map(file=>file.webkitRelativePath.slice(0,-'presentations.json'.length)));
  if(roots.size!==1)throw new Error('Choose one converted assets folder containing presentations.json');const root=[...roots][0];
  for(const file of files){if(!file.webkitRelativePath?.startsWith(root)){excluded++;continue;}const path=packPath(file.webkitRelativePath.slice(root.length));if(!extensions.test(path)){excluded++;continue;}if(seen.has(path))throw new Error(`Duplicate resource: ${path}`);seen.add(path);if(!Number.isSafeInteger(file.size)||file.size<0)throw new Error('Invalid resource size');total+=file.size;rows.push({path,file});}
  if(rows.length>100000)throw new Error('The selected folder contains too many resources');
  for(const name of PACK_CATALOGS)if(!seen.has(name))throw new Error(`Resource catalogue missing: ${name}`);
  return {rows,bytes:total,excluded};
}
export async function validatePackCatalogues(rows){
  const catalogues={};
  for(const name of PACK_CATALOGS){const file=rows.find(row=>row.path===name)?.file;if(!file||file.size>32*1024*1024)throw new Error(`Invalid resource catalogue: ${name}`);let data;try{data=JSON.parse(await file.text());}catch{throw new Error(`Invalid JSON catalogue: ${name}`);}if(!validCatalogue(data,name))throw new Error(`Invalid resource catalogue: ${name}`);catalogues[name]=data;}
  const present=new Set(rows.map(row=>row.path)),missing=expectedPackPaths(catalogues).filter(path=>!present.has(path));if(missing.length)throw new Error(`Indexed files missing from this folder (${missing.length}): ${missing.slice(0,3).join(', ')}`);
  return catalogues;
}
export function expectedPackPaths(catalogues){
  const result=new Set(),add=path=>result.add(packPath(path));
  for(const entry of catalogues['runtime-index.json'].entries)if(entry.status==='parsed'){
    add(entry.path+'/'+entry.skeleton);for(const atlas of entry.atlases){const path=`${entry.path}/${entry.id}/${atlas.atlas}`;add(path);const directory=path.slice(0,path.lastIndexOf('/')+1);for(const page of atlas.pages)add(directory+page);}
    for(const page of entry.materialBindings?.pages||[])for(const material of Object.values(page.materials))for(const texture of Object.values(material.textures||{}))for(const resource of [texture,...(texture.mips||[])])if(resource.path)add(packPath(entry.path)+'/'+packPath(resource.path));
  }
  for(const entry of catalogues['audio-index.json'].entries)if(!entry.errors?.length)for(const clip of entry.clips||[])add(clip.path);
  for(const presentation of catalogues['presentations.json'].presentations){
    const local=resource=>{if(resource?.path)add(packPath(presentation.path)+'/'+packPath(resource.path));for(const mip of resource?.mips||[])add(packPath(presentation.path)+'/'+packPath(mip.path));};
    for(const image of presentation.images||[])if(image.assetPath)add(image.assetPath);else local(image.sprite);
    for(const effect of presentation.effects||[]){for(const sprite of effect.sprites||[])local(sprite);for(const material of effect.materials||[])for(const texture of Object.values(material.textures||{}))local(texture);}
  }
  const visit=value=>{if(Array.isArray(value))for(const item of value)visit(item);else if(value&&typeof value==='object')for(const item of Object.values(value))visit(item);else if(typeof value==='string'&&/^(spines|portraits|audio)\//.test(value)&&extensions.test(value))add(value);};
  for(const name of ['presentations.json','portrait-index.json','library.json'])visit(catalogues[name]);return [...result];
}
export function resourceType(path){const extension=path.split('.').at(-1).toLowerCase();return {json:'application/json',atlas:'text/plain',png:'image/png',webp:'image/webp',jpg:'image/jpeg',jpeg:'image/jpeg',m4a:'audio/mp4',ogg:'audio/ogg',mp3:'audio/mpeg',wav:'audio/wav',otf:'font/otf',ttf:'font/ttf'}[extension]||'application/octet-stream';}

export async function verifyPackCache(cache,files,base,onProgress=()=>{}){
  if(!Array.isArray(files)||files.length<5||files.length>100000)throw new Error('Invalid imported file manifest');
  const seen=new Set();let bytes=0;
  const rows=files.map(row=>{const path=packPath(row.path);if(seen.has(path)||!extensions.test(path)||!Number.isSafeInteger(row.size)||row.size<0)throw new Error('Invalid imported file manifest');seen.add(path);bytes+=row.size;return {path,size:row.size};});
  if(!Number.isSafeInteger(bytes)||PACK_CATALOGS.some(name=>!seen.has(name)))throw new Error('Invalid imported file manifest');
  for(let start=0;start<rows.length;start+=64){await Promise.all(rows.slice(start,start+64).map(async row=>{
    const response=await cache.match(packUrl(row.path,base));if(!response||response.status!==200||response.headers.get('content-length')!==String(row.size)||response.headers.get('content-type')!==resourceType(row.path))throw new Error('Imported file does not match: '+row.path);
    await response.body?.cancel().catch(()=>{});
  }));onProgress(Math.min(rows.length,start+64),rows.length);}
  return {files:rows.length,bytes};
}
