import {mainViewVoiceBinding,mainViewTouchVoices,mainViewEntryVoice} from './voice-catalog.js';
import {audioResourceLookup} from './audio.js';

const languages=['a_sound_voiceeff','a_sound_voiceeff_ch'];
const usableClip=clip=>clip&&Number.isFinite(clip.duration)&&clip.duration>=0&&clip.duration<=86400;
export function chineseCaptionPolicy(library,name,language){
  if(language!=='a_sound_voiceeff_ch')return null;
  const token=name.split('/').at(-1).split('_'),player=token[0]==='Voice'&&/^[+-]?\d+$/.test(token[1]||'')?Number(token[1]):NaN,policy=library.mainViewVoices?.chineseCaptions;
  return Number.isInteger(player)&&player>=-2147483648&&player<=2147483647&&policy?.players.includes(player)&&Number.isFinite(policy.duration)&&policy.duration>=0&&policy.duration<=86400?{player,duration:policy.duration}:null;
}
export function validateMainViewSpeech(value){
  if(value?.schema!==1||typeof value.group!=='string'||value.group.length>512||!languages.includes(value.language)||typeof value.localized!=='boolean'||typeof value.wordsVisible!=='boolean'||!Number.isInteger(value.random)||value.random<1||value.random>4294967295)throw new Error('Invalid main-view speech state');
  const caption=value.captionOnly;if(caption!==undefined&&(typeof caption?.name!=='string'||!caption.name||caption.name.length>512||!Number.isFinite(caption.duration)||caption.duration<0||caption.duration>86400))throw new Error('Invalid source caption-only state');
  return {schema:1,group:value.group,language:value.language,localized:value.localized,wordsVisible:value.wordsVisible,random:value.random,...(caption?{captionOnly:{name:caption.name,duration:caption.duration}}:{})};
}

