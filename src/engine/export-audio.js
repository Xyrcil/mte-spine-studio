import {frameSources,clipSample} from './export-plan.js';

export function sceneAudioSources(plan,time){
  const position=time*plan.fps,index=Math.floor(position),fraction=position-index;
  const local=index%plan.cycleFrames;
  const direction=plan.loopMode==='ping-pong'&&plan.segmentFrames>1&&local>=plan.segmentFrames-1?-1:1;
  return frameSources(plan,index).map(source=>({time:plan.start+(source.frame+fraction*direction)/plan.fps*plan.speed,weight:source.weight}));
}

export function mixExportSample(plan,time,tracks,result=[0,0]){
  result[0]=0;result[1]=0;const sample=[0,0];
  let sources;
  for(const track of tracks){
    if(track.scene){
      sources??=sceneAudioSources(plan,time);
      for(const source of sources){if(track.until!==undefined&&source.time>=track.until)continue;clipSample(track.channels,track.sampleRate,track.position+(source.time-(track.offset||0))*(track.sceneRate??1),{repeat:track.repeat,gain:track.gain},sample);result[0]+=sample[0]*source.weight;result[1]+=sample[1]*source.weight;}
    }else{clipSample(track.channels,track.sampleRate,time,track.options,sample);result[0]+=sample[0];result[1]+=sample[1];}
  }
  const fade=Math.max(0,Math.min(1,(plan.duration-time)/.005));
  result[0]=Math.max(-1,Math.min(1,result[0]))*fade;result[1]=Math.max(-1,Math.min(1,result[1]))*fade;
  return result;
}

export function voiceTimeline(voices,stops=[]){
  return voices.map((voice,index)=>{const ends=stops.filter(stop=>typeof stop==='number'||!stop.group||stop.group===voice.sourceGroup).map(stop=>typeof stop==='number'?stop:stop.at).filter(at=>at>=voice.offset),end=Math.min(voices[index+1]?.offset??Infinity,...ends);return {...voice,...(Number.isFinite(end)?{until:end}:{})};});
}
export function sceneCaptionWeight(plan,time,caption){
  return sceneAudioSources(plan,time).reduce((sum,source)=>{
    const elapsed=caption.position+(source.time-(caption.offset||0))*caption.rate;
    return sum+(elapsed>=0&&elapsed<caption.duration&&(caption.until===undefined||source.time<caption.until)?source.weight:0);
  },0);
}
