let cachedAacDelay;

export function aacGaplessMetadata(data){
  const bytes=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),text=(start,end)=>new TextDecoder().decode(bytes.subarray(start,end));
  let visited=0;
  const boxes=(start,end)=>{const rows=[];while(start<end){if(++visited>4096||start+8>end)throw new Error('Invalid audio boxes');let size=view.getUint32(start),header=8;if(size===1){if(start+16>end)throw new Error('Invalid audio box');size=Number(view.getBigUint64(start+8));header=16;}if(size===0)size=end-start;if(!Number.isSafeInteger(size)||size<header||start+size>end)throw new Error('Invalid audio box');rows.push({type:text(start+4,start+8),start:start+header,end:start+size});start+=size;}return rows;};
  const child=(parent,type,skip=0)=>{if(!parent)return null;const found=boxes(parent.start+skip,parent.end).filter(row=>row.type===type);return found.length===1?found[0]:null;};
  try{
    if(bytes.length<12||text(4,8)!=='ftyp')return null;
    const root={start:0,end:bytes.length},moov=child(root,'moov'),trak=child(moov,'trak'),mdia=child(trak,'mdia'),minf=child(mdia,'minf'),stbl=child(minf,'stbl'),stsd=child(stbl,'stsd');
    if(!stsd||stsd.start+8>stsd.end||view.getUint32(stsd.start+4)!==1)return null;
    const sample=child(stsd,'mp4a',8);if(!sample||sample.start+28>sample.end||view.getUint16(sample.start+8)!==0)return null;
    const sampleRate=view.getUint32(sample.start+24)/65536;if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)return null;
    const udta=child(moov,'udta'),meta=child(udta,'meta'),ilst=child(meta,'ilst',4);if(!ilst)return null;
    const records=[];for(const row of boxes(ilst.start,ilst.end).filter(row=>row.type==='----')){const mean=child(row,'mean'),name=child(row,'name'),value=child(row,'data');if(!mean||!name||!value||mean.start+4>mean.end||name.start+4>name.end||value.start+8>value.end||value.end-value.start>1024)continue;if(text(mean.start+4,mean.end)!=='com.apple.iTunes'||text(name.start+4,name.end)!=='iTunSMPB'||view.getUint32(value.start)!==1)continue;records.push(text(value.start+8,value.end).trim());}
    if(records.length!==1)return null;const words=records[0].split(/\s+/);if(words.length<4||words.slice(0,4).some(word=>! /^[0-9a-f]{8,16}$/i.test(word)))return null;
    const [reserved,delay,padding,samples]=words.slice(0,4).map(word=>Number(BigInt('0x'+word)));if(reserved!==0||![delay,padding,samples,delay+padding+samples].every(Number.isSafeInteger)||samples<=0)return null;
    return {sampleRate,delay,padding,samples};
  }catch{return null;}
}

export function normalizeDecodedAac(context,buffer,timing){
  if(!timing)return buffer;
  const ratio=buffer.sampleRate/timing.sampleRate,length=Math.round(timing.samples*ratio),fullLength=Math.round((timing.samples+timing.delay+timing.padding)*ratio);
  if(length<1||length>buffer.length||Math.abs(buffer.length-length)<=2||Math.abs(buffer.length-fullLength)>2)return buffer;
  const start=Math.min(Math.round(timing.delay*ratio),buffer.length-length);
  const trimmed=context.createBuffer(buffer.numberOfChannels,length,buffer.sampleRate);
  for(let channel=0;channel<buffer.numberOfChannels;channel++)trimmed.copyToChannel(buffer.getChannelData(channel).subarray(start,start+length),channel);
  return trimmed;
}

