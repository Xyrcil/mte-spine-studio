import {compileMinMaxCurve,compileMinMaxGradient} from './particle-values.js';

const STEP=1/120,SUPPORTED=new Set(['InitialModule','ShapeModule','EmissionModule','SizeModule','RotationModule','ColorModule','UVModule','ForceModule']);
const finite=(value,label)=>{if(typeof value!=='number'||!Number.isFinite(value))throw new Error(`Invalid particle ${label}`);return value;};
const vector=(value,fallback=0)=>['x','y','z'].map(key=>finite(value?.[key]??fallback,key));
const fraction=value=>value-Math.floor(value);
const identity=value=>[...value];
function random(state){let value=state.random;value^=value<<13;value^=value>>>17;value^=value<<5;state.random=value>>>0;return state.random/4294967296;}
function rotate(value,degrees){
  const [x,y,z]=degrees.map(value=>value*Math.PI/180),[sx,cx,sy,cy,sz,cz]=[Math.sin(x),Math.cos(x),Math.sin(y),Math.cos(y),Math.sin(z),Math.cos(z)];
  const a=value[0]*cz-value[1]*sz,b=value[0]*sz+value[1]*cz,c=b*cx-value[2]*sx,d=b*sx+value[2]*cx;
  return [a*cy+d*sy,c,-a*sy+d*cy];
}

