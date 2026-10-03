import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
  const result=await page.evaluate(async()=>{
    const {Stage}=await import('/src/engine/stage.js'),catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries;
    const presentation=catalog.find(row=>row.id==='Spines/painting/301602402_spine'),canvas=document.createElement('canvas');canvas.width=320;canvas.height=192;const stage=new Stage(canvas,{manual:true});
    try{
      const group=await stage.add(presentation,entries),root=group.controllers.find(row=>row.snapshot().kind==='bone-drag');if(!root||!root.source.dragColliders.length)throw new Error('Source drag receiver or collider missing');
      const center={...root.motion.center},left=root.rangePosition(root.left),right=root.rangePosition(root.right),world={x:(left.x+right.x)/2,y:(left.y+right.y)/2};root.begin();if(!root.move(world))throw new Error('Source range did not accept its center');stage.evaluate(0);
      if(!root.members.every(({bone})=>bone.x===root.motion.current.x&&bone.y===root.motion.current.y))throw new Error('Drag pose was overwritten');root.release();stage.evaluate(.2);const saved=stage.snapshot();stage.evaluate(.1);const expected=root.snapshot();
      await stage.restore(saved,[presentation],entries);stage.evaluate(.1);if(JSON.stringify(root.snapshot())!==JSON.stringify(expected))throw new Error('Return motion changed after restore');stage.evaluate(.2);
      if(root.motion.returning||root.motion.current.x!==center.x||root.motion.current.y!==center.y)throw new Error('Return did not reach the source center');stage.draw();
      const bad=structuredClone(saved),state=bad.objects[0].interactions.find(row=>row.id===root.source.id);state.state.motion.elapsed=2;let rejected=false;try{await stage.restore(bad,[presentation],entries);}catch{rejected=true;}if(!rejected)throw new Error('Source-specific duration not validated');
      return {members:root.members.length,colliders:root.source.dragColliders.length,center,left,right};
    }finally{stage.dispose();}
  });assert.deepEqual(errors,[]);console.log('Real source drag: shared pose, dynamic bounds, return and scene restore verified',result);
}finally{await browser.close();}