export function normalizeAacDecoderConfig(config){
  if(!config?.description)return config;
  const value=config.description,bytes=ArrayBuffer.isView(value)?new Uint8Array(value.buffer,value.byteOffset,value.byteLength):new Uint8Array(value);
  if(bytes[0]!==3)return config;
  const invalid=()=>{throw new Error('Invalid AAC decoder description; try WebM or export without audio');};
  const descriptor=(offset,end)=>{if(offset>=end)invalid();const tag=bytes[offset++];let length=0,complete=false;for(let i=0;i<4;i++){if(offset>=end)invalid();const value=bytes[offset++];length=length*128+(value&127);if(!(value&128)){complete=true;break;}}if(!complete||offset+length>end)invalid();return {tag,start:offset,end:offset+length};};
  const find=(offset,end,tag)=>{while(offset<end){const row=descriptor(offset,end);if(row.tag===tag)return row;offset=row.end;}invalid();};
  const root=descriptor(0,bytes.length);if(root.end-root.start<3)invalid();const flags=bytes[root.start+2];let offset=root.start+3;
  if(flags&128)offset+=2;
  if(flags&64){if(offset>=root.end)invalid();offset+=1+bytes[offset];}
  if(flags&32)offset+=2;
  const decoder=find(offset,root.end,4);if(decoder.end-decoder.start<13)invalid();
  const specific=find(decoder.start+13,decoder.end,5);if(specific.end-specific.start<2)invalid();
  return {...config,description:bytes.slice(specific.start,specific.end)};
}

export function estimateAudioDelay(source,decoded){
  const start=1024,count=512;let sourcePower=0;
  for(let i=0;i<count;i++)sourcePower+=source[start+i]**2;
  let best=-Infinity,delay=0;
  for(let offset=-512;offset<=8192;offset++){
    if(start+offset<0||start+offset+count>decoded.length)continue;
    let sum=0,power=0;for(let i=0;i<count;i++){const value=decoded[start+offset+i];sum+=source[start+i]*value;power+=value*value;}
    const score=sum/Math.sqrt(sourcePower*power||1);if(score>best){best=score;delay=offset;}
  }
  if(best<.2)throw new Error('Cannot determine this device’s AAC timing; try WebM or export without audio');
  return delay;
}

export async function aacEncodingDelay(signal){
  if(cachedAacDelay!==undefined)return cachedAacDelay;
  const check=()=>{if(signal?.aborted)throw new DOMException('Export cancelled','AbortError');};check();
  const sampleRate=48000,length=8192,source=new Float32Array(length),input=new Float32Array(length*2),packets=[],samples=[];
  let random=0x2468ace,config,encoder,decoder,error;
  for(let i=0;i<length;i++){random^=random<<13;random^=random>>>17;random^=random<<5;source[i]=((random>>>0)/4294967296-.5)*.5;input[i]=input[length+i]=source[i];}
  const abort=()=>{if(encoder?.state!=='closed')encoder?.close();if(decoder?.state!=='closed')decoder?.close();};
  signal?.addEventListener('abort',abort,{once:true});
  try{
    encoder=new AudioEncoder({output:(chunk,meta)=>{packets.push(chunk);if(meta?.decoderConfig)config=meta.decoderConfig;},error:reason=>error=reason});
    encoder.configure({codec:'mp4a.40.2',sampleRate,numberOfChannels:2,bitrate:128000});
    const data=new AudioData({format:'f32-planar',sampleRate,numberOfFrames:length,numberOfChannels:2,timestamp:0,data:input});encoder.encode(data);data.close();await encoder.flush();check();if(error)throw error;
    decoder=new AudioDecoder({output:data=>{try{const values=new Float32Array(data.numberOfFrames);data.copyTo(values,{planeIndex:0,format:'f32-planar'});samples.push({start:Math.round(data.timestamp/1e6*sampleRate),values});}finally{data.close();}},error:reason=>error=reason});
    if(!config)throw new Error('AAC encoder did not provide a decoder configuration');decoder.configure(normalizeAacDecoderConfig(config));for(const packet of packets)decoder.decode(packet);await decoder.flush();check();if(error)throw error;
    const decoded=new Float32Array(Math.max(length,...samples.map(sample=>sample.start+sample.values.length)));for(const sample of samples){const start=Math.max(0,sample.start),skip=Math.max(0,-sample.start);decoded.set(sample.values.subarray(skip),start);}
    const delay=estimateAudioDelay(source,decoded)/sampleRate;cachedAacDelay=delay;return delay;
  }finally{signal?.removeEventListener('abort',abort);abort();}
}
