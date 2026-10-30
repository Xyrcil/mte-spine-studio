import {voiceAppearance,mainViewEntryVoice} from './engine/voice-catalog.js';
import {prepareAppearancePlayback} from './engine/appearance-playback.js';

export const defaultSpeechPreferences=Object.freeze({entry:true,touch:true,idle:true,entrance:true,entranceUnlocked:true,birthday:false});
export function speechPreferences(value){return Object.fromEntries(Object.entries(defaultSpeechPreferences).map(([key,fallback])=>[key,typeof value?.[key]==='boolean'?value[key]:fallback]));}

export function galleryEntryVoice(library,group){
  return mainViewEntryVoice(library,{appearanceId:group.appearanceId??group.presentation?.appearanceId,bundle:group.presentation?.id});
}

export class GallerySpeech {
  constructor({stage,library,audio,getView,onBlocked=()=>{},onReady=()=>{},onError=()=>{},preferences=defaultSpeechPreferences}){
    Object.assign(this,{stage,library,audio,getView,onBlocked,onReady,onError});this.preferences=speechPreferences(preferences);this.groupId='';this.blocked=false;
  }
  eligible(group){
    if(!group?.visible)return false;
    const object={appearanceId:group.appearanceId??group.presentation?.appearanceId,bundle:group.presentation?.id},appearance=voiceAppearance(this.library,object);
    return Boolean(appearance&&(['painting','skin','portrait'].includes(appearance.kind)||appearance.stationDrawingId)&&this.stage.mainViewSpeech.binding(group));
  }
  current(){return this.stage.groups.find(group=>group.id===this.groupId&&group.visible);}
  sync(){
    this.stage.suspendMainViewSpeech=this.getView()!=='gallery'||this.blocked;
    if(!this.current()||this.stage.mainViewSpeech.value.group!==this.groupId||this.stage.sequenceBusy||this.stage.sequencePlayer)return;
    this.stage.mainViewSpeech.value.language=this.audio.language;
    if(this.getView()!=='gallery')return;
    if(!this.preferences.idle||this.blocked)this.stage.mainViewSpeechClock.hide();
    else if(!this.stage.mainViewSpeechClock.value.visible){this.stage.mainViewSpeechClock.show();if(!this.stage.mainViewSpeechClock.active)this.stage.mainViewSpeechClock.finish();}
  }
  enter(group,{entry=true,animations=true}={}){
    if(animations&&this.getView()==='gallery')prepareAppearancePlayback(this.library,group,{entrance:this.preferences.entrance,unlocked:this.preferences.entranceUnlocked});
    this.groupId=this.eligible(group)?group.id:'';this.blocked=false;if(!this.groupId)return;
    this.stage.triggerMainViewSpeech(group.id,'start',{language:this.audio.language});this.sync();
    if(!entry||!this.preferences.entry||this.getView()!=='gallery'||this.stage.paused||this.stage.hostPaused)return;
    return this.stage.triggerMainViewSpeech(group.id,this.preferences.birthday?'birthday':'entry',{language:this.audio.language});
  }
  playbackBlocked(){this.blocked=true;this.sync();this.onBlocked();}
  playbackReady(group,name){
    if(this.current()?.id!==group||this.audio.currentVoice?.group!==group||this.audio.currentVoice.voice.resourceName!==name)return false;
    this.blocked=false;this.sync();this.onReady();return true;
  }
  interactAt(x,y){
    const result=this.stage.interact(x,y);
    if(result.reason==='No interaction region here')return this.touchAt(x,y)||result;
    if(result.accepted&&result.hit==='station-touch'){
      const group=this.stage.groups.find(group=>group.id===result.group);
      if(group?.presentation?.stationDrawing)this.touch(group);
    }
    return result;
  }
  touch(group){
    if(!this.preferences.touch||this.getView()!=='gallery'||!this.eligible(group)||!this.stage.mainViewSpeech.touchAllowed(group))return null;
    this.groupId=group.id;
    const result=this.stage.triggerMainViewSpeech(group.id,'touch',{language:this.audio.language});this.sync();return result;
  }
  touchAt(x,y){
    if(!this.preferences.touch||this.getView()!=='gallery')return null;
    return this.touch(this.stage.hitTest(x,y));
  }
  async unlock(){
    await this.audio.resume();this.blocked=false;this.sync();
    const track=this.audio.currentVoice,clip=track&&this.audio.resolve(track.voice.resourceName,track.category,track.voice.exactResource);
    if(clip&&Number.isFinite(clip.duration))this.stage.mainViewSpeechClock.soundStarted(Math.max(0,clip.duration-(track.time||0)));
  }
  setPreference(key,value){if(!(key in defaultSpeechPreferences)||typeof value!=='boolean')throw new Error('Invalid automatic voice preference');this.preferences={...this.preferences,[key]:value};this.sync();}
}
