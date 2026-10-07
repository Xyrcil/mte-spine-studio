import {savedVoiceRow} from './voice-catalog.js';
import {objectVisible} from './background-layers.js';

export function audioResourceLookup(index,resources){
  const lookup={resources:new Map(resources.map(row=>[row.name,row])),byName:new Map()};
  for(const row of resources){const name=row.resource.split('/').at(-1);if(!lookup.resources.has(name))lookup.resources.set(name,row);}
  for(const entry of index.entries)if(!entry.errors.length)lookup.byName.set(entry.name,[...(lookup.byName.get(entry.name)||[]),entry]);
  lookup.resolve=AudioBus.prototype.resolve.bind(lookup);return lookup;
}

export class AudioBus extends EventTarget {
  constructor(index, resources, base,voiceRows=[]) {
    super();
    this.base=base;
    this.voiceRows=voiceRows;this.currentVoice=null;this.currentSubtitle=null;
    this.volume=1;this.muted=false;this.token=0;this.effects=new Set();this.effectVolume=.8;
    this.ambientVolume=.5;this.ambientEnabled=false;this.language='a_sound_voiceeff';this.paused=false;this.unlocked=false;this.ambients=new Map();this.ambientPreferences=new Map();this.sceneGroups=[];this.appearances=[];
    const lookup=audioResourceLookup(index,resources);this.resources=lookup.resources;this.byName=lookup.byName;
    this.element=new Audio();this.element.preload='none';
    this.element.addEventListener('ended',()=>{if(!this.element.ended)return;this.currentVoice=null;if(!this.externalCaption)this.setSubtitle(null);this.dispatchEvent(new CustomEvent('voice-state'));});
    this.element.addEventListener('error',()=>{if(!this.element.error||!this.currentVoice)return;this.stop({preserveCaption:true});this.dispatchEvent(new CustomEvent('audio-error',{detail:'Audio playback failed'}));});
  }
  resolve(name,category='a_sound_voiceeff',exactResource=false) {
    if(typeof name!=='string'||!name)return null;
    const basename=name.split('/').at(-1),configured=this.resources.get(name)||this.resources.get(basename);
    const actual=exactResource?basename:configured?.resource.split('/').at(-1)||basename;
    return this.byName.get(actual)?.find(entry=>entry.category===category)?.clips[0] || null;
  }
  soundInfo(name,category){
    const metadata=this.resources.get(name)||this.resources.get(name.split('/').at(-1)),path=metadata?.resource||name,configuredCategory=path.startsWith('SoundRes/')?path.split('/')[1]:path.startsWith('a_sound_')?path.split('/')[0]:null;
    const chosen=category||configuredCategory||'a_sound_ui',clip=this.resolve(name,chosen);
    const volume=Number(metadata?.volume??1);return {name,category:chosen,clip,volume:Number.isFinite(volume)?Math.max(0,Math.min(1,volume)):1,loop:metadata?.loop===true||metadata?.loop===1||metadata?.loop==='1'};
  }
  setSubtitle(detail){this.currentSubtitle=detail;this.dispatchEvent(new CustomEvent('subtitle',{detail}));}
  showSourceCaption(group,text){if(this.currentVoice)this.currentVoice.voice.subtitleHidden=true;this.externalCaption={group,text};this.setSubtitle({title:'',text});this.dispatchEvent(new CustomEvent('voice-state'));}
  hideSourceSubtitle(group){let changed=false;if(this.externalCaption?.group===group){this.externalCaption=null;this.setSubtitle(null);changed=true;}if(this.currentVoice?.group===group&&this.currentVoice.voice.sourceMainView){this.currentVoice.voice.subtitleHidden=true;this.setSubtitle(null);changed=true;}if(changed)this.dispatchEvent(new CustomEvent('voice-state'));}
  async play(voice,category='a_sound_voiceeff',{time=0,autoplay=true,group=''}={}) {
    if(!voice?.resourceName)throw new Error('No voice resource selected');
    voice={...savedVoiceRow({name:voice.resourceName,...(voice.id?{id:voice.id}:{}),...(voice.exactResource?{exactResource:true}:{})},this.voiceRows),...voice};
    const clip=this.resolve(voice.resourceName,category,voice.exactResource);
    if(!clip)throw new Error('Audio resource is unavailable for this track');
    this.stop();const token=this.token;
    this.currentVoice={voice,category,time,group,...(!autoplay?{pauseTime:time}:{})};
    this.voiceMetadataAbort=new AbortController();
    this.element.addEventListener('loadedmetadata',()=>{const position=this.currentVoice?.pauseTime??this.currentVoice?.time??0;if(token===this.token&&position>0)this.element.currentTime=Math.min(position,this.element.duration);},{once:true,signal:this.voiceMetadataAbort.signal});
    this.element.src=this.base+clip.path;this.element.volume=this.volume;this.element.muted=this.muted;
    if(autoplay){this.unlocked=true;if(!await this.startVoice(token))return;}
    if(token!==this.token)return;
    this.setSubtitle(this.externalCaption?{title:'',text:this.externalCaption.text}:voice.subtitleHidden?null:{title:voice.title,text:voice.text});this.dispatchEvent(new CustomEvent('voice-state'));
  }
  async startVoice(token){
    try{if(token===this.token&&this.currentVoice?.pauseTime!==undefined&&this.element.readyState>0)this.element.currentTime=Math.min(this.currentVoice.pauseTime,this.element.duration);await this.element.play();if(token===this.token&&!this.paused)delete this.currentVoice?.pauseTime;return token===this.token;}
    catch(error){if(token!==this.token||this.paused&&error.name==='AbortError')return false;if(error.name!=='NotAllowedError')this.stop({preserveCaption:true});throw error;}
  }
  stop({preserveCaption=false}={}) {this.token++;this.voiceMetadataAbort?.abort();this.currentVoice=null;if(!preserveCaption)this.externalCaption=null;this.element.pause();this.element.removeAttribute('src');this.element.load();this.setSubtitle(this.externalCaption?{title:'',text:this.externalCaption.text}:null);this.dispatchEvent(new CustomEvent('voice-state'));}
  async playEffect(name,category='a_sound_ui',time=0,autoplay=true,group=''){
    const info=this.soundInfo(name,category),clip=info.clip;if(!clip)throw new Error(`Sound unavailable: ${name}`);
    if(this.effects.size>=12)this.releaseEffect(this.effects.values().next().value);
    const element=new Audio(this.base+clip.path);element.volume=this.effectVolume*info.volume;element.resourceVolume=info.volume;element.muted=this.muted;this.effects.add(element);
    element.effectName=name;element.effectCategory=category;element.effectTime=time;element.effectGroup=group;element.preload='none';
    element.addEventListener('loadedmetadata',()=>{if(time>0&&this.effects.has(element))element.currentTime=Math.min(time,element.duration);},{once:true});
    element.addEventListener('ended',()=>this.releaseEffect(element),{once:true});
    element.addEventListener('error',()=>{if(!element.error||!this.effects.has(element))return;this.releaseEffect(element);this.dispatchEvent(new CustomEvent('audio-error',{detail:`Effect playback failed: ${name}`}));});
    this.dispatchEvent(new CustomEvent('effect-state'));
    if(autoplay)await this.startEffect(element);
    return element;
  }
  async startEffect(element){
    try{await element.play();return this.effects.has(element);}
    catch(error){if(!this.effects.has(element)||this.paused&&error.name==='AbortError')return false;if(error.name!=='NotAllowedError')this.releaseEffect(element);throw error;}
  }
  releaseEffect(element){if(!this.effects.delete(element))return;element.pause();element.removeAttribute('src');element.load();this.dispatchEvent(new CustomEvent('effect-state'));}
  stopEffects(){for(const element of [...this.effects])this.releaseEffect(element);}
  pause() {const voiceWasPlaying=this.currentVoice&&!this.element.paused,effectsWerePlaying=[...this.effects].some(effect=>!effect.paused);if(this.currentVoice&&(voiceWasPlaying||this.currentVoice.pauseTime===undefined)){const position=this.element.currentTime||this.currentVoice.time;this.currentVoice.pauseTime=this.currentVoice.time=position;}this.paused=true;this.element.pause();for(const effect of this.effects)effect.pause();for(const channel of this.ambients.values())channel.element.pause();if(voiceWasPlaying)this.dispatchEvent(new CustomEvent('voice-state'));if(effectsWerePlaying)this.dispatchEvent(new CustomEvent('effect-state'));}
  async resume() {this.paused=false;this.unlocked=true;const token=this.token;await Promise.all([...(this.currentVoice&&!this.element.ended?[this.startVoice(token)]:[]),...[...this.effects].map(effect=>this.startEffect(effect)),this.activateAmbients()]);if(token===this.token&&(this.currentVoice||this.externalCaption)){this.setSubtitle(this.externalCaption?{title:'',text:this.externalCaption.text}:this.currentVoice.voice.subtitleHidden?null:{title:this.currentVoice.voice.title,text:this.currentVoice.voice.text});this.dispatchEvent(new CustomEvent('voice-state'));}}
  setVolume(value) {this.volume=Math.max(0,Math.min(1,value));this.element.volume=this.volume;}
  setEffectVolume(value){this.effectVolume=Math.max(0,Math.min(1,value));for(const effect of this.effects)effect.volume=this.effectVolume*(effect.resourceVolume??1);}
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
    if(this.externalCaption?.group&&!groups.some(group=>group.id===this.externalCaption.group&&objectVisible(group,groups)))this.hideSourceSubtitle(this.externalCaption.group);
    if(this.currentVoice?.group&&!groups.some(group=>group.id===this.currentVoice.group&&objectVisible(group,groups)))this.stop({preserveCaption:true});
    for(const effect of this.effects)if(effect.effectGroup&&!groups.some(group=>group.id===effect.effectGroup&&objectVisible(group,groups)))this.releaseEffect(effect);
    const desired=new Map();
    for(const group of groups){const setting=this.ambientSetting(group);if(setting&&setting.enabled&&objectVisible(group,groups))desired.set(group.id,setting);}
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
  snapshot(){const current=this.currentVoice,voiceTrack=current&&!this.element.ended?{name:current.voice.resourceName,category:current.category,time:this.element.paused&&current.pauseTime!==undefined?current.pauseTime:this.element.currentTime||current.time,...(current.voice.id?{id:current.voice.id}:{}),...(current.voice.exactResource?{exactResource:true}:{}),...(current.voice.sourceMainView?{sourceMainView:true}:{}),...(current.voice.subtitleHidden?{subtitleHidden:true}:{}),...(current.group?{group:current.group}:{})}:null;return {schema:1,voiceVolume:this.volume,effectVolume:this.effectVolume,ambientVolume:this.ambientVolume,muted:this.muted,ambientEnabled:this.ambientEnabled,language:this.language,ambientTracks:this.ambientSnapshot(),effectTracks:[...this.effects].filter(element=>!element.ended).map(element=>({name:element.effectName,category:element.effectCategory,time:element.currentTime||element.effectTime||0,...(element.effectGroup?{group:element.effectGroup}:{})})),voiceTrack};}
  exportVoice(snapshot,objects){
    const track=snapshot?.voiceTrack;if(!track||track.group&&!objects.some(object=>object.id===track.group&&objectVisible(object,objects)))return null;
    const clip=this.resolve(track.name,track.category,track.exactResource);if(!clip)throw new Error(`Voice unavailable: ${track.name}`);
    const row=savedVoiceRow(track,this.voiceRows);return {url:this.base+clip.path,text:row.text,position:track.time,gain:snapshot.voiceVolume,scene:true,repeat:false,...(track.subtitleHidden?{subtitleHidden:true}:{})};
  }
  exportAmbients(snapshot,objects){
    if(!snapshot||snapshot.muted||!snapshot.ambientEnabled)return [];
    const visible=new Set(objects.filter(object=>objectVisible(object,objects)).map(object=>object.id));
    return snapshot.ambientTracks.filter(track=>track.enabled&&!track.ended&&visible.has(track.id)).map(track=>{
      const info=this.soundInfo(track.name,track.category);if(!info.clip)throw new Error(`Ambient sound unavailable: ${track.name}`);
      return {url:this.base+info.clip.path,position:track.time,repeat:track.loop,gain:track.gain*info.volume*snapshot.ambientVolume};
    });
  }
  restore(snapshot,groups,appearances,paused){
    this.stop();this.stopEffects();this.stopAmbients();this.ambientPreferences.clear();this.paused=paused;
    if(snapshot){this.setVolume(snapshot.voiceVolume);this.setEffectVolume(snapshot.effectVolume);this.setAmbientVolume(snapshot.ambientVolume);this.setMuted(snapshot.muted);this.ambientEnabled=snapshot.ambientEnabled;this.language=snapshot.language;for(const track of snapshot.ambientTracks)this.ambientPreferences.set(track.id,{...track});}
    this.syncAmbients(groups,appearances);
    for(const track of snapshot?.effectTracks||[])if(!track.group||groups.some(group=>group.id===track.group&&objectVisible(group,groups)))this.playEffect(track.name,track.category,track.time,this.unlocked&&!paused,track.group).catch(error=>this.dispatchEvent(new CustomEvent('audio-error',{detail:error.message})));
    const track=snapshot?.voiceTrack;if(track&&(!track.group||groups.some(group=>group.id===track.group&&objectVisible(group,groups))))this.play(savedVoiceRow(track,this.voiceRows),track.category,{time:track.time,group:track.group,autoplay:this.unlocked&&!paused}).catch(error=>this.dispatchEvent(new CustomEvent('audio-error',{detail:error.message})));
  }
  dispose(){this.stop();this.stopEffects();this.stopAmbients();}
}
