export class AudioBus extends EventTarget {
  constructor(index, resources, base) {
    super();
    this.base=base;
    this.volume=1;this.muted=false;this.token=0;this.effects=new Set();this.effectVolume=.8;
    this.ambientVolume=.5;this.ambientEnabled=false;this.language='a_sound_voiceeff';this.paused=false;this.unlocked=false;this.ambients=new Map();this.ambientPreferences=new Map();this.sceneGroups=[];this.appearances=[];
    this.resources=new Map(resources.map(row=>[row.name,row]));
    for(const row of resources){const name=row.resource.split('/').at(-1);if(!this.resources.has(name))this.resources.set(name,row);}
    this.byName=new Map();
    for(const entry of index.entries)if(!entry.errors.length) {
      this.byName.set(entry.name,[...(this.byName.get(entry.name)||[]),entry]);
    }
    this.element=new Audio();this.element.preload='none';
    this.element.addEventListener('ended',()=>this.dispatchEvent(new CustomEvent('subtitle',{detail:null})));
    this.element.addEventListener('error',()=>this.dispatchEvent(new CustomEvent('audio-error',{detail:'Audio playback failed'})));
  }
  resolve(name,category='a_sound_voiceeff') {
    const configured=this.resources.get(name);
    const actual=configured?.resource.split('/').at(-1)||name;
    return this.byName.get(actual)?.find(entry=>entry.category===category)?.clips[0] || null;
  }
  soundInfo(name,category){
    const metadata=this.resources.get(name),path=metadata?.resource||'',configuredCategory=path.startsWith('SoundRes/')?path.split('/')[1]:null;
    const chosen=category||configuredCategory||'a_sound_ui',clip=this.resolve(name,chosen);
    const volume=Number(metadata?.volume??1);return {name,category:chosen,clip,volume:Number.isFinite(volume)?Math.max(0,Math.min(1,volume)):1,loop:metadata?.loop===true||metadata?.loop===1||metadata?.loop==='1'};
  }
  async play(voice,category) {
    const clip=this.resolve(voice.resourceName,category);
    if(!clip)throw new Error('Audio resource is unavailable for this track');
    this.stop();const token=this.token;
    this.element.src=this.base+clip.path;this.element.volume=this.volume;this.element.muted=this.muted;
    try {
      await this.element.play();
      if(token!==this.token)return;
      this.dispatchEvent(new CustomEvent('subtitle',{detail:{title:voice.title,text:voice.text}}));
    }catch(error){if(token===this.token)throw error;}
  }
  stop() {this.token++;this.element.pause();this.element.removeAttribute('src');this.element.load();this.dispatchEvent(new CustomEvent('subtitle',{detail:null}));}
  async playEffect(name,category='a_sound_ui'){
    const clip=this.resolve(name,category);if(!clip)throw new Error(`Sound unavailable: ${name}`);
    if(this.effects.size>=12)this.releaseEffect(this.effects.values().next().value);
    const element=new Audio(this.base+clip.path);element.volume=this.effectVolume;element.muted=this.muted;this.effects.add(element);
    element.addEventListener('ended',()=>this.releaseEffect(element),{once:true});
    try{await element.play();}catch(error){this.releaseEffect(element);throw error;}
    return element;
  }
  releaseEffect(element){element.pause();element.removeAttribute('src');element.load();this.effects.delete(element);}
  stopEffects(){for(const element of [...this.effects])this.releaseEffect(element);}
  pause() {this.paused=true;this.element.pause();for(const effect of this.effects)effect.pause();for(const channel of this.ambients.values())channel.element.pause();}
  async resume() {this.paused=false;this.unlocked=true;await Promise.all([...(this.element.currentSrc&&!this.element.ended?[this.element.play()]:[]),...[...this.effects].map(effect=>effect.play()),this.activateAmbients()]);}
  setVolume(value) {this.volume=Math.max(0,Math.min(1,value));this.element.volume=this.volume;}
  setEffectVolume(value){this.effectVolume=Math.max(0,Math.min(1,value));for(const effect of this.effects)effect.volume=this.effectVolume;}
  setMuted(value) {this.muted=Boolean(value);this.element.muted=this.muted;for(const effect of this.effects)effect.muted=this.muted;for(const channel of this.ambients.values())channel.element.muted=this.muted;}
  setAmbientVolume(value){this.ambientVolume=Math.max(0,Math.min(1,value));for(const channel of this.ambients.values())channel.element.volume=this.ambientVolume*channel.gain*channel.resourceVolume;}
  async enableAmbients(enabled){this.ambientEnabled=Boolean(enabled);this.unlocked=true;if(!enabled){for(const channel of this.ambients.values())channel.element.pause();}else await this.activateAmbients();}
  ambientSetting(group){
    if(this.ambientPreferences.has(group.id))return this.ambientPreferences.get(group.id);
    const appearance=this.appearances.find(row=>group.appearanceId?row.id===group.appearanceId:group.presentation?.id&&row.bundle===group.presentation.id),name=appearance?.ambientSound;
    if(!name)return null;const info=this.soundInfo(name);return {id:group.id,name,category:info.category,loop:info.loop,gain:1,time:0,enabled:true,ended:false};
  }
  syncAmbients(groups,appearances){
    this.sceneGroups=groups;this.appearances=appearances;
    const present=new Set(groups.map(group=>group.id));
    const desired=new Map();
    for(const group of groups){const setting=this.ambientSetting(group);if(setting&&setting.enabled&&group.visible)desired.set(group.id,setting);}
    for(const [id,channel] of this.ambients)if(!desired.has(id)||desired.get(id).name!==channel.name||desired.get(id).category!==channel.category)this.releaseAmbient(id,!desired.has(id)&&present.has(id)&&this.ambientPreferences.get(id)?.enabled!==false);
    for(const id of this.ambientPreferences.keys())if(!present.has(id))this.ambientPreferences.delete(id);
    for(const [id,setting] of desired){
      let channel=this.ambients.get(id);
      if(!channel){const info=this.soundInfo(setting.name,setting.category);if(!info.clip){this.dispatchEvent(new CustomEvent('audio-error',{detail:`Ambient sound unavailable: ${setting.name}`}));continue;}
        const element=new Audio(this.base+info.clip.path);element.preload='none';channel={...setting,element,resourceVolume:info.volume};this.ambients.set(id,channel);
        channel.pendingTime=setting.time;element.addEventListener('loadedmetadata',()=>{if(this.ambients.get(id)===channel&&channel.pendingTime>0)element.currentTime=Math.min(channel.pendingTime,Math.max(0,element.duration));},{once:true});
        element.addEventListener('ended',()=>{if(this.ambients.get(id)===channel){channel.ended=true;this.dispatchEvent(new CustomEvent('ambient-state'));}});
        element.addEventListener('error',()=>{if(this.ambients.get(id)===channel)this.dispatchEvent(new CustomEvent('audio-error',{detail:`Ambient playback failed: ${setting.name}`}));});
      }
      channel.loop=setting.loop;channel.gain=setting.gain;channel.element.loop=setting.loop;channel.element.volume=this.ambientVolume*setting.gain*channel.resourceVolume;channel.element.muted=this.muted;
    }
    this.activateAmbients().catch(error=>this.dispatchEvent(new CustomEvent('audio-error',{detail:error.message})));
  }
  async activateAmbients(){
    if(!this.unlocked||!this.ambientEnabled||this.paused)return;
    await Promise.all([...this.ambients.values()].filter(channel=>!channel.ended&&channel.element.paused).map(async channel=>{try{await channel.element.play();if(this.ambients.get(channel.id)!==channel||this.paused||!this.ambientEnabled)channel.element.pause();}catch(error){if(this.ambients.get(channel.id)===channel)throw error;}}));
  }
  configureAmbient(id,setting){
    const channel=this.ambients.get(id);if(channel&&channel.name===setting.name&&channel.category===setting.category){channel.ended=setting.ended;channel.pendingTime=setting.time;if(channel.element.readyState>0)channel.element.currentTime=setting.time;}
    this.ambientPreferences.set(id,{id,...setting});this.syncAmbients(this.sceneGroups,this.appearances);
  }
  releaseAmbient(id,preserve=false){const channel=this.ambients.get(id);if(!channel)return;if(preserve)this.ambientPreferences.set(id,{id,name:channel.name,category:channel.category,loop:channel.loop,gain:channel.gain,time:channel.element.currentTime||channel.pendingTime||0,enabled:true,ended:channel.ended});this.ambients.delete(id);channel.element.pause();channel.element.removeAttribute('src');channel.element.load();}
  stopAmbients(){for(const id of [...this.ambients.keys()])this.releaseAmbient(id,true);}
  ambientSnapshot(){
    const tracks=[];for(const group of this.sceneGroups){const setting=this.ambientSetting(group);if(!setting)continue;const channel=this.ambients.get(group.id);tracks.push({...setting,time:channel?.element.currentTime||setting.time,ended:channel?.ended??setting.ended});}return tracks;
  }
  snapshot(){return {schema:1,voiceVolume:this.volume,effectVolume:this.effectVolume,ambientVolume:this.ambientVolume,muted:this.muted,ambientEnabled:this.ambientEnabled,language:this.language,ambientTracks:this.ambientSnapshot()};}
  exportAmbients(snapshot,objects){
    if(!snapshot||snapshot.muted||!snapshot.ambientEnabled)return [];
    const visible=new Set(objects.filter(object=>object.visible).map(object=>object.id));
    return snapshot.ambientTracks.filter(track=>track.enabled&&!track.ended&&visible.has(track.id)).map(track=>{
      const info=this.soundInfo(track.name,track.category);if(!info.clip)throw new Error(`Ambient sound unavailable: ${track.name}`);
      return {url:this.base+info.clip.path,position:track.time,repeat:track.loop,gain:track.gain*info.volume*snapshot.ambientVolume};
    });
  }
  restore(snapshot,groups,appearances,paused){
    this.stop();this.stopEffects();this.stopAmbients();this.ambientPreferences.clear();this.paused=paused;
    if(snapshot){this.setVolume(snapshot.voiceVolume);this.setEffectVolume(snapshot.effectVolume);this.setAmbientVolume(snapshot.ambientVolume);this.setMuted(snapshot.muted);this.ambientEnabled=snapshot.ambientEnabled;this.language=snapshot.language;for(const track of snapshot.ambientTracks)this.ambientPreferences.set(track.id,{...track});}
    this.syncAmbients(groups,appearances);
  }
  dispose(){this.stop();this.stopEffects();this.stopAmbients();}
}
