import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateAudioDelay} from '../src/engine/audio-delay.js';
test('AAC delay estimation locates signal alignment rather than assuming a platform constant',()=>{const source=new Float32Array(4096);let random=1234;for(let i=0;i<source.length;i++){random^=random<<13;random^=random>>>17;random^=random<<5;source[i]=(random>>>0)/4294967296-.5;}for(const delay of [0,111,2048]){const decoded=new Float32Array(source.length+delay);decoded.set(source,delay);assert.equal(estimateAudioDelay(source,decoded),delay);}assert.throws(()=>estimateAudioDelay(source,new Float32Array(8192)),/Cannot determine/);});
