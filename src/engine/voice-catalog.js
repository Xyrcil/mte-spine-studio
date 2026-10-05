export function hotSpringRole(library,object){
  const appearance=library.appearances.find(row=>object.appearanceId?row.id===object.appearanceId:(object.bundle||object.presentation?.id||object.id)&&row.bundle===(object.bundle||object.presentation?.id||object.id));
  return (library.hotSpringRoles||[]).find(role=>role.id===appearance?.hotSpringRoleId);
}

export function stationVoiceBinding(library,object){
  const appearance=library.appearances.find(row=>object.appearanceId?row.id===object.appearanceId:row.bundle===(object.bundle||object.presentation?.id||object.id));
  const drawing=library.stationDrawings?.drawings.find(row=>row.id===appearance?.stationDrawingId);
  if(!drawing)return null;
  const skin=drawing.skinId&&library.appearances.find(row=>row.id===drawing.skinId);
  return {drawingId:drawing.id,targetId:drawing.skinId?(skin?.ownVoice===false?skin.characterId:drawing.skinId):drawing.gospelId||drawing.peopleId,voiceIds:[...drawing.voiceIds]};
}

export function voiceCatalog(library,objects=[],scope='scene',query=''){
  const targets=new Set(),hotSpringIds=new Set(),stationIds=new Set();
  for(const object of objects){const binding=stationVoiceBinding(library,object);if(binding){targets.add(binding.targetId);for(const id of binding.voiceIds)stationIds.add(id);}}
  for(const object of objects){const appearance=library.appearances.find(row=>object.appearanceId?row.id===object.appearanceId:(object.bundle||object.presentation?.id||object.id)&&row.bundle===(object.bundle||object.presentation?.id||object.id));if(appearance){targets.add(appearance.id);targets.add(appearance.characterId);}const roles=(library.hotSpringRoles||[]).filter(role=>role.id===appearance?.hotSpringRoleId||appearance?.hotSpringRoleIds?.includes(role.id));for(const role of roles){targets.add(role.skinId);targets.add(role.id);for(const pool of role.levels)if(scope!=='hot-spring'||pool.level===(object.hotSpringLevel??1))for(const id of pool.voiceIds)hotSpringIds.add(id);}}
  const rows=scope==='all'?library.voices:scope==='story'?library.storyVoices:scope==='station'?[...stationIds].map(id=>library.voices.find(row=>row.id===id)||{id,resourceName:'',title:`Station line ${id}`,text:''}):scope==='hot-spring'?[...hotSpringIds].map(id=>library.voices.find(row=>row.id===id)||{id,resourceName:'',title:`Hot spring line ${id}`,text:''}):library.voices.filter(row=>targets.has(row.targetId)||hotSpringIds.has(row.id)||stationIds.has(row.id));
  const search=query.trim().toLocaleLowerCase();
  return rows.map(row=>{const title=row.title||row.resourceName||`Story line ${row.id}`;return {...row,kind:scope==='story'?'story':'character',title,label:scope==='all'?`${row.targetId||'Unassigned'} · ${title} · ${row.resourceName||row.id}`:title,key:`${scope==='story'?'story':'character'}:${row.id}:${row.resourceName}`};}).filter(row=>!search||`${row.title} ${row.text} ${row.id} ${row.targetId||''} ${row.resourceName}`.toLocaleLowerCase().includes(search));
}

export function savedVoiceRow(track,rows){
  const name=track.name.split('/').at(-1),row=rows.find(row=>(!track.id||row.id===track.id)&&[row.resourceName,row.alias,row.resourcePath].some(value=>value?.split('/').at(-1)===name));
  return {resourceName:track.name,title:row?.title||track.name,text:row?.text||'',...(track.id?{id:track.id}:row?.id?{id:row.id}:{})};
}
