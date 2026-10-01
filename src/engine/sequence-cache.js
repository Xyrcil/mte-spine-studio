import {validateSequence} from './interaction-sequence.js';
import {sceneCacheUrls} from './cache-policy.js';
import {resolveInteractionVoice,explicitInteractionEffect} from './interaction-audio.js';

export function capturedSoundUrls(snapshot,audio,base,warnings=new Set()){
  if(!snapshot||!audio)return [];
  const urls=new Set(),tracks=[...(snapshot.voiceTrack?[snapshot.voiceTrack]:[]),...(snapshot.effectTracks||[]),...(snapshot.ambientTracks||[]).filter(track=>track.enabled)];
  for(const track of tracks){const clip=audio.resolve(track.name,track.category);if(clip)urls.add(new URL('assets/'+clip.path,base).href);else warnings.add(`Recorded sound unavailable: ${track.name}`);}
  return [...urls];
}

export async function sequenceCacheResources(value,{catalog,entries,imageAssets,audio,library,base,sourceAspect=1,signal,onProgress=()=>{}}){
  const sequence=validateSequence(value),urls=new Set(),warnings=new Set();let callbackError;
  const {RenderSession}=await import('./export.js'),{exportPlan}=await import('./export-plan.js');
  const plan=exportPlan({useSequence:true,format:'png',width:32,height:32,scale:1,fps:1,speed:1,start:0,end:Math.max(.001,sequence.duration),loops:1,loopMode:'repeat',fit:'contain',background:sequence.initial.background,crop:{x:0,y:0,width:1,height:1}});
  const session=new RenderSession({...sequence.initial,sequence},catalog,entries,imageAssets,sourceAspect,plan,signal);
  const addSound=(name,category)=>{if(!audio)return;const info=audio.soundInfo(name,category);if(info.clip)urls.add(new URL('assets/'+info.clip.path,base).href);else warnings.add(`Sound unavailable: ${name}`);};
  const sound=event=>{try{addSound(event.detail.name,event.detail.category);}catch(error){callbackError=error;}};
  const voice=event=>{try{
    if(!audio||!library)return;
    const effect=explicitInteractionEffect(event.detail,audio);if(effect)addSound(effect.name,effect.category);
    const languages=sequence.initial.audio?.language?[sequence.initial.audio.language]:[...new Set([audio.language,'a_sound_voiceeff'])];
    for(const language of languages){const row=resolveInteractionVoice(event.detail,library,audio,language),clip=row&&audio.resolve(row.resourceName,language);if(clip)urls.add(new URL('assets/'+clip.path,base).href);}
  }catch(error){callbackError=error;}};
  session.stage.addEventListener('sound-request',sound);session.stage.addEventListener('voice-request',voice);
  try{
    onProgress(0,sequence.duration);await session.initialize();
    for(const url of sceneCacheUrls(session.stage.groups,base))urls.add(url);
    for(const url of capturedSoundUrls(sequence.initial.audio,audio,base,warnings))urls.add(url);
    if(audio&&library)for(const object of sequence.initial.objects){const appearance=library.appearances.find(row=>object.appearanceId?row.id===object.appearanceId:row.bundle===object.bundle);if(appearance?.ambientSound){const info=audio.soundInfo(appearance.ambientSound);if(info.clip)urls.add(new URL('assets/'+info.clip.path,base).href);}}
    await session.seek(sequence.duration,at=>{if(callbackError)throw callbackError;onProgress(at,sequence.duration);});if(callbackError)throw callbackError;
    return {urls:[...urls],warnings:[...warnings]};
  }finally{session.stage.removeEventListener('sound-request',sound);session.stage.removeEventListener('voice-request',voice);session.dispose();}
}
