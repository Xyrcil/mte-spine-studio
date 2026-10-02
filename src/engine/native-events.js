export class NativeEventTimeline {
  constructor(events,duration,loop,handlers){
    if(!Array.isArray(events)||events.length>4096||!Number.isFinite(duration)||duration<=0)throw new Error('Invalid native animation events');
    this.duration=duration;this.loop=loop;this.cursor=0;
    this.events=events.map((source,index)=>{const event=structuredClone(source);if(!Number.isFinite(event.time)||event.time<0||event.time>duration||typeof event.functionName!=='string'||!event.functionName||event.functionName.length>512||typeof event.data!=='string'||event.data.length>10000||!Number.isFinite(event.floatParameter)||!Number.isInteger(event.intParameter)||event.objectReferenceParameter?.m_FileID!==0||!['0',0].includes(event.objectReferenceParameter?.m_PathID))throw new Error('Native animation events or parameters are unsupported');const handler=handlers instanceof Map?handlers.get(event.functionName):null;if(typeof handler!=='function')throw new Error(`Native animation events are unavailable: ${event.functionName}`);return {event,index,handler};}).sort((a,b)=>a.event.time-b.event.time||a.index-b.index);
  }
  due(time){
    if(!Number.isFinite(time)||time<0)throw new Error('Invalid native event time');if(!this.events.length)return 0;
    const cycle=this.loop?Math.floor(time/this.duration):0,local=this.loop?time-cycle*this.duration:time,count=cycle*this.events.length+this.events.filter(row=>row.event.time<=local+1e-12).length;if(!Number.isSafeInteger(count))throw new Error('Native event range is too large');return count;
  }
  range(time){const due=this.due(time);if(due<this.cursor)throw new Error('Native events require checkpoint restore before seeking backwards');if(due-this.cursor>10000)throw new Error('Native event range is too large');return due;}
  advance(time,continuePlaying=()=>true){
    const due=this.range(time);
    while(this.cursor<due&&continuePlaying()){const index=this.cursor%this.events.length,cycle=Math.floor(this.cursor/this.events.length),row=this.events[index];row.handler({...structuredClone(row.event),occurrence:cycle*this.duration+row.event.time,frameTime:time});this.cursor++;}
  }
  check(cursor,time){if(!Number.isSafeInteger(cursor)||cursor<0||cursor>this.due(time))throw new Error('Invalid native event checkpoint');return cursor;}
  restore(cursor,time){this.cursor=this.check(cursor,time);}
}
