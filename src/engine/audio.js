export class AudioBus extends EventTarget {
  constructor(index, resources, base) {
    super();
    this.base=base;
    this.volume=1;this.muted=false;this.token=0;this.effects=new Set();this.effectVolume=.8;
    this.resources=new Map(resources.map(row=>[row.name,row]));
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
  pause() {this.element.pause();for(const effect of this.effects)effect.pause();}
  async resume() {await Promise.all([...(this.element.currentSrc?[this.element.play()]:[]),...[...this.effects].map(effect=>effect.play())]);}
  setVolume(value) {this.volume=Math.max(0,Math.min(1,value));this.element.volume=this.volume;}
  setEffectVolume(value){this.effectVolume=Math.max(0,Math.min(1,value));for(const effect of this.effects)effect.volume=this.effectVolume;}
  setMuted(value) {this.muted=Boolean(value);this.element.muted=this.muted;for(const effect of this.effects)effect.muted=this.muted;}
}
