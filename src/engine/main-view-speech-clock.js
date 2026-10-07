export function sourceSpeechDelay(length){
  if(!Number.isFinite(length)||length<0||length>86400)throw new Error('Invalid source speech length');
  const milliseconds=Math.fround(Math.fround(length)*1000),base=Math.floor(milliseconds),fraction=milliseconds-base;
  return (fraction>.5||fraction===.5&&base%2?base+1:base)/1000;
}

export function validateMainViewSpeechClock(value){
  const timer=(number,max)=>number===null||Number.isFinite(number)&&number>=0&&number<=max;
  if(value?.schema!==1||typeof value.visible!=='boolean'||typeof value.canClick!=='boolean'||!Number.isInteger(value.random)||value.random<1||value.random>4294967295||!timer(value.wordsRemaining,86400)||!timer(value.idleRemaining,120)||!value.visible&&value.idleRemaining!==null)throw new Error('Invalid main-view speech clock');
  return {schema:1,visible:value.visible,canClick:value.canClick,wordsRemaining:value.wordsRemaining,idleRemaining:value.idleRemaining,random:value.random};
}

export class MainViewSpeechClock {
  constructor({onHideWords=()=>{},onIdle=()=>{}}={}){this.onHideWords=onHideWords;this.onIdle=onIdle;this.reset();}
  reset(){this.value={schema:1,visible:false,canClick:true,wordsRemaining:null,idleRemaining:null,random:0x12345678};}
  get active(){return this.value.wordsRemaining!==null||this.value.idleRemaining!==null;}
  show(){this.value.visible=true;}
  hide(){this.value.visible=false;this.value.idleRemaining=null;}
  requestClick(){if(!this.value.canClick)return false;this.value.canClick=false;return true;}
  soundStarted(length){this.value.wordsRemaining=sourceSpeechDelay(length);}
  stopWords(){this.value.canClick=true;this.value.wordsRemaining=null;this.onHideWords();}
  finish(){this.value.canClick=true;this.value.wordsRemaining=null;this.onHideWords();if(this.value.visible)this.value.idleRemaining=120;}
  nextIdle(){let random=this.value.random;random^=random<<13;random^=random>>>17;random^=random<<5;this.value.random=random>>>0;return Math.floor(this.value.random/4294967296*2)+1;}
  advance(delta){
    if(!Number.isFinite(delta)||delta<0)throw new Error('Invalid source game-clock step');
    let steps=0;
    while(this.active){
      const due=Math.min(this.value.wordsRemaining??Infinity,this.value.idleRemaining??Infinity),step=Math.min(delta,due);
      for(const field of ['wordsRemaining','idleRemaining'])if(this.value[field]!==null)this.value[field]=Math.max(0,this.value[field]-step);
      delta=Math.max(0,delta-step);if(step<due-1e-9)return;
      if(++steps>10000)throw new Error('Too many source speech timer callbacks');
      if(this.value.idleRemaining!==null&&this.value.idleRemaining<=1e-9){this.value.idleRemaining=null;this.onIdle(this.nextIdle());}
      if(this.value.wordsRemaining!==null&&this.value.wordsRemaining<=1e-9)this.finish();
      if(delta===0)return;
    }
  }
  snapshot(){return {...this.value};}
  restore(value){this.value=validateMainViewSpeechClock(value);}
}
