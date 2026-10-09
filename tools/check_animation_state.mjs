import {selectAsset} from './select_asset.mjs';
import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';
const {browser,close}=await launchTestBrowser('chromium');
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length>0);
  await selectAsset(page,'Spines/painting/301619402_spine');await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/painting/301619402_spine');
  const result=await page.evaluate(async()=>{
    const {Stage}=await import('/src/engine/stage.js'),{RenderSession}=await import('/src/engine/export.js'),{exportPlan}=await import('/src/engine/export-plan.js');
    const original=window.mteStudio;original.paused=true;const group=original.groups[0],root=group.controllers[0];root.click(root.hotspots.find(hit=>hit.name==='HitArea_anim_anim2'));original.evaluate(.06);original.draw();
    const scene=original.snapshot(),catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries;
    const canvas=document.createElement('canvas');canvas.width=original.canvas.width;canvas.height=original.canvas.height;const clone=new Stage(canvas,{manual:true});clone.imageAssets=original.imageAssets;
    let sounds=0;clone.addEventListener('sound-request',()=>sounds++);await clone.restore(scene,catalog,entries);
    const bones=stage=>stage.groups[0].layers.flatMap(layer=>layer.skeleton.bones.flatMap(bone=>[bone.worldX,bone.worldY,bone.a,bone.b,bone.c,bone.d]));
    const pixels=stage=>{const bytes=new Uint8Array(stage.canvas.width*stage.canvas.height*4);stage.gl.readPixels(0,0,stage.canvas.width,stage.canvas.height,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,bytes);return bytes;};
    const before=pixels(original),after=pixels(clone);let pixelError=0;for(let i=0;i<before.length;i++)pixelError=Math.max(pixelError,Math.abs(before[i]-after[i]));
    const a=bones(original),b=bones(clone);let error=Math.max(...a.map((value,index)=>Math.abs(value-b[index]))),futureError=0;
    for(let step=0;step<60;step++){original.evaluate(1/120);clone.evaluate(1/120);const a=bones(original),b=bones(clone);futureError=Math.max(futureError,...a.map((value,index)=>Math.abs(value-b[index])));}
    await original.restore(scene,catalog,entries);const beforePause=JSON.stringify(original.snapshot());for(let i=0;i<120;i++)original.evaluate(0);const frozen=beforePause===JSON.stringify(original.snapshot());
    const plan=exportPlan({format:'png',width:original.canvas.width,height:original.canvas.height,scale:1,fps:30,start:0,end:1,speed:1,loops:1,loopMode:'repeat',fit:'contain',crop:{x:0,y:0,width:1,height:1},background:scene.background},scene.speed);
    const session=new RenderSession(scene,catalog,entries,original.imageAssets,original.canvas.width/original.canvas.height,plan);await session.initialize();await session.seek(0);const exported=pixels(session.stage);let exportPixelError=0;for(let i=0;i<before.length;i++)exportPixelError=Math.max(exportPixelError,Math.abs(before[i]-exported[i]));session.dispose();clone.dispose();clone.gl.getExtension('WEBGL_lose_context')?.loseContext();
    const invalid=structuredClone(scene);invalid.objects[0].x=999;invalid.objects[0].layers[0].animationState.entries.at(-1).name='Unavailable animation';let rejected=false;try{await original.restore(invalid,catalog,entries);}catch{rejected=true;}
    return {mixEntries:scene.objects[0].layers.map(layer=>layer.animationState.entries.length),error,futureError,pixelError,exportPixelError,frozen,sounds,rejected,originalX:original.groups[0].x};
  });console.log(result);assert.ok(result.mixEntries.every(count=>count>=2));assert.ok(result.error<1e-8&&result.futureError<1e-8);assert.equal(result.pixelError,0);assert.equal(result.exportPixelError,0);assert.equal(result.frozen,true);assert.equal(result.sounds,0);assert.equal(result.rejected,true);assert.equal(result.originalX,0);assert.deepEqual(errors,[]);
}finally{await close();}
