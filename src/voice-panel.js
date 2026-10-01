import {voiceCatalog} from './engine/voice-catalog.js';

export function createVoicePanel(presentation,library,audio,editor,message){
  document.querySelector('#voice-panel')?.remove();if(!audio)return;
  const panel=document.createElement('section');panel.id='voice-panel';
  panel.innerHTML=`<h2 id="voice-count">Voices</h2><label>Voice library<select id="voice-scope"><option value="scene">Selected character / skin</option><option value="story">All story voices</option></select></label><label>Search voices<input id="voice-search" type="search" placeholder="Subtitle, resource or ID"></label><label>Voice track<select id="voice-language" aria-label="Voice track"><option value="a_sound_voiceeff">Original track</option><option value="a_sound_voiceeff_ch">Chinese track</option></select></label><label>Voice<select id="voice-list" aria-label="Voice"></select></label><p id="voice-availability"></p><div class="actions"><button id="play-voice">Play voice</button><button id="stop-voice">Stop voice</button></div><label>Voice volume<input id="voice-volume" aria-label="Voice volume" type="range" min="0" max="1" step=".05"></label><label>Effect volume<input id="effect-volume" type="range" min="0" max="1" step=".05"></label><p id="subtitle" aria-live="polite"></p><p>Story lines are listed by source resource. Chapter and artwork associations are not inferred.</p>`;
  document.querySelector('.inspector').append(panel);
  const field=id=>panel.querySelector(`#${id}`),language=field('voice-language'),list=field('voice-list');let rows=[];
  language.value=audio.language;field('voice-volume').value=audio.volume;field('effect-volume').value=audio.effectVolume;
  function selection(){return rows.find(row=>row.id===list.value);}
  function status(){const row=selection(),clip=row&&audio.resolve(row.resourceName,language.value);field('play-voice').disabled=!clip;field('voice-availability').textContent=row?clip?'Available':row.resourceName?'Audio absent for this language':'No audio resource configured':'No matching voices';}
  function refresh(){const previous=list.value;rows=voiceCatalog(library,[presentation],field('voice-scope').value,field('voice-search').value);list.replaceChildren();
    for(const row of rows){const option=new Option(`${row.title}${audio.resolve(row.resourceName,language.value)?'':' · Missing track'}`,row.id);list.append(option);}
    if(rows.some(row=>row.id===previous))list.value=previous;else{const first=rows.find(row=>audio.resolve(row.resourceName,language.value));if(first)list.value=first.id;}
    field('voice-count').textContent=`Voices (${rows.length})`;status();
  }
  field('voice-scope').onchange=refresh;field('voice-search').oninput=refresh;list.onchange=status;
  language.onchange=()=>{editor.mutate(()=>audio.language=language.value);refresh();};
  field('play-voice').onclick=async()=>{try{await audio.play(selection(),language.value);}catch(error){message(error.message);}};
  field('stop-voice').onclick=()=>audio.stop();
  field('voice-volume').onchange=event=>editor.mutate(()=>audio.setVolume(Number(event.target.value)));
  field('effect-volume').onchange=event=>editor.mutate(()=>audio.setEffectVolume(Number(event.target.value)));
  refresh();return {refresh};
}
