import assert from 'node:assert/strict';
import {chromium,webkit} from '@playwright/test';
const engine=process.argv[2]||'chromium',type={chromium,webkit}[engine];assert.ok(type,'Choose chromium or webkit');
const browser=await type.launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
try{
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
  const result=await page.evaluate(async()=>{
    const {Stage}=await import('/src/engine/stage.js'),catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries,source=catalog.find(row=>row.id==='Spines/ui/fight'),canvas=document.createElement('canvas');canvas.width=800;canvas.height=480;document.body.append(canvas);const stage=new Stage(canvas,{manual:true});
    try{
      const original=await stage.add(source,entries.filter(row=>row.bundle===source.id));if(original.nativeTextLayer.reason||original.nativeTextLayer.slots.length!==4)throw new Error('Original text fields did not initialize');if(original.nativeTextLayer.slots.filter(slot=>slot.gradient&&slot.reason).length!==1)throw new Error('Source vertex-gradient limitation was hidden');if(original.nativeTextLayer.slots.some(slot=>slot.used)||original.nativeAnimations.some(row=>row.model))throw new Error('Incomplete skill display was enabled');stage.remove(original.id);
      // Exercise the recovered text channels independently; source event handling is still unavailable.
      const presentation=structuredClone(source),clip=presentation.visualAnimations.find(row=>row.type==='AnimationClip'),textScripts=new Set(presentation.nativeText.map(row=>row.data.m_Script.m_PathID));clip.data.m_Events=[];clip.data.m_WrapMode=2;clip.data.m_ScaleCurves=[];clip.data.m_FloatCurves=clip.data.m_FloatCurves.filter(row=>row.classID===225||row.attribute==='spacing_x'||textScripts.has(row.script?.m_PathID));
      const group=await stage.add(presentation,entries.filter(row=>row.bundle===source.id)),model=group.nativeAnimations[0].model;if(!model)throw new Error(group.nativeAnimations[0].reason);stage.paused=true;stage.camera={x:-200,y:0,width:1200,height:720};stage.evaluate(.4);
      const pixels=()=>{stage.draw();const result=new Uint8Array(canvas.width*canvas.height*4);stage.gl.readPixels(0,0,canvas.width,canvas.height,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,result);return result;},shown=pixels(),saved=stage.snapshot(),slots=group.nativeTextLayer.slots.filter(slot=>slot.used);
      for(const slot of slots)slot.used=false;const hidden=pixels();for(const slot of slots)slot.used=true;const changed=shown.reduce((n,value,i)=>n+Number(value!==hidden[i]),0);for(let i=0;i<20;i++)stage.evaluate(0);if(JSON.stringify(stage.snapshot())!==JSON.stringify(saved))throw new Error('Paused text advanced');
      stage.evaluate(.2);await stage.restore(saved,[presentation],entries);const restored=pixels().every((value,i)=>value===shown[i]);
      const {exportMedia}=await import('/src/engine/export.js'),output=await exportMedia({scene:saved,catalog:[presentation],entries,imageAssets:stage.imageAssets,sourceAspect:canvas.width/canvas.height,settings:{format:'png',width:800,height:480,fps:30,start:0,end:1,speed:1,loops:1,loopMode:'repeat',background:stage.background,fit:'contain',crop:{x:0,y:0,width:1,height:1}}}),bitmap=await createImageBitmap(output.blob),image=document.createElement('canvas');image.width=800;image.height=480;const ctx=image.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();const png=ctx.getImageData(0,0,800,480).data;let exportError=0;for(let y=0;y<480;y++)for(let x=0;x<800;x++)for(let c=0;c<4;c++)exportError=Math.max(exportError,Math.abs(png[(y*800+x)*4+c]-shown[((479-y)*800+x)*4+c]));
      return {slots:slots.length,changed,restored,exportError};
    }finally{stage.dispose();canvas.remove();}
  });
  assert.ok(result.slots>=2);assert.ok(result.changed>100);assert.equal(result.restored,true);assert.ok(result.exportError<=1,JSON.stringify(result));assert.deepEqual(errors,[]);console.log(engine+': original native text channel rendering, pause, restore and PNG parity passed',result);
}finally{await browser.close();}
