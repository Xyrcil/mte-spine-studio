const CATALOGS=new Set(['runtime-index.json','presentations.json','library.json','audio-index.json','portrait-index.json']);
export function validCatalogue(data,name){const fields=name==='library.json'?['characters','appearances','voices','storyVoices','soundResources']:name==='presentations.json'?['presentations']:['entries'];return data?.schema===1&&fields.every(field=>Array.isArray(data[field]));}
export function cacheKind(value,scope){
  const url=new URL(value,scope),base=new URL(scope);if(url.origin!==base.origin||url.username||url.password||url.search||url.hash||!url.pathname.startsWith(base.pathname))return null;
  const path=url.pathname.slice(base.pathname.length);
  if(['','index.html','app-shell.json','vendor/spine-webgl.js','vendor/SPINE-LICENSE'].includes(path)||/^assets\/[^/]+\.(js|css)$/.test(path))return 'shell';
  if(!path.startsWith('assets/'))return null;
  if(CATALOGS.has(path.slice(7)))return 'catalog';
  return /\.(skel|atlas|json|png|webp|jpg|jpeg|m4a|ogg|mp3|wav)$/i.test(path)?'asset':null;
}
export function rangeBounds(value,length){
  if(!value)return undefined;if(!value.startsWith('bytes=')||value.includes(','))return undefined;
  const match=/^bytes=(\d*)-(\d*)$/.exec(value);if(!match||!length||!match[1]&&!match[2])return null;
  let start,end;
  if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return null;start=Math.max(0,length-suffix);end=length-1;}
  else{start=Number(match[1]);end=match[2]?Number(match[2]):length-1;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=length||end<start)return null;end=Math.min(end,length-1);}
  return {start,end};
}
export function evictionCandidates(entries,budget,additional=0,protectedUrl=''){
  let total=entries.reduce((sum,row)=>sum+row.size,0)+additional;const remove=[];
  for(const row of entries.filter(row=>row.kind!=='catalog'&&row.url!==protectedUrl).sort((a,b)=>a.used-b.used)){if(total<=budget)break;remove.push(row.url);total-=row.size;}
  return {remove,total};
}
export function sceneCacheUrls(groups,base,audio,includeVoices=[],language='a_sound_voiceeff'){
  const urls=new Set(),add=path=>{if(path&&!path.startsWith('data:'))urls.add(new URL(path,base).href);};
  for(const group of groups){if(group.asset)add('assets/'+group.asset);for(const layer of group.layers||[]){add(layer.source);add(layer.atlas);const atlas=new URL(layer.atlas,base).href,directory=atlas.slice(0,atlas.lastIndexOf('/')+1);for(const page of layer.entry.atlases[0].pages)add(new URL(page,directory).href);}for(const effect of group.effects||[])for(const url of effect.textures)add(url);for(const image of group.nativeImages||[])if(image.used&&!image.reason)add(image.texture);}
  if(audio){const snapshot=audio.snapshot(),tracks=[...(snapshot.voiceTrack?[snapshot.voiceTrack]:[]),...snapshot.effectTracks,...snapshot.ambientTracks.filter(track=>track.enabled)];for(const track of tracks){const clip=audio.resolve(track.name,track.category);if(clip)add('assets/'+clip.path);}for(const voice of includeVoices){const clip=audio.resolve(voice.resourceName,language);if(clip)add('assets/'+clip.path);}}
  return [...urls];
}
