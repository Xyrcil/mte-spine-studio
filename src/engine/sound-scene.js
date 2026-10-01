export function validateSoundScene(value,objects){
  if(!value||value.schema!==1)throw new Error('Unsupported sound scene');
  const volume=(value,label)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)throw new Error(`Invalid ${label}`);return value;};
  for(const key of ['muted','ambientEnabled'])if(typeof value[key]!=='boolean')throw new Error(`Invalid ${key}`);
  if(!['a_sound_voiceeff','a_sound_voiceeff_ch'].includes(value.language))throw new Error('Invalid voice language');
  if(!Array.isArray(value.ambientTracks)||value.ambientTracks.length>200)throw new Error('Invalid ambient tracks');
  const ids=new Set(),objectIds=new Set(objects.map(object=>object.id));
  const ambientTracks=value.ambientTracks.map(track=>{
    if(typeof track.id!=='string'||ids.has(track.id)||!objectIds.has(track.id))throw new Error('Invalid ambient object');ids.add(track.id);
    if(typeof track.name!=='string'||track.name.length>512||(track.enabled&&!track.name))throw new Error('Invalid ambient resource');
    if(!['a_sound_ui','a_sound_bgm','a_sound_fighteff'].includes(track.category))throw new Error('Invalid ambient category');
    for(const key of ['enabled','loop','ended'])if(typeof track[key]!=='boolean')throw new Error(`Invalid ambient ${key}`);
    if(typeof track.time!=='number'||!Number.isFinite(track.time)||track.time<0)throw new Error('Invalid ambient time');
    return {id:track.id,name:track.name,category:track.category,loop:track.loop,gain:volume(track.gain,'ambient gain'),time:track.time,enabled:track.enabled,ended:track.ended};
  });
  return {schema:1,voiceVolume:volume(value.voiceVolume,'voice volume'),effectVolume:volume(value.effectVolume,'effect volume'),ambientVolume:volume(value.ambientVolume,'ambient volume'),muted:value.muted,ambientEnabled:value.ambientEnabled,language:value.language,ambientTracks};
}
