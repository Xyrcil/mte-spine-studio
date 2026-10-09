import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {createSceneFile,readSceneFile} from '../src/engine/scene-file.js';
import {validateScene} from '../src/engine/scene.js';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDbkAAAAASUVORK5CYII=';
const image=(id='image')=>({id,kind:'image',name:id,src:'data:image/png;base64,'+png,width:2,height:3,x:0,y:0,scale:1,rotation:0,opacity:1,flipX:false,flipY:false,visible:true,locked:false});
const scene=()=>({schema:1,name:'Scene',background:'#000000',camera:{x:0,y:0,width:10,height:10},speed:1,paused:true,objects:[image()]});
const archive=files=>new Blob([zipSync(files,{level:0})]);
async function contents(){const file=await createSceneFile(scene(),{format:'zip'});return unzipSync(new Uint8Array(await file.blob.arrayBuffer()));}

test('legacy JSON and explicit ZIP scene files round-trip without modifying the source',async()=>{
  const value=scene(),before=structuredClone(value),json=await createSceneFile(value);assert.equal(json.extension,'json');assert.deepEqual(await readSceneFile(json.blob),validateScene(value));
  const zip=await createSceneFile(value,{format:'zip'});assert.equal(zip.extension,'zip');assert.deepEqual(await readSceneFile(zip.blob),validateScene(value));assert.deepEqual(value,before);
});
test('scene ZIP deduplicates backgrounds across current and recorded initial scenes, without copying game assets',async()=>{
  const value=scene();value.objects.push({...image('copy'),x:1},{...image('portrait'),asset:'portraits/role/1.png'});delete value.objects[2].src;const initial=structuredClone(value);value.sequence={schema:1,initial,duration:0,actions:[]};
  const file=await createSceneFile(value,{format:'zip'}),files=unzipSync(new Uint8Array(await file.blob.arrayBuffer())),manifest=JSON.parse(strFromU8(files['scene.json']));assert.equal(file.images,1);assert.deepEqual(Object.keys(files).sort(),['images/0.png','scene.json']);assert.equal(manifest.scene.objects[0].src,undefined);assert.equal(manifest.scene.objects[2].asset,'portraits/role/1.png');assert.deepEqual(await readSceneFile(file.blob),validateScene(value));
});
test('scene JSON and ZIP preserve independent source preview settings in recorded initial scenes',async()=>{
  const value=scene();value.objects.push({id:'actor',kind:'spine',name:'Actor',bundle:'painting',x:0,y:0,scale:1,rotation:0,opacity:1,flipX:false,flipY:false,visible:true,locked:false,layers:[]});
  value.camera.sourcePreview={group:'actor',aspect:1.6,view:{camera:{x:0,y:.09,halfHeight:1,referenceAspect:16/9},position:{x:.177,y:.005},scale:{x:.185,y:.185},offset:1.1}};
  value.sequence={schema:1,initial:structuredClone(value),duration:0,actions:[]};const before=structuredClone(value);
  for(const format of ['json','zip']){const file=await createSceneFile(value,{format}),restored=await readSceneFile(file.blob);assert.deepEqual(restored,validateScene(value));restored.sequence.initial.camera.sourcePreview.view.offset=2;assert.equal(restored.camera.sourcePreview.view.offset,1.1);assert.deepEqual(value,before);}
});
test('ZIP rejects unsafe paths, missing or unreferenced images, malformed manifests and truncated directories',async()=>{
  const files=await contents();await assert.rejects(readSceneFile(archive({...files,'../extra.png':files['images/0.png']})),/Unsafe/);
  await assert.rejects(readSceneFile(archive({'scene.json':files['scene.json']})),/missing/);
  await assert.rejects(readSceneFile(archive({...files,'images/1.png':files['images/0.png']})),/unreferenced/);
  await assert.rejects(readSceneFile(archive({...files,'scene.json':strToU8('{}')})),/manifest/);
  const bytes=zipSync(files,{level:0});await assert.rejects(readSceneFile(new Blob([bytes.subarray(0,bytes.length-1)])),/truncated/);
  const manifest=JSON.parse(strFromU8(files['scene.json']));manifest.scene.objects[0].embeddedImage='../image.png';await assert.rejects(readSceneFile(archive({...files,'scene.json':strToU8(JSON.stringify(manifest))})),/reference/);
});
test('compressed scene ZIP entries remain readable with their integrity checks',async()=>{const files=await contents();assert.deepEqual(await readSceneFile(new Blob([zipSync(files,{level:6})])),validateScene(scene()));});
test('stored scene entries are checked for corruption and oversized declarations before allocating resources',async()=>{
  const files=await contents(),bytes=zipSync(files,{level:0}),damaged=bytes.slice(),signature=Uint8Array.from([137,80,78,71,13,10,26,10]);let start=-1;for(let i=0;i<damaged.length-8;i++)if(signature.every((value,index)=>damaged[i+index]===value)){start=i;break;}assert.ok(start>0);damaged[start+8]^=1;await assert.rejects(readSceneFile(new Blob([damaged])),/damaged/);
  const oversized=bytes.slice(),view=new DataView(oversized.buffer);for(let i=0;i<oversized.length-46;i++)if(view.getUint32(i,true)===0x02014b50&&strFromU8(oversized.subarray(i+46,i+46+view.getUint16(i+28,true)))==='images/0.png'){view.setUint32(i+24,65*1048576,true);break;}await assert.rejects(readSceneFile(new Blob([oversized])),/import limit/);
});
test('scene file operations honor cancellation before and during processing',async()=>{
  const cancelled=new AbortController();cancelled.abort();await assert.rejects(createSceneFile(scene(),{signal:cancelled.signal}),error=>error.name==='AbortError');await assert.rejects(readSceneFile(new Blob(['{}']),{signal:cancelled.signal}),error=>error.name==='AbortError');
  const exportCancel=new AbortController();await assert.rejects(createSceneFile(scene(),{format:'zip',signal:exportCancel.signal,onProgress:()=>exportCancel.abort()}),error=>error.name==='AbortError');
  const zip=await createSceneFile(scene(),{format:'zip'}),importCancel=new AbortController();await assert.rejects(readSceneFile(zip.blob,{signal:importCancel.signal,onProgress:()=>importCancel.abort()}),error=>error.name==='AbortError');
});
test('cancelling a stalled scene ZIP read stops its stream and releases its reader',async()=>{
  const {blob}=await createSceneFile(scene(),{format:'zip'}),controller=new AbortController();let cancelled=0,pulled;
  const ready=new Promise(resolve=>{pulled=resolve;}),stream=new ReadableStream({pull(){pulled();},cancel(){cancelled++;}},{highWaterMark:0});
  blob.stream=()=>stream;
  const pending=readSceneFile(blob,{signal:controller.signal});await ready;controller.abort();
  let timer;try{await assert.rejects(Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Cancelled import did not stop')),1000);})]),error=>error.name==='AbortError');}
  finally{clearTimeout(timer);}
  assert.equal(cancelled,1);assert.equal(stream.locked,false);
});
test('scene ZIP stream locks are released after completion and read failure',async()=>{
  const {blob}=await createSceneFile(scene(),{format:'zip'}),bytes=new Uint8Array(await blob.arrayBuffer());
  for(const fail of [false,true]){const stream=new ReadableStream({start(control){if(fail)control.error(new Error('File read failed'));else{control.enqueue(bytes);control.close();}}});blob.stream=()=>stream;
    if(fail)await assert.rejects(readSceneFile(blob),/File read failed/);else assert.deepEqual(await readSceneFile(blob),validateScene(scene()));
    assert.equal(stream.locked,false);
  }
});
test('JSON too large to reimport selects a deduplicated ZIP automatically',async()=>{
  const bytes=new Uint8Array(2*1048576);bytes.set(Uint8Array.from(atob(png),char=>char.charCodeAt(0)));const src='data:image/png;base64,'+Buffer.from(bytes).toString('base64'),value=scene();value.objects=Array.from({length:25},(_,index)=>({...image(String(index)),src}));
  await assert.rejects(createSceneFile(value,{format:'json'}),/choose ZIP/);const file=await createSceneFile(value);assert.equal(file.extension,'zip');assert.equal(file.images,1);assert.ok(file.blob.size<3*1048576);assert.deepEqual(await readSceneFile(file.blob),validateScene(value));
});
