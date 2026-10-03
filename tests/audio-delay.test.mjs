import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateAudioDelay,normalizeAacDecoderConfig,aacGaplessMetadata,normalizeDecodedAac} from '../src/engine/audio-delay.js';

const box=(type,...parts)=>{const payload=Buffer.concat(parts),header=Buffer.alloc(8);header.writeUInt32BE(payload.length+8);header.write(type,4,'ascii');return Buffer.concat([header,payload]);};
function gaplessFile({rate=48000,value='00000000 00000003 00000002 0000000000000008',duplicate=false,tracks=1}={}){
  const sample=Buffer.alloc(28);sample.writeUInt32BE(rate*65536,24);const full=Buffer.alloc(8);full.writeUInt32BE(1,4);
  const track=box('trak',box('mdia',box('minf',box('stbl',box('stsd',full,box('mp4a',sample))))));
  const tag=box('----',box('mean',Buffer.alloc(4),Buffer.from('com.apple.iTunes')),box('name',Buffer.alloc(4),Buffer.from('iTunSMPB')),box('data',Buffer.from([0,0,0,1,0,0,0,0]),Buffer.from(value)));
  return Buffer.concat([box('ftyp',Buffer.from('M4A ')),box('moov',...Array.from({length:tracks},()=>track),box('udta',box('meta',Buffer.alloc(4),box('ilst',tag,...(duplicate?[tag]:[])))))]);
}
test('gapless metadata reads the declared AAC sample rate and trim counts without platform constants',()=>{
  const data=gaplessFile();assert.deepEqual(aacGaplessMetadata(data),{sampleRate:48000,delay:3,padding:2,samples:8});
  const padded=Buffer.concat([Buffer.alloc(7),data,Buffer.alloc(3)]);assert.deepEqual(aacGaplessMetadata(new DataView(padded.buffer,padded.byteOffset+7,data.length)),aacGaplessMetadata(data));
  for(const invalid of [data.subarray(0,-1),gaplessFile({duplicate:true}),gaplessFile({tracks:2}),gaplessFile({value:'00000000 INVALID 00000000 0000000000000008'}),gaplessFile({value:'00000000 00000003 00000002 FFFFFFFFFFFFFFFF'}),Buffer.from('unrelated iTunSMPB')])assert.equal(aacGaplessMetadata(invalid),null);
});
test('decoded AAC is trimmed only when its length matches untrimmed metadata, never twice',()=>{
  const context={createBuffer(channels,length,rate){const data=Array.from({length:channels},()=>new Float32Array(length));return {length,sampleRate:rate,numberOfChannels:channels,getChannelData:index=>data[index],copyToChannel:(value,index)=>data[index].set(value)};}};
  const timing=aacGaplessMetadata(gaplessFile()),raw=context.createBuffer(2,13,48000);for(let channel=0;channel<2;channel++)raw.copyToChannel(Float32Array.from({length:13},(_,index)=>index+channel*100),channel);
  const trimmed=normalizeDecodedAac(context,raw,timing);assert.equal(trimmed.length,8);assert.deepEqual([...trimmed.getChannelData(0)],[3,4,5,6,7,8,9,10]);assert.deepEqual([...trimmed.getChannelData(1)],[103,104,105,106,107,108,109,110]);assert.equal(normalizeDecodedAac(context,trimmed,timing),trimmed);assert.equal(normalizeDecodedAac(context,raw,null),raw);
  const ambiguous=context.createBuffer(1,30,48000);assert.equal(normalizeDecodedAac(context,ambiguous,timing),ambiguous);
  const lowRate={sampleRate:22050,delay:2112,padding:583,samples:4473},resampled=context.createBuffer(1,Math.round(7168*48000/22050),48000);
  assert.equal(normalizeDecodedAac(context,resampled,lowRate).length,Math.round(4473*48000/22050));
  const noPadding={sampleRate:22050,delay:2112,padding:0,samples:441},rounded=context.createBuffer(1,Math.round(2553*48000/22050),48000);
  assert.equal(normalizeDecodedAac(context,rounded,noPadding).length,960);
});
test('AAC delay estimation locates signal alignment rather than assuming a platform constant',()=>{const source=new Float32Array(4096);let random=1234;for(let i=0;i<source.length;i++){random^=random<<13;random^=random>>>17;random^=random<<5;source[i]=(random>>>0)/4294967296-.5;}for(const delay of [0,111,2048]){const decoded=new Float32Array(source.length+delay);decoded.set(source,delay);assert.equal(estimateAudioDelay(source,decoded),delay);}assert.throws(()=>estimateAudioDelay(source,new Float32Array(8192)),/Cannot determine/);});
test('AAC configuration unwraps WebKit ES descriptors without guessing sampling parameters',()=>{
  const bytes=new Uint8Array([3,128,128,128,34,0,0,0,4,128,128,128,20,64,20,0,24,0,0,0,0,0,0,0,0,0,5,128,128,128,2,17,144,6,128,128,128,1,2]);
  const config={codec:'mp4a.40.2',sampleRate:48000,numberOfChannels:2,description:bytes};const normalized=normalizeAacDecoderConfig(config);assert.deepEqual([...normalized.description],[17,144]);assert.equal(normalized.sampleRate,48000);assert.equal(config.description,bytes);
  const padded=new Uint8Array(bytes.length+8);padded.set(bytes,4);assert.deepEqual([...normalizeAacDecoderConfig({...config,description:new DataView(padded.buffer,4,bytes.length)}).description],[17,144]);
  const regular={...config,description:new Uint8Array([17,144])};assert.equal(normalizeAacDecoderConfig(regular),regular);assert.throws(()=>normalizeAacDecoderConfig({...config,description:bytes.slice(0,-8)}),/Invalid AAC/);
});
