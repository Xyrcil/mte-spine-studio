export class AudioBus extends EventTarget {
  constructor(index, resources, base) {
    super();
    this.base=base;
    this.volume=1;this.muted=false;this.token=0;
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
  pause() {this.element.pause();}
  async resume() {if(this.element.currentSrc)await this.element.play();}
  setVolume(value) {this.volume=Math.max(0,Math.min(1,value));this.element.volume=this.volume;}
  setMuted(value) {this.muted=Boolean(value);this.element.muted=this.muted;}
}
