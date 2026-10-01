import {validateScene} from './scene.js';

const identifier=(value,label)=>{if(typeof value!=='string'||!value.length||value.length>512)throw new Error(`Invalid sequence ${label}`);return value;};
const time=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>86400)throw new Error('Invalid sequence time');return value;};

export function validateSequence(value){
  if(!value||value.schema!==1||!Array.isArray(value.actions)||value.actions.length>10000)throw new Error('Unsupported interaction sequence');
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

export class InteractionRecorder {
  constructor(stage){
    this.stage=stage;this.active=false;this.elapsed=0;this.actions=[];
    this.onStep=event=>{if(this.active){this.elapsed+=event.detail.delta;if(this.elapsed>86400){this.elapsed=86400;this.stop();}}};
    this.onInteraction=event=>{if(this.active){if(this.actions.length>=10000){this.stop();return;}const {group,controller,hit,animation=''}=event.detail;this.actions.push({at:this.elapsed,group,controller,hit,animation});}};
    this.onLost=()=>{if(this.active)this.stop();};
    stage.addEventListener('simulation-step',this.onStep);stage.addEventListener('interaction-invoked',this.onInteraction);stage.addEventListener('rendering-lost',this.onLost);
  }
  start(){
    if(this.active||this.stage.sequencePlayer||this.stage.recoveryPending)throw new Error('Finish the current recording or playback first');
    this.initial=validateScene(this.stage.captureScene?.()||this.stage.snapshot());this.elapsed=0;this.actions=[];this.active=true;return structuredClone(this.initial);
  }
  stop(){this.active=false;if(!this.initial)return null;return validateSequence({schema:1,initial:this.initial,duration:this.elapsed,actions:this.actions});}
  dispose(){this.active=false;this.stage.removeEventListener('simulation-step',this.onStep);this.stage.removeEventListener('interaction-invoked',this.onInteraction);this.stage.removeEventListener('rendering-lost',this.onLost);}
}

export class InteractionPlayer {
  constructor(stage,sequence){this.stage=stage;this.sequence=validateSequence(sequence);this.elapsed=0;this.cursor=0;this.finished=false;}
  advance(delta,evaluate){
    if(!Number.isFinite(delta)||delta<0)throw new Error('Invalid playback step');
    if(this.finished){evaluate(delta);return;}
    const end=Math.min(this.sequence.duration,this.elapsed+delta);
    const advanceTo=target=>{while(this.elapsed<target){const step=Math.min(1/120,target-this.elapsed);evaluate(step);this.elapsed+=step;}this.elapsed=target;};
    while(this.cursor<this.sequence.actions.length&&this.sequence.actions[this.cursor].at<=end){
      const action=this.sequence.actions[this.cursor];advanceTo(action.at);
      const result=this.stage.triggerInteraction(action.group,action.controller,action.hit,{replay:true});
      if(!result.accepted||result.animation!==action.animation)throw new Error(`Sequence action ${this.cursor+1} could not be reproduced: ${result.reason||'animation changed'}`);
      this.cursor++;
    }
    advanceTo(end);if(delta===0)evaluate(0);
    if(end===this.sequence.duration){this.finished=true;this.stage.dispatchEvent(new CustomEvent('sequence-ended'));}
  }
}
