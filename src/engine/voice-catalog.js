export function voiceCatalog(library,objects=[],scope='scene',query=''){
  const targets=new Set();
  for(const object of objects){const appearance=library.appearances.find(row=>object.appearanceId?row.id===object.appearanceId:(object.bundle||object.id)&&row.bundle===(object.bundle||object.id));if(appearance){targets.add(appearance.id);targets.add(appearance.characterId);}}
  const rows=scope==='story'?library.storyVoices:library.voices.filter(row=>targets.has(row.targetId));
  const search=query.trim().toLocaleLowerCase();
  return rows.map(row=>({...row,kind:scope==='story'?'story':'character',title:row.title||row.resourceName||`Story line ${row.id}`,key:`${scope==='story'?'story':'character'}:${row.id}:${row.resourceName}`})).filter(row=>!search||`${row.title} ${row.text} ${row.id} ${row.resourceName}`.toLocaleLowerCase().includes(search));
}
