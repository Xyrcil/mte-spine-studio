import test from 'node:test';
import assert from 'node:assert/strict';
import {worldAt,panCamera,zoomCameraAt,createCanvasInput} from '../src/canvas-input.js';

const bounds={left:10,top:20,right:810,bottom:420,width:800,height:400};
const camera={x:3,y:4,width:20,height:20};
function fixture(){
  const canvas=new EventTarget();Object.assign(canvas,{focus(){},setAttribute(){},setPointerCapture(){},releasePointerCapture(){},getBoundingClientRect:()=>bounds});
  const stage=new EventTarget();Object.assign(stage,{canvas,camera:{...camera},hitTest:()=>null,interact:()=>{counts.clicks++;return {accepted:true};},fit:()=>stage.camera={...camera}});
  const counts={before:0,changed:0,clicks:0},group={x:0,y:0},state={view:'gallery',recording:false};
  const editor={busy:false,before(){counts.before++;return !this.busy;},changed(){counts.changed++;},choose(){}};
  const input=createCanvasInput(stage,editor,{getView:()=>state.view,isRecording:()=>state.recording});
  const send=(type,values={})=>{const event=new Event(type,{cancelable:true});Object.assign(event,{pointerId:1,clientX:300,clientY:200,button:0,...values});canvas.dispatchEvent(event);};
  return {stage,editor,input,counts,state,group,send};
}
test('zoom preserves pointer world position and pan follows screen movement',()=>{
  const anchor=worldAt(camera,bounds,700,100),zoom=zoomCameraAt(camera,bounds,700,100,.5),after=worldAt(zoom,bounds,700,100);
  assert.ok(Math.abs(anchor.x-after.x)<1e-10);assert.ok(Math.abs(anchor.y-after.y)<1e-10);
  const moved=panCamera(camera,bounds,80,40);assert.equal(moved.x,-1);assert.equal(moved.y,6);
  assert.throws(()=>zoomCameraAt(camera,bounds,0,0,NaN));
});
test('Gallery clicks occur on release; dragging pans without invoking interaction',()=>{
  const f=fixture();f.send('pointerdown');assert.equal(f.counts.clicks,0);f.send('pointerup');assert.equal(f.counts.clicks,1);
  f.send('pointerdown');f.send('pointermove',{clientX:350});f.send('pointerup',{clientX:350});
  assert.equal(f.counts.clicks,1);assert.equal(f.counts.before,1);assert.equal(f.counts.changed,1);assert.notEqual(f.stage.camera.x,camera.x);f.input.dispose();
});
test('Studio drags objects, supports explicit panning, and respects locked objects',()=>{
  const f=fixture();f.state.view='studio';f.stage.hitTest=()=>f.group;
  f.send('pointerdown');f.send('pointermove',{clientX:350});f.send('pointerup',{clientX:350});assert.equal(f.group.x,2.5);assert.equal(f.stage.camera.x,3);
  f.send('pointerdown',{altKey:true});f.send('pointermove',{clientX:350});f.send('pointerup',{clientX:350});assert.equal(f.group.x,2.5);assert.equal(f.stage.camera.x,.5);
  f.group.locked=true;f.send('pointerdown');f.send('pointermove',{clientX:350});f.send('pointerup',{clientX:350});assert.equal(f.group.x,2.5);f.input.dispose();
});
test('pinch cancels click and has a single undo checkpoint; extra touches block safely',()=>{
  const f=fixture();f.send('pointerdown',{clientX:200});f.send('pointerdown',{pointerId:2,clientX:400});f.send('pointermove',{pointerId:2,clientX:600});
  assert.equal(f.stage.camera.width,10);assert.equal(f.counts.before,1);
  f.send('pointerdown',{pointerId:3});const prior={...f.stage.camera};f.send('pointermove',{pointerId:3,clientX:700});assert.deepEqual(f.stage.camera,prior);
  for(const pointerId of [3,2,1])f.send('pointerup',{pointerId});assert.equal(f.counts.clicks,0);assert.equal(f.counts.changed,1);f.input.dispose();
});
test('recording allows taps, not camera edits; cancellation never clicks',()=>{
  const f=fixture();f.editor.busy=true;f.state.recording=true;f.send('pointerdown');f.send('pointerup');assert.equal(f.counts.clicks,1);
  f.send('pointerdown');f.send('pointermove',{clientX:350});f.send('pointerup',{clientX:350});assert.equal(f.counts.clicks,1);assert.deepEqual(f.stage.camera,camera);
  f.send('pointerdown');f.send('pointercancel');assert.equal(f.counts.clicks,1);f.input.dispose();
});
test('wheel history flushes on reset; keyboard and export input respect editing locks',()=>{
  const f=fixture();f.send('wheel',{deltaY:-200});f.input.clear();assert.equal(f.counts.changed,1);
  f.send('keydown',{key:'ArrowRight'});assert.equal(f.counts.changed,2);
  const prior={...f.stage.camera};f.state.view='export';f.send('wheel',{deltaY:200});f.send('keydown',{key:'-'});f.send('pointerdown');f.send('pointerup');assert.deepEqual(f.stage.camera,prior);assert.equal(f.counts.clicks,0);f.input.dispose();
});
test('line and pixel wheel inputs agree, while browser keyboard shortcuts are untouched',()=>{
  const a=fixture(),b=fixture();a.send('wheel',{deltaY:-2,deltaMode:1});b.send('wheel',{deltaY:-80,deltaMode:0});assert.deepEqual(a.stage.camera,b.stage.camera);
  const prior={...a.stage.camera};a.send('keydown',{key:'+',ctrlKey:true});a.send('keydown',{key:'-',metaKey:true});a.send('wheel',{deltaY:NaN});assert.deepEqual(a.stage.camera,prior);a.input.dispose();b.input.dispose();
});
test('rendering interruption releases gestures and flushes pending camera history',()=>{
  const f=fixture();f.send('wheel',{deltaY:50});f.send('pointerdown');f.stage.dispatchEvent(new Event('rendering-pausing'));f.send('pointerup');assert.equal(f.counts.clicks,0);assert.equal(f.counts.changed,1);
  f.send('pointerdown');f.send('pointermove',{clientX:350});f.stage.dispatchEvent(new Event('scene-ready'));f.send('pointerup',{clientX:350});assert.equal(f.counts.changed,2);assert.equal(f.counts.clicks,0);f.input.dispose();
});
