import {validateScene} from './scene.js';

const identifier=(value,label)=>{if(typeof value!=='string'||!value.length||value.length>512)throw new Error(`Invalid sequence ${label}`);return value;};
const time=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>86400)throw new Error('Invalid sequence time');return value;};

export function validateSequence(value){
  if(!value||value.schema!==1||!Array.isArray(value.actions)||value.actions.length>10000)throw new Error('Unsupported interaction sequence');
  if(value.initial?.sequence!==undefined)throw new Error('Nested interaction sequences are not supported');
  const initial=validateScene(value.initial),duration=time(value.duration);let previous=0;
  const actions=value.actions.map(action=>{
    const at=time(action.at);if(at<previous||at>duration)throw new Error('Sequence actions must be ordered within its duration');previous=at;
    const group=identifier(action.group,'object'),controller=identifier(action.controller,'controller'),hit=identifier(action.hit,'region');
    const object=initial.objects.find(object=>object.id===group&&object.kind==='spine');
    if(!object?.interactions?.some(root=>root.id===controller))throw new Error('Sequence controller is absent from its initial scene');
    if(typeof action.animation!=='string'||action.animation.length>512)throw new Error('Invalid sequence animation');
    return {at,group,controller,hit,animation:action.animation};
  });
  return {schema:1,initial,duration,actions};
}

export function retimeSequenceAction(value,index,at){
  const sequence=validateSequence(value);time(at);
  if(!Number.isSafeInteger(index)||index<0||index>=sequence.actions.length)throw new Error('Sequence click is unavailable');
  sequence.actions[index].at=at;sequence.actions.sort((a,b)=>a.at-b.at);sequence.duration=Math.max(sequence.duration,at);
  return validateSequence(sequence);
}

export function removeSequenceAction(value,index){
  const sequence=validateSequence(value);
  if(!Number.isSafeInteger(index)||index<0||index>=sequence.actions.length)throw new Error('Sequence click is unavailable');
  sequence.actions.splice(index,1);return sequence;
}

export async function previewSequenceAt(stage,value,target,{restore,signal,onProgress=()=>{}}){
  const sequence=validateSequence(value);time(target);if(target>sequence.duration)throw new Error('Preview time exceeds sequence duration');
  const initial=structuredClone(sequence.initial);initial.paused=true;
  if(initial.audio){initial.audio.muted=true;initial.audio.voiceTrack=null;initial.audio.effectTracks=[];}
  else if(stage.captureAudio)initial.audio={...stage.captureAudio(),muted:true,ambientEnabled:false,ambientTracks:[],effectTracks:[],voiceTrack:null};
  const check=()=>{if(signal?.aborted)throw new DOMException('Sequence preview cancelled','AbortError');if(stage.recoveryPending)throw new Error('Sequence preview was interrupted by rendering loss');};check();
  await restore(initial,signal);check();const epoch=stage.contextEpoch;stage.sequence=sequence;stage.sequenceBusy=true;stage.paused=true;
  const player=new InteractionPlayer(stage,sequence,{notifyEnd:false});
  try{
    player.advance(0,delta=>stage.evaluateFrame(delta));
    while(player.elapsed<target){check();if(stage.contextEpoch!==epoch)throw new Error('Sequence preview was interrupted by rendering loss');player.advance(Math.min(.125,target-player.elapsed),delta=>stage.evaluateFrame(delta));onProgress(player.elapsed,target);await new Promise(resolve=>setTimeout(resolve,0));}
    check();stage.draw();return player.elapsed;
  }finally{stage.sequenceBusy=false;}
}

export class InteractionRecorder {
  constructor(stage){
    this.stage=stage;this.active=false;this.elapsed=0;this.actions=[];
    this.onStep=event=>{if(this.active){this.elapsed+=event.detail.delta;if(this.elapsed>86400){this.elapsed=86400;this.stop();}}};
    this.onInteraction=event=>{if(this.active){if(this.actions.length>=10000){this.stop();return;}const {group,controller,hit,animation=''}=event.detail;this.actions.push({at:this.elapsed,group,controller,hit,animation});}};
    this.onLost=()=>{if(this.active)this.stop();};
    stage.addEventListener('simulation-step',this.onStep);stage.addEventListener('interaction-invoked',this.onInteraction);stage.addEventListener('rendering-pausing',this.onLost);stage.addEventListener('rendering-lost',this.onLost);
  }
  start(){
    if(this.active||this.stage.sequencePlayer||this.stage.recoveryPending)throw new Error('Finish the current recording or playback first');
    const initial=structuredClone(this.stage.captureScene?.()||this.stage.snapshot());delete initial.sequence;
    this.initial=validateScene(initial);this.elapsed=0;this.actions=[];this.active=true;return structuredClone(this.initial);
  }
  stop(){const active=this.active;this.active=false;if(!this.initial)return null;const sequence=validateSequence({schema:1,initial:this.initial,duration:this.elapsed,actions:this.actions});if(active)this.stage.dispatchEvent(new CustomEvent('sequence-recorded',{detail:sequence}));return sequence;}
  dispose(){this.active=false;this.stage.removeEventListener('simulation-step',this.onStep);this.stage.removeEventListener('interaction-invoked',this.onInteraction);this.stage.removeEventListener('rendering-pausing',this.onLost);this.stage.removeEventListener('rendering-lost',this.onLost);}
}

export class InteractionPlayer {
  constructor(stage,sequence,{continueAfterEnd=false,notifyEnd=true}={}){this.stage=stage;this.sequence=validateSequence(sequence);this.elapsed=0;this.cursor=0;this.finished=false;this.continueAfterEnd=continueAfterEnd;this.notifyEnd=notifyEnd;}
  advance(delta,evaluate){
    if(!Number.isFinite(delta)||delta<0)throw new Error('Invalid playback step');
    if(this.finished){evaluate(delta);return;}
    const target=this.elapsed+delta,end=Math.min(this.sequence.duration,target);
    const timed=(at,action)=>{const previous=this.stage.sequenceTime;this.stage.sequenceTime=at;try{return action();}finally{if(previous===undefined)delete this.stage.sequenceTime;else this.stage.sequenceTime=previous;}};
    const advanceTo=target=>{while(this.elapsed<target){const step=Math.min(1/120,target-this.elapsed);timed(this.elapsed+step,()=>evaluate(step));this.elapsed+=step;}this.elapsed=target;};
    while(this.cursor<this.sequence.actions.length&&this.sequence.actions[this.cursor].at<=end){
      const action=this.sequence.actions[this.cursor];advanceTo(action.at);
      const result=timed(action.at,()=>this.stage.triggerInteraction(action.group,action.controller,action.hit,{replay:true}));
      if(!result.accepted||result.animation!==action.animation)throw new Error(`Sequence action ${this.cursor+1} could not be reproduced: ${result.reason||'animation changed'}`);
      this.cursor++;
    }
    advanceTo(end);if(delta===0)timed(this.elapsed,()=>evaluate(0));
    if(end===this.sequence.duration){this.finished=true;if(this.notifyEnd)this.stage.dispatchEvent(new CustomEvent('sequence-ended'));if(this.continueAfterEnd&&target>end){timed(target,()=>evaluate(target-end));this.elapsed=target;}}
  }
}
