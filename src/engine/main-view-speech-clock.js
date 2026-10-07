export function sourceSpeechDelay(length){
  if(!Number.isFinite(length)||length<0||length>86400)throw new Error('Invalid source speech length');
  const milliseconds=Math.fround(Math.fround(length)*1000),base=Math.floor(milliseconds),fraction=milliseconds-base;
  return (fraction>.5||fraction===.5&&base%2?base+1:base)/1000;
}

export function validateMainViewSpeechClock(value){
  const timer=(number,max)=>number===null||Number.isFinite(number)&&number>=0&&number<=max;
  if(value?.schema!==1||typeof value.visible!=='boolean'||typeof value.canClick!=='boolean'||!Number.isInteger(value.random)||value.random<1||value.random>4294967295||!timer(value.wordsRemaining,86400)||!timer(value.idleRemaining,120)||!value.visible&&value.idleRemaining!==null)throw new Error('Invalid main-view speech clock');
  const player=number=>Number.isInteger(number)&&number>=-2147483648&&number<=2147483647;
  let shieldTimers;
  if(value.shieldTimers!==undefined){
    if(!Array.isArray(value.shieldTimers)||value.shieldTimers.length>10000)throw new Error('Invalid subtitle-only timers');
    const seen=new Set();shieldTimers=value.shieldTimers.map(row=>{
      if(!player(row.player)||seen.has(row.player)||typeof row.name!=='string'||!row.name||row.name.length>512||!Number.isFinite(row.remaining)||row.remaining<0||row.remaining>86400)throw new Error('Invalid subtitle-only timer');
      seen.add(row.player);return {player:row.player,name:row.name,remaining:row.remaining};
    });
  }
  if(value.lastShieldPlayer!==undefined&&!player(value.lastShieldPlayer)||shieldTimers?.length&&value.lastShieldPlayer===undefined)throw new Error('Invalid subtitle-only timer reference');
  return {schema:1,visible:value.visible,canClick:value.canClick,wordsRemaining:value.wordsRemaining,idleRemaining:value.idleRemaining,random:value.random,...(shieldTimers?.length?{shieldTimers}:{}),...(value.lastShieldPlayer!==undefined?{lastShieldPlayer:value.lastShieldPlayer}:{})};
}

export class MainViewSpeechClock {
  constructor({onHideWords=()=>{},onIdle=()=>{}}={}){this.onHideWords=onHideWords;this.onIdle=onIdle;this.reset();}
  reset(){this.value={schema:1,visible:false,canClick:true,wordsRemaining:null,idleRemaining:null,random:0x12345678};this.shieldTimers=[];this.lastShieldPlayer=undefined;}
  get active(){return this.value.wordsRemaining!==null||this.value.idleRemaining!==null||this.shieldTimers.length>0;}
  show(){this.value.visible=true;}
  hide(){this.value.visible=false;this.value.idleRemaining=null;}
  requestClick(){if(!this.value.canClick)return false;this.value.canClick=false;return true;}
  soundStarted(length){this.value.wordsRemaining=sourceSpeechDelay(length);}
  shieldStarted(player,name,length){
    const remaining=sourceSpeechDelay(length);
    validateMainViewSpeechClock({...this.value,shieldTimers:[{player,name,remaining}],lastShieldPlayer:player});
    this.value.wordsRemaining=null;
    const old=this.shieldTimers.find(row=>row.player===player);this.shieldTimers=this.shieldTimers.filter(row=>row.player!==player);
    if(old?.name===name)return false;
    this.shieldTimers.push({player,name,remaining});this.lastShieldPlayer=player;return true;
  }
  clearShields(){this.shieldTimers=[];this.lastShieldPlayer=undefined;}
  stopWords(){this.value.canClick=true;this.value.wordsRemaining=null;this.shieldTimers=this.shieldTimers.filter(row=>row.player!==this.lastShieldPlayer);this.lastShieldPlayer=undefined;this.onHideWords();}
  finish(lateness=0){this.value.canClick=true;this.value.wordsRemaining=null;this.onHideWords(lateness);if(this.value.visible)this.value.idleRemaining=120;}
  nextIdle(){let random=this.value.random;random^=random<<13;random^=random>>>17;random^=random<<5;this.value.random=random>>>0;return Math.floor(this.value.random/4294967296*2)+1;}
  advance(delta){
    if(!Number.isFinite(delta)||delta<0)throw new Error('Invalid source game-clock step');
    let steps=0;
    while(this.active){
      const due=Math.min(this.value.wordsRemaining??Infinity,this.value.idleRemaining??Infinity,...this.shieldTimers.map(row=>row.remaining)),step=Math.min(delta,due);
      for(const field of ['wordsRemaining','idleRemaining'])if(this.value[field]!==null)this.value[field]=Math.max(0,this.value[field]-step);
      for(const row of this.shieldTimers)row.remaining=Math.max(0,row.remaining-step);
      delta=Math.max(0,delta-step);if(step<due-1e-9)return;
      if(++steps>10000)throw new Error('Too many source speech timer callbacks');
      const expired=this.shieldTimers.filter(row=>row.remaining<=1e-9);
      for(const row of expired){if(!this.shieldTimers.includes(row))continue;this.shieldTimers=this.shieldTimers.filter(current=>current!==row);this.value.canClick=true;this.onHideWords(delta);}
      if(this.value.idleRemaining!==null&&this.value.idleRemaining<=1e-9){this.value.idleRemaining=null;this.onIdle(this.nextIdle(),delta);}
      if(this.value.wordsRemaining!==null&&this.value.wordsRemaining<=1e-9)this.finish(delta);
      if(delta===0)return;
    }
  }
  snapshot(){return {...this.value,...(this.shieldTimers.length?{shieldTimers:this.shieldTimers.map(row=>({...row}))}:{}),...(this.lastShieldPlayer!==undefined?{lastShieldPlayer:this.lastShieldPlayer}:{})};}
  restore(value){const {shieldTimers=[],lastShieldPlayer,...clock}=validateMainViewSpeechClock(value);this.value=clock;this.shieldTimers=shieldTimers;this.lastShieldPlayer=lastShieldPlayer;}
}
