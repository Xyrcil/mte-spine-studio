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

export function mainViewVoiceBinding(library,object){
  const station=stationVoiceBinding(library,object);if(station)return {...station,modelId:station.targetId};
  const appearance=library.appearances.find(row=>object.appearanceId?row.id===object.appearanceId:row.bundle===(object.bundle||object.presentation?.id||object.id));
  if(!appearance||!/^\d+$/.test(appearance.id))return null;
  return {modelId:appearance.id,targetId:appearance.ownVoice===false?appearance.characterId:appearance.id,voiceIds:[]};
}

export function mainViewTouchVoices(library,object){
  const binding=mainViewVoiceBinding(library,object);if(!binding)return [];
  if(binding.voiceIds.length)return binding.voiceIds.map(id=>(library.mainViewVoices?.voices||[]).find(row=>row.id===id)||library.voices.find(row=>row.id===id)||{id,resourceName:'',title:`Station line ${id}`,text:''});
  const profile=library.mainViewVoices?.hotSpringProfiles?.find(row=>row.id===binding.modelId);
  if(profile){const level=object.hotSpringFavorLevel??1,names=profile.tiers.slice(0,level).flat();return names.map(name=>library.mainViewVoices.favorVoices.find(row=>row.resourceName===name)||{id:'favor:'+name,resourceName:name,title:name,text:'',exactResource:true,subtitleStatus:'missing'});}
  if(library.hotSpringRoles?.some(row=>row.skinId===binding.modelId))return [];
  return (library.mainViewVoices?.voices||[]).filter(row=>row.type===3&&row.targetId===binding.targetId);
}

export function mainViewIdleVoices(library,object){
  const binding=mainViewVoiceBinding(library,object);if(!binding)return [];
  const drawing=library.stationDrawings?.drawings.find(row=>row.id===binding.drawingId);
  const target=drawing?(drawing.peopleId||drawing.gospelId):binding.targetId;
  const names=[1,2].map(index=>`Voice_${target}_Greetings_Idel_0${index}`);
  return names.map(name=>(library.mainViewVoices?.voices||[]).find(row=>row.resourceName===name)).filter(Boolean);
}

export function voiceCatalog(library,objects=[],scope='scene',query=''){
  const targets=new Set(),hotSpringIds=new Set(),stationIds=new Set();
  for(const object of objects){const binding=stationVoiceBinding(library,object);if(binding){targets.add(binding.targetId);for(const id of binding.voiceIds)stationIds.add(id);}}
  for(const object of objects){const appearance=library.appearances.find(row=>object.appearanceId?row.id===object.appearanceId:(object.bundle||object.presentation?.id||object.id)&&row.bundle===(object.bundle||object.presentation?.id||object.id));if(appearance){targets.add(appearance.id);targets.add(appearance.characterId);}const roles=(library.hotSpringRoles||[]).filter(role=>role.id===appearance?.hotSpringRoleId||appearance?.hotSpringRoleIds?.includes(role.id));for(const role of roles){targets.add(role.skinId);targets.add(role.id);for(const pool of role.levels)if(scope!=='hot-spring'||pool.level===(object.hotSpringLevel??1))for(const id of pool.voiceIds)hotSpringIds.add(id);}}
  const mainRows=objects.flatMap(object=>scope==='main-view-idle'?mainViewIdleVoices(library,object):mainViewTouchVoices(library,object)),rows=['main-view-touch','main-view-idle'].includes(scope)?mainRows.filter((row,index)=>mainRows.findIndex(other=>other.id===row.id)===index):scope==='all'?library.voices:scope==='story'?library.storyVoices:scope==='station'?[...stationIds].map(id=>library.voices.find(row=>row.id===id)||{id,resourceName:'',title:`Station line ${id}`,text:''}):scope==='hot-spring'?[...hotSpringIds].map(id=>library.voices.find(row=>row.id===id)||{id,resourceName:'',title:`Hot spring line ${id}`,text:''}):library.voices.filter(row=>targets.has(row.targetId)||hotSpringIds.has(row.id)||stationIds.has(row.id));
  const search=query.trim().toLocaleLowerCase();
  return rows.map(row=>{const title=row.title||row.resourceName||`Story line ${row.id}`;return {...row,kind:scope==='story'?'story':'character',title,label:scope==='all'?`${row.targetId||'Unassigned'} · ${title} · ${row.resourceName||row.id}`:title,key:`${scope==='story'?'story':'character'}:${row.id}:${row.resourceName}`};}).filter(row=>!search||`${row.title} ${row.text} ${row.id} ${row.targetId||''} ${row.resourceName}`.toLocaleLowerCase().includes(search));
}

export function savedVoiceRow(track,rows){
  const name=track.name.split('/').at(-1),matches=rows.filter(row=>!track.id||row.id===track.id),row=track.exactResource?matches.find(row=>row.exactResource&&row.resourceName===name)||matches.find(row=>row.resourceName===name):matches.find(row=>[row.resourceName,row.alias,row.resourcePath].some(value=>value?.split('/').at(-1)===name));
  return {resourceName:track.name,title:row?.title||track.name,text:row?.text||'',...(track.exactResource?{exactResource:true}:{}),...(track.id?{id:track.id}:row?.id?{id:row.id}:{})};
}
