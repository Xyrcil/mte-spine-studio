import {validateNativeAnimation} from './native-visuals.js';

export function animationPathHash(path){
  let crc=0xffffffff;for(const byte of new TextEncoder().encode(path)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;
}

export function compilePackedChannel(source){
  const channel=structuredClone(source),finite=value=>typeof value==='number'&&Number.isFinite(value);
  const checked=sample=>time=>{if(!finite(time))throw new Error('Invalid packed animation sample time');return sample(time);};
  if(channel.kind==='constant'){
    if(!finite(channel.value))throw new Error('Invalid constant animation channel');return checked(()=>channel.value);
  }
  if(channel.kind==='dense'){
    if(!finite(channel.begin)||!finite(channel.rate)||channel.rate<=0||!Array.isArray(channel.values)||!channel.values.length||!channel.values.every(finite))throw new Error('Invalid dense animation channel');
    return checked(time=>{const p=Math.max(0,Math.min(channel.values.length-1,(time-channel.begin)*channel.rate)),i=Math.floor(p);return channel.values[i]+(channel.values[Math.min(i+1,channel.values.length-1)]-channel.values[i])*(p-i);});
  }
  if(channel.kind!=='polynomial'||!Array.isArray(channel.keys)||!channel.keys.length&&!finite(channel.initial))throw new Error('Invalid polynomial animation channel');
  let previous=-Infinity;for(const key of channel.keys){if(!finite(key.time)||key.time<=previous||!Array.isArray(key.coeff)||key.coeff.length!==4||!key.coeff.every(finite))throw new Error('Invalid polynomial animation key');previous=key.time;}
  if('initial' in channel&&!finite(channel.initial))throw new Error('Invalid initial animation value');
  return checked(time=>{
    let low=0,high=channel.keys.length;while(low<high){const mid=(low+high)>>>1;if(channel.keys[mid].time<=time)low=mid+1;else high=mid;}
    if(low===0)return channel.initial??channel.keys[0].coeff[3];
    const key=channel.keys[low-1],dt=time-key.time,[a,b,c,d]=key.coeff;return ((a*dt+b)*dt+c)*dt+d;
  });
}

function targetPaths(group,root){
  const paths=new Map(),seen=new Set();
  const visit=(node,path)=>{
    if(!node||seen.has(node.id))throw new Error('Invalid packed animation hierarchy');seen.add(node.id);
    const hash=animationPathHash(path);if(paths.has(hash))throw new Error('Ambiguous packed animation target');paths.set(hash,node);
    for(const child of node.data.m_Children||[]){if(child.m_FileID)throw new Error('External packed animation transform is unavailable');const tf=group.nodes.get(String(child.m_PathID)),name=group.nodes.get(String(tf?.data.m_GameObject?.m_PathID))?.data.m_Name;if(typeof name!=='string')throw new Error('Packed animation target name is unavailable');visit(tf,path?`${path}/${name}`:name);}
  };visit(group.transforms.get(root),'');return paths;
}

export class PackedAnimation {
  constructor(group,source,clip){
    this.group=group;this.source=source;this.clip=clip;this.time=0;this.playing=false;
    const data=clip?.data,packed=data?.packedCurves;
    if(packed?.schema!==1||!Number.isFinite(packed.start)||!Number.isFinite(packed.stop)||packed.stop<packed.start||!Array.isArray(packed.channels)||!packed.channels.length||(data.m_Events||[]).length)throw new Error('Packed animation data or events are unsupported');
    this.start=packed.start;this.duration=packed.stop-packed.start;this.loop=Boolean(packed.loop);
    const paths=targetPaths(group,String(source.data.m_GameObject.m_PathID));
    this.channels=packed.channels.map(channel=>{
      const binding=channel.binding,node=paths.get(binding?.path),sample=compilePackedChannel(channel),component=channel.component;
      if(!node||!Number.isInteger(component)||component<0)throw new Error('Packed animation target is unavailable');
      const data=node.data;
      if(binding.typeID===4&&binding.attribute===3&&component<3)return {kind:'scale',target:node,key:'xyz'[component],sample};
      if(binding.typeID===4&&binding.attribute===4&&component<3){
        if(component<2){const values=channel.kind==='constant'?[channel.value]:channel.kind==='dense'?channel.values:channel.keys.flatMap(key=>key.coeff).concat(channel.initial??0);if(values.some(value=>Math.abs(value)>1e-8))throw new Error('Non-planar packed rotation is unsupported');return {kind:'noop',sample};}
        return {kind:'rotation',target:node,sample};
      }
      if(component!==0)throw new Error('Packed animation component is unsupported');
      if(binding.typeID===1&&binding.attribute===animationPathHash('m_IsActive')){const target=group.nodes.get(String(data.m_GameObject.m_PathID));if(!target)throw new Error('Packed active target is unavailable');return {kind:'active',target,sample};}
      for(const key of ['x','y'])if(binding.typeID===224&&binding.attribute===animationPathHash(`m_AnchoredPosition.${key}`)){
        if(!Number.isFinite(data.m_LocalPosition?.[key])||!Number.isFinite(data.m_AnchoredPosition?.[key]))throw new Error('Packed position target is unavailable');return {kind:'position',target:node,key,offset:data.m_LocalPosition[key]-data.m_AnchoredPosition[key],sample};
      }
      for(const key of ['r','g','b','a'])if(binding.typeID===114&&binding.attribute===animationPathHash(`m_Color.${key}`)){
        const target=group.nativeImages.find(image=>image.source.gameObject===String(data.m_GameObject.m_PathID)&&image.source.data.m_Script?.m_PathID===binding.script?.m_PathID);if(!target||target.reason)throw new Error('Packed image target is unsupported');return {kind:'color',target,key,sample};
      }
      throw new Error('Packed animation property is unsupported');
    });
  }
  play(){this.time=0;this.playing=true;this.apply();}
  advance(delta){if(!Number.isFinite(delta)||delta<0||!Number.isFinite(this.time+delta))throw new Error('Invalid packed animation delta');if(this.playing)this.time=Math.round((this.time+delta)*1e12)/1e12;this.apply();}
  apply(){
    const t=this.start+(this.loop&&this.duration>0?this.time%this.duration:Math.min(this.time,this.duration));
    const values=this.channels.map(channel=>channel.sample(t));if(values.some(value=>!Number.isFinite(value)))throw new Error('Packed animation produced a nonfinite value');
    for(let i=0;i<this.channels.length;i++){const channel=this.channels[i],value=values[i],data=channel.target?.data;
      if(channel.kind==='scale')data.m_LocalScale={...data.m_LocalScale,[channel.key]:value};
      else if(channel.kind==='rotation'){const half=value*Math.PI/360;data.m_LocalRotation={x:0,y:0,z:Math.sin(half),w:Math.cos(half)};}
      else if(channel.kind==='active')data.m_IsActive=value>=.5;
      else if(channel.kind==='color')channel.target.color[channel.key]=value;
      else if(channel.kind==='position'){data.m_LocalPosition[channel.key]=channel.offset+value;data.m_AnchoredPosition[channel.key]=value;}
    }
  }
  snapshot(){return {schema:1,id:this.source.id,clip:this.clip.id,time:this.time,playing:this.playing};}
  restore(value){value=validateNativeAnimation(value);if(value.id!==this.source.id||value.clip!==this.clip.id)throw new Error('Packed animation checkpoint source mismatch');const previous=this.snapshot();this.time=value.time;this.playing=value.playing;try{this.apply();}catch(error){this.time=previous.time;this.playing=previous.playing;throw error;}}
}
