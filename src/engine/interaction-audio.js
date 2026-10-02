const TOUCH={1:'Hand',2:'Head',3:'Chest',6:'Chest',13:'Head',14:'Chest',15:'Hand'};

export function eventLateness(layer,track,event){
  if(typeof track.getAnimationTime!=='function')return 0;
  const rate=(layer.instance?.timeScale??1)*(layer.state?.timeScale??1)*(track.timeScale??1);if(rate<=0)return 0;
  let elapsed=track.getAnimationTime()-event.time;
  if(elapsed<0&&track.loop)elapsed+=track.animationEnd-track.animationStart;
  return Math.max(0,elapsed/rate);
}

export function interactionEffects(event,skin,state){
  if(!skin||skin==='0')return [];
  const prefix=`${skin}01_cm_`;let name='';
  if(event===13)name=prefix+'click_03_head';
  else if([6,14].includes(event)&&state.names[6]==='click_01_down')name=prefix+(state.isBig?'click_03_down':'click_01_down');
  else if(event===4){if(state.names[4]==='stand_down'&&skin==='301400901')return [];if(['stand_down','stand_up'].includes(state.names[4]))name=`${skin}_cm_Foot_${state.names[4]==='stand_down'?'Down':'Up'}`;}
  else if(event===7)name=prefix+'click_tail';
  else if(event===8){const animation=state.names[8];if(['kaoji_01','kaoji_04'].includes(animation))name=state.state===1?prefix+'stand_down':state.state===2?prefix+'kaoji_01':'';else if(['kaoji_02','kaoji_03'].includes(animation))name=prefix+animation;}
  else if(event===9)name=prefix+(state.state===1?'door_down_02':'door_down');
  else if([10,11].includes(event))name=prefix+'click_lleg';
  else if(event===12&&state.names[12]==='rope_down')name=prefix+'rope_down';
  else if(event===17){if(/^game_down[12]$/.test(state.names[17]))name=prefix+'game_down';else if(/^game_up[12]$/.test(state.names[17]))name=prefix+'game_up';}
  else if([18,19,20].includes(event))name=prefix+(state.cardStage?'card_click':'card_cancel');
  return name?[name]:[];
}

export function resolveInteractionVoice(request,library,audio,language,{onUnavailable=()=>{}}={}){
  if(request.voiceId){const row=library.voices.find(row=>row.id===request.voiceId);if(row&&audio.resolve(row.resourceName,language))return {...row,title:row.title||row.resourceName};onUnavailable(`Voice unavailable (${language}): ${row?.resourceName||request.voiceId}`);return null;}
  const skin=String(request.skinId||'');
  const explicitName=request.explicit?.split('/').at(-1),explicitVoice=request.explicit&&([...library.voices,...library.storyVoices].some(row=>[row.resourceName,row.alias,row.resourcePath].some(value=>value&&value.split('/').at(-1)===explicitName))||audio.resolve(request.explicit,'a_sound_voiceeff')||audio.resolve(request.explicit,'a_sound_voiceeff_ch'));
  const explicit=explicitVoice?request.explicit:'';
  let name=explicit;
  if(!name&&(!skin||skin==='0'))return null;
  if(!name){const suffix=TOUCH[request.event]||(request.event===4&&skin==='301400901'&&request.animation==='stand_down'?'Chest':null);if(!suffix)return null;name=`Voice_${skin}_Touch_${suffix}`;}
  const candidates=[name];
  if(!explicit&&skin.length===9)candidates.push(name.replace(`Voice_${skin}_`,`Voice_${skin.slice(0,-2)}_`));
  for(const candidate of candidates){
    const normalized=candidate.split('/').at(-1),rows=[...library.voices,...library.storyVoices].filter(row=>[row.resourceName,row.alias,row.resourcePath].some(value=>value===candidate||value?.split('/').at(-1)===normalized));
    rows.sort((a,b)=>Number(b.targetId===skin)-Number(a.targetId===skin));
    for(const row of rows)if(audio.resolve(row.resourceName,language))return {...row,title:row.title||row.resourceName};
    if(audio.resolve(candidate,language))return {resourceName:candidate,title:candidate,text:''};
    // Source fallback depends on a missing sound-table entry, not a missing language track.
    if(rows.length||(library.soundResources||[]).some(row=>row.name===candidate||row.name?.split('/').at(-1)===normalized)){onUnavailable(`Voice unavailable (${language}): ${candidate}`);return null;}
  }
  return null;
}

export function explicitInteractionEffect(request,audio){
  if(!request.explicit)return null;const info=audio.soundInfo(request.explicit);
  if(!info.clip||!['a_sound_ui','a_sound_bgm','a_sound_fighteff'].includes(info.category))return null;
  const normalized=info.name.split('/').at(-1);
  if((request.effects||[]).some(name=>name.split('/').at(-1)===normalized))return null;
  return info;
}
