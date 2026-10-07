import {resolveInteractionVoice,explicitInteractionEffect} from './interaction-audio.js';

export function interactionExportProvider(library,audio,scene,{includeAudio=true,includeSubtitles=true}={}){
  const language=scene.audio?.language||'a_sound_voiceeff';
  return request=>{
    const warnings=[];
    const effect=explicitInteractionEffect(request,audio);
    const requestedLanguage=request.language||language;
    const voice=includeAudio||includeSubtitles?resolveInteractionVoice(request,library,audio,requestedLanguage,{onUnavailable:warning=>warnings.push(warning)}):null;
    const clip=voice&&audio.resolve(voice.resourceName,requestedLanguage,voice.exactResource);
    return {effect:effect?{name:effect.name,category:effect.category}:null,voice:clip?{url:audio.base+clip.path,text:voice.text||'',includeAudio,includeSubtitles}:null,warnings};
  };
}
