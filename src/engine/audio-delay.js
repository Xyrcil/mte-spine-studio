let cachedAacDelay;

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
