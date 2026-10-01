import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseVideoCodec} from '../src/engine/export-codec.js';
test('WebM prefers VP9 but falls back to supported VP8 with the same output settings',async()=>{
  const options={width:160,height:120,frameRate:25},calls=[];
  assert.equal(await chooseVideoCodec('webm',options,async(codec,value)=>{calls.push(codec);assert.equal(value,options);return codec==='vp8';}),'vp8');assert.deepEqual(calls,['vp9','vp8']);
  assert.equal(await chooseVideoCodec('webm',options,async()=>true),'vp9');assert.equal(await chooseVideoCodec('mp4',options,async codec=>codec==='avc'),'avc');
});
test('image exports never probe video encoders, and unsupported videos retain their actual format',async()=>{
  for(const format of ['png','sequence'])assert.equal(await chooseVideoCodec(format,{},()=>{throw new Error('Should not probe');}),null);
  for(const format of ['mp4','webm'])await assert.rejects(chooseVideoCodec(format,{},async()=>false),new RegExp(`${format.toUpperCase()} encoding is unavailable.*PNG sequence`));
});
