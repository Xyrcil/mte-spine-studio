import {resolveInteractionVoice,explicitInteractionEffect} from './interaction-audio.js';

export function interactionExportProvider(library,audio,scene,{includeAudio=true,includeSubtitles=true}={}){
  const language=scene.audio?.language||'a_sound_voiceeff';
  return request=>{
    const effect=explicitInteractionEffect(request,audio);
    const voice=includeAudio||includeSubtitles?resolveInteractionVoice(request,library,audio,language):null;
    const clip=voice&&audio.resolve(voice.resourceName,language);
    return {effect:effect?{name:effect.name,category:effect.category}:null,voice:clip?{url:audio.base+clip.path,text:voice.text||'',includeAudio,includeSubtitles}:null};
  };
}