export class MainViewSpeech {
  constructor(stage){this.stage=stage;this.reset();}
  reset(){this.value={schema:1,group:'',language:'a_sound_voiceeff',localized:false,wordsVisible:false,random:0x12345678};}
  configure(library,audio){this.library=library;this.audio=audio;}
  object(group){return {appearanceId:group.appearanceId??group.presentation?.appearanceId,bundle:group.presentation?.id,hotSpringFavorLevel:group.hotSpringFavorLevel};}
  binding(group){return group&&this.library&&mainViewVoiceBinding(this.library,this.object(group));}
  touchAllowed(group){
    const binding=this.binding(group);if(!binding)return false;
    if(group.kind!=='spine'||binding.drawingId)return true;
    const rules=this.library.mainViewVoices?.touchRules;if(!rules)return false;
    return !(rules.find(row=>row.id===binding.modelId)?.spineTouch>0);
  }
  pool(group){
    const binding=this.binding(group);if(!binding)return [];
    const source=this.library.mainViewVoices,rows=[...(source?.voices||[]),...(source?.stationVoices||[])];
    const allowed=row=>row&&row.type!==0&&(!this.value.localized||!row.resourceName.toLowerCase().includes('chest'));
    const station=binding.voiceIds.map(id=>rows.find(row=>row.id===id)).filter(allowed);if(station.length)return station;
    const fallback=mainViewTouchVoices(this.library,this.object(group),{explicitStationPool:false});
    return source?.hotSpringProfiles?.some(row=>row.id===binding.modelId)?fallback:fallback.filter(allowed);
  }
  choose(count){let random=this.value.random;random^=random<<13;random^=random>>>17;random^=random<<5;this.value.random=random>>>0;return Math.floor(this.value.random/4294967296*count);}
  emit(name,detail){this.stage.dispatchEvent(new CustomEvent(name,{detail}));}
  request(group,row,lateness=0){
    const resourceName=row.resourceName,policy=chineseCaptionPolicy(this.library,resourceName,this.value.language);
    if(policy){
      const started=this.stage.mainViewSpeechClock.shieldStarted(policy.player,resourceName,policy.duration);
      if(started){this.value.wordsVisible=true;this.value.captionOnly={name:resourceName,duration:policy.duration};this.emitCaption(lateness);}
      return {accepted:true,animation:resourceName};
    }
    const clip=this.audio?.resolve(resourceName,this.value.language,true);
    if(!usableClip(clip)){this.emit('speech-unavailable',{group:group.id,resourceName,language:this.value.language});return {accepted:false,resourceName,reason:'Source speech or its timing metadata is unavailable for this language'};}
    delete this.value.captionOnly;this.value.wordsVisible=true;this.stage.mainViewSpeechClock.soundStarted(clip.duration);
    this.emit('voice-request',{group:group.id,...(row.id?{sourceVoiceId:row.id}:{sourceResource:resourceName}),sourceCaption:true,language:this.value.language,lateness});
    return {accepted:true,animation:resourceName};
  }
  command(groupId,operation,{language=this.value.language,localized=this.value.localized}={}){
    if(!languages.includes(language)||typeof localized!=='boolean')throw new Error('Invalid source speech preferences');
    const group=this.stage.groups.find(row=>row.id===groupId&&row.visible);
    if(!group||!this.binding(group))return {accepted:false,reason:'Source main-view binding is unavailable'};
    const clock=this.stage.mainViewSpeechClock;
    if(operation==='stop'){
      if(this.value.group!==groupId)return {accepted:false,reason:'This object is not the main-view speaker'};
      clock.hide();clock.stopWords();clock.clearShields();this.emit('voice-stop-request',{group:groupId});this.value.group='';return {accepted:true,animation:''};
    }
    if(!['start','touch','entry','birthday'].includes(operation))return {accepted:false,reason:'Unknown source speech command'};
    if(operation==='touch'&&!this.touchAllowed(group))return {accepted:false,reason:'The original main-view touch button is disabled or its rules are unavailable'};
    if(operation==='touch'&&!clock.value.canClick)return {accepted:false,reason:'Source speech is still playing'};
    if(this.value.group!==groupId){const old=this.value.group;clock.hide();clock.stopWords();clock.clearShields();if(old)this.emit('voice-stop-request',{group:old});this.value.group=groupId;clock.show();clock.finish();}
    else if(!clock.value.visible){clock.show();clock.finish();}
    this.value.language=language;this.value.localized=localized;
    if(operation==='start'){if(!clock.active)clock.finish();return {accepted:true,animation:''};}
    if(operation==='entry'||operation==='birthday')return this.request(group,{...mainViewEntryVoice(this.library,this.object(group),{birthday:operation==='birthday'}),id:undefined});
    const pool=this.pool(group);if(!pool.length)return {accepted:false,reason:'The original touch pool has no unlocked lines'};
    const row=pool[this.choose(pool.length)],clip=this.audio?.resolve(row.resourceName,language,true);
    if(!usableClip(clip)&&!chineseCaptionPolicy(this.library,row.resourceName,language))return this.request(group,row);
    clock.requestClick();return this.request(group,row);
  }
  idle(index,lateness=0){
    const group=this.stage.groups.find(row=>row.id===this.value.group&&row.visible),binding=group&&this.binding(group);if(!binding)return;
    const drawing=this.library.stationDrawings?.drawings.find(row=>row.id===binding.drawingId),target=drawing?(drawing.peopleId||drawing.gospelId):binding.targetId;
    this.request(group,{resourceName:`Voice_${target}_Greetings_Idel_0${index}`},lateness);
  }
  hideWords(lateness=0){if(!this.value.wordsVisible)return;this.value.wordsVisible=false;this.emit('voice-caption-hide-request',{group:this.value.group,lateness});}
  emitCaption(lateness=0){const caption=this.value.captionOnly;if(caption&&this.value.wordsVisible)this.emit('source-caption-request',{group:this.value.group,name:caption.name,duration:caption.duration,text:this.library.mainViewVoices?.captions?.[caption.name]||'',lateness});}
  detach(groupId){if(this.value.group!==groupId)return;this.stage.mainViewSpeechClock.hide();this.stage.mainViewSpeechClock.stopWords();this.stage.mainViewSpeechClock.clearShields();this.emit('voice-stop-request',{group:groupId});this.value.group='';}
  advance(){if(this.value.group&&!this.stage.groups.some(row=>row.id===this.value.group&&row.visible))this.stage.mainViewSpeechClock.hide();}
  snapshot(){return {...this.value,...(this.value.captionOnly?{captionOnly:{...this.value.captionOnly}}:{})};}
  restore(value){this.value=validateMainViewSpeech(value);}
}

export async function ensureMainViewSpeech(stage,signal){
  if(stage.mainViewSpeech.library)return;
  const base=import.meta.env.BASE_URL;
  const [library,index]=await Promise.all(['library.json','audio-index.json'].map(async name=>{const response=await fetch(`${base}assets/${name}`,{signal});if(!response.ok)throw new Error(`Source speech catalogue unavailable (${response.status})`);return response.json();}));
  if(!library.mainViewVoices?.touchRules||!library.mainViewVoices?.captions)throw new Error('Source speech metadata is unavailable; import an updated resource pack');
  for(const drawing of library.stationDrawings?.drawings||[])if(!library.appearances.some(row=>row.stationDrawingId===drawing.id))library.appearances.push({id:`station-${drawing.id}`,stationDrawingId:drawing.id,bundle:`Spines/drawing/station/${drawing.id}`});
  stage.mainViewSpeech.configure(library,audioResourceLookup(index,library.soundResources||[]));
}