export class ParticleSystem {
  constructor(effect,{seed,transform=identity,inverseTransform=identity,gravity=[0,-9.81,0]}={}){
    if(!effect?.data)throw new Error('Missing particle source data');
    if(gravity.length!==3)throw new Error('Particle gravity requires three components');
    this.effect=effect;this.data=effect.data;this.transform=transform;this.inverseTransform=inverseTransform;this.gravity=Array.from(gravity,value=>finite(value,'gravity'));
    const d=this.data;
    for(const [name,module] of Object.entries(d))if(name.endsWith('Module')&&module?.enabled&&!SUPPORTED.has(name))throw new Error(`Particle module unavailable: ${name}`);
    this.duration=finite(d.lengthInSec,'duration');if(this.duration<=0||this.duration>60)throw new Error('Particle duration must be between zero and 60 seconds');
    this.speed=finite(d.simulationSpeed??1,'simulation speed');if(this.speed<0)throw new Error('Negative particle simulation speed');
    if(![0,1].includes(d.moveWithTransform??0))throw new Error('Custom particle simulation space is unavailable');
    this.world=(d.moveWithTransform??0)===0;
    const initial=d.InitialModule||{};this.limit=initial.maxNumParticles??1000;if(!Number.isInteger(this.limit)||this.limit<0||this.limit>10000)throw new Error('Invalid particle capacity');
    this.life=compileMinMaxCurve(initial.startLifetime);this.startSpeed=compileMinMaxCurve(initial.startSpeed);this.startColor=compileMinMaxGradient(initial.startColor);
    this.size=[compileMinMaxCurve(initial.startSize),compileMinMaxCurve(initial.startSizeY),compileMinMaxCurve(initial.startSizeZ)];
    this.rotation=[compileMinMaxCurve(initial.startRotationX),compileMinMaxCurve(initial.startRotationY),compileMinMaxCurve(initial.startRotation)];
    this.gravityScale=compileMinMaxCurve(initial.gravityModifier);
    this.force=['x','y','z'].map(axis=>compileMinMaxCurve(d.ForceModule?.[axis]));
    if(d.ForceModule?.enabled&&d.ForceModule.randomizePerFrame)throw new Error('Per-frame randomized particle force is unavailable');
    this.angular=['x','y','curve'].map(axis=>compileMinMaxCurve(d.RotationModule?.[axis]));
    this.sizeLife=['curve','y','z'].map(axis=>compileMinMaxCurve(d.SizeModule?.[axis]));
    this.colorLife=d.ColorModule?.enabled?compileMinMaxGradient(d.ColorModule.gradient):null;
    this.frame=compileMinMaxCurve(d.UVModule?.frameOverTime);this.startFrame=compileMinMaxCurve(d.UVModule?.startFrame);
    this.shape=d.ShapeModule||{};
    if(this.shape.enabled&&![5,12,18].includes(this.shape.type))throw new Error(`Particle shape unavailable: ${this.shape.type}`);
    if(this.shape.enabled&&(this.shape.alignToDirection||this.shape.randomDirectionAmount||this.shape.sphericalDirectionAmount||this.shape.randomPositionAmount))throw new Error('Additional particle shape direction settings are unavailable');
    if(this.shape.type===12&&(this.shape.radius?.mode??0)!==0)throw new Error('Animated edge distribution is unavailable');
    this.shapeScale=vector(this.shape.m_Scale,1);this.shapePosition=vector(this.shape.m_Position);this.shapeRotation=vector(this.shape.m_Rotation);
    const emission=d.EmissionModule||{};
    if(emission.enabled&&(emission.rateOverTime?.minMaxState??0)!==0)throw new Error('Variable-rate particle emission is unavailable');
    if(emission.enabled&&((emission.rateOverDistance?.scalar??0)!==0||emission.m_Bursts?.length))throw new Error('Distance emission and particle bursts are unavailable');
    this.rate=emission.enabled?finite(emission.rateOverTime?.scalar??0,'emission rate'):0;if(this.rate<0||this.rate>100000)throw new Error('Invalid particle emission rate');
    if(d.UVModule?.enabled&&(d.UVModule.timeMode??0)!==0)throw new Error('Non-lifetime particle texture animation is unavailable');
    if(d.UVModule?.enabled&&(![0,1].includes(d.UVModule.mode)||d.UVModule.mode===0&&d.UVModule.animationType!==0))throw new Error('This particle texture animation layout is unavailable');
    const generated=seed===undefined&&d.autoRandomSeed&&globalThis.crypto?.getRandomValues?globalThis.crypto.getRandomValues(new Uint32Array(1))[0]:undefined;
    this.seed=(seed??generated??d.randomSeed??0)>>>0;if(!this.seed)this.seed=0x12345678;
    this.state={clock:0,random:this.seed,credit:0,nextId:0,particles:[]};this.tick=0;
    this.delay=compileMinMaxCurve(d.startDelay)(0,random(this.state));if(this.delay<0)throw new Error('Negative particle start delay');
    this.target=d.prewarm&&d.looping?this.duration:0;this.sync();
  }
  sync(){const count=Math.floor((this.target+1e-10)/STEP);while(this.tick<count){this.step(this.state,STEP);this.tick++;this.state.clock=this.tick*STEP;}}
  advance(seconds){finite(seconds,'time step');if(seconds<0||seconds*this.speed>60)throw new Error('Advance particles with simulation steps between zero and 60 seconds');this.target+=seconds*this.speed;this.sync();}
  spawn(state,time){
    const r=Array.from({length:22},()=>random(state)),phase=fraction((time-this.delay)/this.duration),life=this.life(phase,r[0]),id=state.nextId++;
    if(life<=0||state.particles.length>=this.limit)return;
    let position=[0,0,0],direction=[0,0,1];
    if(this.shape.enabled){
      if(this.shape.type===12){position=[(random(state)*2-1)*finite(this.shape.radius?.value??0,'edge radius'),0,0];direction=[0,1,0];}
      else position=[random(state)-.5,random(state)-.5,this.shape.type===5?random(state)-.5:0];
      position=rotate(position.map((value,index)=>value*this.shapeScale[index]),this.shapeRotation).map((value,index)=>value+this.shapePosition[index]);direction=rotate(direction,this.shapeRotation);
    }
    const speed=this.startSpeed(phase,r[1]),size=this.size.map((sample,index)=>this.data.InitialModule.size3D?sample(phase,r[2+index]):this.size[0](phase,r[2]));
    let velocity=direction.map(value=>value*speed);
    if(this.world){position=this.transform(position,true,time);velocity=this.transform(velocity,false,time);}
    const rotation=this.rotation.map((sample,index)=>index===2||this.data.InitialModule.rotation3D?sample(phase,r[5+index]):0);
    state.particles.push({id,birth:time,life,position,velocity,size,rotation,color:this.startColor(phase,r[8]),random:r});
  }
  move(state,until){
    const dt=until-state.clock;if(dt<=0)return;
    for(const particle of state.particles){
      const age=Math.max(0,Math.min(1,(state.clock+dt*.5-particle.birth)/particle.life)),r=particle.random;
      let acceleration=this.data.ForceModule?.enabled?this.force.map((sample,index)=>sample(age,r[10+index])):[0,0,0];
      if(this.world&&!this.data.ForceModule?.inWorldSpace)acceleration=this.transform(acceleration,false,state.clock+dt*.5);
      if(!this.world&&this.data.ForceModule?.inWorldSpace)acceleration=this.inverseTransform(acceleration,false,state.clock+dt*.5);
      const gravity=this.world?this.gravity:this.inverseTransform(this.gravity,false,state.clock+dt*.5),scale=this.gravityScale(age,r[18]);
      for(let axis=0;axis<3;axis++){acceleration[axis]+=gravity[axis]*scale;particle.position[axis]+=particle.velocity[axis]*dt+.5*acceleration[axis]*dt*dt;particle.velocity[axis]+=acceleration[axis]*dt;}
      if(this.data.RotationModule?.enabled)for(let axis=0;axis<3;axis++)if(axis===2||this.data.RotationModule.separateAxes)particle.rotation[axis]+=this.angular[axis](age,r[13+axis])*dt;
    }
    state.clock=until;state.particles=state.particles.filter(particle=>until-particle.birth<particle.life-1e-10);
  }
  step(state,delta){
    const begin=state.clock,end=begin+delta,from=Math.max(begin,this.delay),to=this.data.looping?end:Math.min(end,this.delay+this.duration),interval=Math.max(0,to-from);
    const total=state.credit+interval*this.rate,count=Math.floor(total+1e-10),oldCredit=state.credit;
    for(let index=0;index<count;index++){const birth=Math.min(to,from+(index+1-oldCredit)/this.rate);this.move(state,birth);this.spawn(state,birth);}
    state.credit=Math.max(0,total-count);this.move(state,end);
  }
  view(){
    const state=structuredClone(this.state),remaining=this.target-state.clock;if(remaining>1e-10)this.step(state,remaining);
    const uv=this.data.UVModule||{},count=uv.mode===1?this.effect.sprites?.length||1:Math.max(1,(uv.tilesX||1)*(uv.tilesY||1));
    return state.particles.map(particle=>{
      const age=Math.max(0,Math.min(1,(state.clock-particle.birth)/particle.life)),r=particle.random;
      const tint=this.colorLife?this.colorLife(age,r[16]):[1,1,1,1],size=particle.size.map((value,index)=>value*(this.data.SizeModule?.enabled?this.sizeLife[this.data.SizeModule.separateAxes?index:0](age,r[9]):1));
      const frame=uv.enabled?Math.min(count-1,Math.floor(fraction(this.startFrame(0,r[17])/count+this.frame(age,r[19])*(uv.cycles??1))*count)):0;
      return {...particle,age,size,color:particle.color.map((value,index)=>value*tint[index]),frame,flipU:r[20]<(uv.flipU||0),flipV:r[21]<(uv.flipV||0)};
    });
  }
  snapshot(){return {schema:1,id:this.effect.id||'',seed:this.seed,delay:this.delay,tick:this.tick,target:Math.round(this.target*1e12)/1e12,state:structuredClone(this.state)};}
  restore(value){
    if(value?.schema!==1||value.id!==(this.effect.id||'')||!Number.isInteger(value.seed)||value.seed<=0||value.seed>4294967295||!Number.isSafeInteger(value.tick)||value.tick<0)throw new Error('Particle checkpoint does not match its source');
    const target=finite(value.target,'checkpoint time'),state=structuredClone(value.state);if(target<0||!state||!Array.isArray(state.particles)||state.particles.length>this.limit)throw new Error('Invalid particle checkpoint');
    if(!Number.isInteger(state.random)||state.random<=0||state.random>4294967295||!Number.isSafeInteger(state.nextId)||state.nextId<0||!Number.isFinite(state.clock)||Math.abs(state.clock-value.tick*STEP)>1e-9||target<state.clock-1e-9||target-state.clock>=STEP+1e-9||!Number.isFinite(state.credit)||state.credit<0||state.credit>=1)throw new Error('Invalid particle checkpoint clocks');
    const ids=new Set();for(const p of state.particles){if(!Number.isSafeInteger(p.id)||p.id<0||p.id>=state.nextId||ids.has(p.id)||!Number.isFinite(p.birth)||p.birth<0||p.birth>state.clock||!Number.isFinite(p.life)||p.life<=0||state.clock-p.birth>=p.life+1e-9)throw new Error('Invalid saved particle');ids.add(p.id);for(const [name,length] of [['position',3],['velocity',3],['size',3],['rotation',3],['color',4],['random',22]])if(!Array.isArray(p[name])||p[name].length!==length||!p[name].every(Number.isFinite))throw new Error(`Invalid saved particle ${name}`);if(p.random.some(value=>value<0||value>=1))throw new Error('Invalid saved particle randomness');}
    const delay=finite(value.delay,'checkpoint delay');if(delay<0)throw new Error('Negative checkpoint delay');this.delay=delay;this.seed=value.seed;this.tick=value.tick;this.target=target;this.state=state;
  }
}
