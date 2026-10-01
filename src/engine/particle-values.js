const finite=(value,label)=>{if(typeof value!=='number'||!Number.isFinite(value))throw new Error(`Invalid particle ${label}`);return value;};
const fraction=value=>Math.max(0,Math.min(1,finite(value,'fraction')));
const slope=value=>{if(value==='Infinity'||value===Infinity)return Infinity;if(value==='-Infinity'||value===-Infinity)return -Infinity;return finite(value??0,'curve tangent');};
const blend=(a,b,t)=>a*(1-t)+b*t;
const cubic=(a,b,c,d,t)=>{const q=1-t;return q*q*q*a+3*q*q*t*b+3*q*t*t*c+t*t*t*d;};

export function compileAnimationCurve(source){
  if(!source)return ()=>0;
  if(!Array.isArray(source.m_Curve)||source.m_Curve.length>4096)throw new Error('Invalid particle curve keys');
  let previous=-Infinity;const preWrap=source.m_PreInfinity,postWrap=source.m_PostInfinity;
  const keys=source.m_Curve.map(key=>{
    const time=finite(key.time,'key time');if(time<=previous||Number.isFinite(previous)&&!Number.isFinite(time-previous))throw new Error('Particle curve keys must have increasing finite spans');previous=time;
    const mode=key.weightedMode??0;if(!Number.isInteger(mode)||mode<0||mode>3)throw new Error('Invalid particle tangent weighting');
    return {time,value:finite(key.value,'key value'),inSlope:slope(key.inSlope),outSlope:slope(key.outSlope),mode,inWeight:mode&1?fraction(key.inWeight):1/3,outWeight:mode&2?fraction(key.outWeight):1/3};
  });
  return time=>{
    finite(time,'curve time');if(!keys.length)return 0;
    if(time<=keys[0].time){if(time<keys[0].time&&preWrap!==undefined&&preWrap!==2)throw new Error('Unsupported particle pre-wrap mode');return keys[0].value;}
    if(time>=keys.at(-1).time){if(time>keys.at(-1).time&&postWrap!==undefined&&postWrap!==2)throw new Error('Unsupported particle post-wrap mode');return keys.at(-1).value;}
    let low=0,high=keys.length-1;while(high-low>1){const middle=(low+high)>>1;if(time<keys[middle].time)high=middle;else low=middle;}
    const a=keys[low],b=keys[high],span=b.time-a.time,u=(time-a.time)/span;
    if(!Number.isFinite(a.outSlope)||!Number.isFinite(b.inSlope))return a.value;
    if(!(a.mode&2)&&!(b.mode&1)){
      const square=u*u,cube=square*u;
      return finite((2*cube-3*square+1)*a.value+(cube-2*square+u)*span*a.outSlope+(-2*cube+3*square)*b.value+(cube-square)*span*b.inSlope,'curve result');
    }
    let left=0,right=1;
    for(let i=0;i<48;i++){const t=(left+right)/2;if(cubic(0,a.outWeight,1-b.inWeight,1,t)<u)left=t;else right=t;}
    const t=(left+right)/2;
    return finite(cubic(a.value,a.value+span*a.outWeight*a.outSlope,b.value-span*b.inWeight*b.inSlope,b.value,t),'curve result');
  };
}

export function compileMinMaxCurve(source){
  if(typeof source==='number'){const value=finite(source,'constant');return ()=>value;}
  source=source||{minMaxState:0,scalar:0};
  const mode=source.minMaxState;if(!Number.isInteger(mode)||mode<0||mode>3)throw new Error('Unsupported particle curve mode');
  const scale=finite(source.scalar,'curve scalar');
  const minimum=mode===3?finite(source.minScalar,'minimum constant'):0;
  const upper=mode===1||mode===2?compileAnimationCurve(source.maxCurve):null;
  const lower=mode===2?compileAnimationCurve(source.minCurve):null;
  return (time=0,random=1)=>{
    const t=fraction(time),r=fraction(random);
    if(mode===0)return scale;
    if(mode===3)return blend(minimum,scale,r);
    return finite(scale*(mode===1?upper(t):blend(lower(t),upper(t),r)),'curve result');
  };
}

const color=value=>['r','g','b','a'].map(key=>finite(value?.[key],`color ${key}`));
function channelKeys(source,prefix,count,channels){
  if(!Number.isInteger(count)||count<1||count>8)throw new Error('Invalid particle gradient key count');
  let previous=-1;
  return Array.from({length:count},(_,index)=>{
    const raw=source[`${prefix}${index}`];if(!Number.isInteger(raw)||raw<0||raw>65535||raw<previous)throw new Error('Invalid particle gradient time');previous=raw;
    return {time:raw/65535,values:channels.map(channel=>finite(source[`key${index}`]?.[channel],`gradient ${channel}`))};
  });
}
function gradientChannel(keys,time,fixed){
  if(time<=keys[0].time)return [...keys[0].values];
  let upper=keys.findIndex(key=>key.time>time);
  if(upper<0)return [...keys.at(-1).values];
  const a=keys[upper-1],b=keys[upper];
  if(fixed)return [...b.values];
  const t=(time-a.time)/(b.time-a.time);return a.values.map((value,index)=>blend(value,b.values[index],t));
}
export function compileGradient(source){
  if(!source)throw new Error('Missing particle gradient');
  if(![0,1].includes(source.m_Mode))throw new Error('Unsupported particle gradient interpolation');
  const colors=channelKeys(source,'ctime',source.m_NumColorKeys,['r','g','b']),alphas=channelKeys(source,'atime',source.m_NumAlphaKeys,['a']),fixed=source.m_Mode===1;
  return time=>{const t=fraction(time);return [...gradientChannel(colors,t,fixed),gradientChannel(alphas,t,fixed)[0]];};
}

export function compileMinMaxGradient(source){
  if(!source||!Number.isInteger(source.minMaxState)||source.minMaxState<0||source.minMaxState>4)throw new Error('Unsupported particle color mode');
  const mode=source.minMaxState,max=mode===0||mode===2?color(source.maxColor):null,min=mode===2?color(source.minColor):null;
  const upper=[1,3,4].includes(mode)?compileGradient(source.maxGradient):null,lower=mode===3?compileGradient(source.minGradient):null;
  return (time=0,random=1)=>{
    const t=fraction(time),r=fraction(random);
    if(mode===0)return [...max];
    if(mode===1)return upper(t);
    if(mode===4)return upper(r);
    const a=mode===2?min:lower(t),b=mode===2?max:upper(t);return a.map((value,index)=>blend(value,b[index],r));
  };
}
