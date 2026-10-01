export function hotSpringRole(library,object){
  const appearance=library.appearances.find(row=>object.appearanceId?row.id===object.appearanceId:(object.bundle||object.presentation?.id||object.id)&&row.bundle===(object.bundle||object.presentation?.id||object.id));
  return (library.hotSpringRoles||[]).find(role=>role.id===appearance?.hotSpringRoleId);
}

export function voiceCatalog(library,objects=[],scope='scene',query=''){
  const targets=new Set(),hotSpringIds=new Set();
  for(const object of objects){const appearance=library.appearances.find(row=>object.appearanceId?row.id===object.appearanceId:(object.bundle||object.presentation?.id||object.id)&&row.bundle===(object.bundle||object.presentation?.id||object.id));if(appearance){targets.add(appearance.id);targets.add(appearance.characterId);}const role=hotSpringRole(library,object);if(role){targets.add(role.skinId);targets.add(role.id);for(const pool of role.levels)if(scope!=='hot-spring'||pool.level===(object.hotSpringLevel??1))for(const id of pool.voiceIds)hotSpringIds.add(id);}}
  const rows=scope==='story'?library.storyVoices:scope==='hot-spring'?[...hotSpringIds].map(id=>library.voices.find(row=>row.id===id)||{id,resourceName:'',title:`Hot spring line ${id}`,text:''}):library.voices.filter(row=>targets.has(row.targetId)||hotSpringIds.has(row.id));
  const search=query.trim().toLocaleLowerCase();
  return rows.map(row=>({...row,kind:scope==='story'?'story':'character',title:row.title||row.resourceName||`Story line ${row.id}`,key:`${scope==='story'?'story':'character'}:${row.id}:${row.resourceName}`})).filter(row=>!search||`${row.title} ${row.text} ${row.id} ${row.resourceName}`.toLocaleLowerCase().includes(search));
}

export function savedVoiceRow(track,rows){
  const name=track.name.split('/').at(-1),row=rows.find(row=>(!track.id||row.id===track.id)&&[row.resourceName,row.alias,row.resourcePath].some(value=>value?.split('/').at(-1)===name));
  return {resourceName:track.name,title:row?.title||track.name,text:row?.text||'',...(track.id?{id:track.id}:row?.id?{id:row.id}:{})};
}
