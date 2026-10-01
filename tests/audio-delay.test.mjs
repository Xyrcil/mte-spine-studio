import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateAudioDelay,normalizeAacDecoderConfig} from '../src/engine/audio-delay.js';
test('AAC delay estimation locates signal alignment rather than assuming a platform constant',()=>{const source=new Float32Array(4096);let random=1234;for(let i=0;i<source.length;i++){random^=random<<13;random^=random>>>17;random^=random<<5;source[i]=(random>>>0)/4294967296-.5;}for(const delay of [0,111,2048]){const decoded=new Float32Array(source.length+delay);decoded.set(source,delay);assert.equal(estimateAudioDelay(source,decoded),delay);}assert.throws(()=>estimateAudioDelay(source,new Float32Array(8192)),/Cannot determine/);});
test('AAC configuration unwraps WebKit ES descriptors without guessing sampling parameters',()=>{
  const bytes=new Uint8Array([3,128,128,128,34,0,0,0,4,128,128,128,20,64,20,0,24,0,0,0,0,0,0,0,0,0,5,128,128,128,2,17,144,6,128,128,128,1,2]);
  const config={codec:'mp4a.40.2',sampleRate:48000,numberOfChannels:2,description:bytes};const normalized=normalizeAacDecoderConfig(config);assert.deepEqual([...normalized.description],[17,144]);assert.equal(normalized.sampleRate,48000);assert.equal(config.description,bytes);
  const padded=new Uint8Array(bytes.length+8);padded.set(bytes,4);assert.deepEqual([...normalizeAacDecoderConfig({...config,description:new DataView(padded.buffer,4,bytes.length)}).description],[17,144]);
  const regular={...config,description:new Uint8Array([17,144])};assert.equal(normalizeAacDecoderConfig(regular),regular);assert.throws(()=>normalizeAacDecoderConfig({...config,description:bytes.slice(0,-8)}),/Invalid AAC/);
});
