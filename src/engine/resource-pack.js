import {validCatalogue} from './cache-policy.js';
export const PACK_CATALOGS=['presentations.json','runtime-index.json','library.json','audio-index.json','portrait-index.json'];
const extensions=/\.(json|skel|atlas|png|webp|jpg|jpeg|m4a|ogg|mp3|wav)$/i;
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
  }
  for(const entry of catalogues['audio-index.json'].entries)if(!entry.errors?.length)for(const clip of entry.clips||[])add(clip.path);
  for(const presentation of catalogues['presentations.json'].presentations){
    const local=resource=>{if(resource?.path)add(packPath(presentation.path)+'/'+packPath(resource.path));};
    for(const image of presentation.images||[])local(image.sprite);
    for(const effect of presentation.effects||[]){for(const sprite of effect.sprites||[])local(sprite);for(const material of effect.materials||[])for(const texture of Object.values(material.textures||{}))local(texture);}
  }
  const visit=value=>{if(Array.isArray(value))for(const item of value)visit(item);else if(value&&typeof value==='object')for(const item of Object.values(value))visit(item);else if(typeof value==='string'&&/^(spines|portraits|audio)\//.test(value)&&extensions.test(value))add(value);};
  for(const name of ['presentations.json','portrait-index.json','library.json'])visit(catalogues[name]);return [...result];
}
export function resourceType(path){const extension=path.split('.').at(-1).toLowerCase();return {json:'application/json',atlas:'text/plain',png:'image/png',webp:'image/webp',jpg:'image/jpeg',jpeg:'image/jpeg',m4a:'audio/mp4',ogg:'audio/ogg',mp3:'audio/mpeg',wav:'audio/wav'}[extension]||'application/octet-stream';}
