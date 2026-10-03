import {selectAsset} from './select_asset.mjs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';

const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteHost?.getState().ready&&!window.mteEditor.busy);await page.evaluate(()=>window.mteHost.pause());
  await selectAsset(page,'Spines/ui/Onsen');try{await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/ui/Onsen'&&!window.mteEditor.busy);}catch(error){throw new Error(`${error.message}: ${await page.locator('#status').textContent()}`);}
  assert.doesNotMatch(await page.locator('#details').textContent(),/Additional effects unavailable:/);
  const result=await page.evaluate(async()=>{
    const stage=window.mteStudio,group=stage.groups[0],catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries;
    const pixels=()=>{stage.draw();const data=new Uint8Array(stage.canvas.width*stage.canvas.height*4);stage.gl.readPixels(0,0,stage.canvas.width,stage.canvas.height,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,data);return data;};
    stage.evaluate(1.25);const original=pixels(),saved=stage.snapshot(),times=group.nativeAnimations.map(native=>native.model.time);
    for(const image of group.nativeImages)image.used=false;const plain=pixels();for(const image of group.nativeImages)image.used=true;
    const difference=original.reduce((sum,value,index)=>sum+Number(value!==plain[index]),0);
    for(let i=0;i<100;i++){stage.evaluate(0);stage.draw();}const frozen=JSON.stringify(stage.snapshot())===JSON.stringify(saved);
    stage.evaluate(.713);await stage.restore(saved,catalog,entries);const restored=pixels(),equal=restored.every((value,index)=>value===original[index]);
    const bad=structuredClone(saved);bad.objects[0].nativeAnimations[0].clip='missing';let rejected=false;try{await stage.restore(bad,catalog,entries);}catch{rejected=true;}
    const preserved=JSON.stringify(stage.snapshot())===JSON.stringify(saved),legacy=structuredClone(saved);delete legacy.objects[0].nativeAnimations;await stage.restore(legacy,catalog,entries);const legacyReset=stage.groups[0].nativeAnimations.every(native=>native.model.time===0);await stage.restore(saved,catalog,entries);
    const {exportMedia,RenderSession}=await import('/src/engine/export.js'),{exportPlan}=await import('/src/engine/export-plan.js');
    const settings={format:'png',width:stage.canvas.width,height:stage.canvas.height,scale:1,fps:30,speed:1,start:0,end:1,loops:1,loopMode:'repeat',fade:.2,background:stage.background,transparent:false,fit:'contain',crop:{x:0,y:0,width:1,height:1}};
    const output=await exportMedia({scene:saved,catalog,entries,imageAssets:stage.imageAssets,sourceAspect:stage.canvas.width/stage.canvas.height,settings}),bitmap=await createImageBitmap(output.blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();const png=ctx.getImageData(0,0,canvas.width,canvas.height).data;let exportError=0;
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)for(let c=0;c<4;c++)exportError=Math.max(exportError,Math.abs(png[(y*canvas.width+x)*4+c]-original[((canvas.height-y-1)*canvas.width+x)*4+c]));
    const session=new RenderSession(saved,catalog,entries,stage.imageAssets,stage.canvas.width/stage.canvas.height,exportPlan(settings,saved.speed));let seekEqual=false;
    try{await session.initialize();await session.seek(.713);await session.seek(0);const data=new Uint8Array(original.length);session.stage.gl.readPixels(0,0,session.canvas.width,session.canvas.height,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,data);seekEqual=data.every((value,index)=>value===original[index]);}finally{session.dispose();}
    window.nativeRecovery={saved,pixels:original};return {difference,frozen,equal,rejected,preserved,legacyReset,exportError,seekEqual,times};
  });
  assert.ok(result.difference>100);for(const key of ['frozen','equal','rejected','preserved','seekEqual','legacyReset'])assert.equal(result[key],true,JSON.stringify(result));assert.ok(result.exportError<=1,JSON.stringify(result));assert.deepEqual(result.times,[1.25,0]);
  await page.evaluate(()=>{window.nativeRecovery.extension=window.mteStudio.gl.getExtension('WEBGL_lose_context');window.nativeRecovery.extension.loseContext();});await page.waitForFunction(()=>window.mteStudio.contextLost&&window.mteStudio.recoveryPending);await page.evaluate(()=>window.nativeRecovery.extension.restoreContext());await page.waitForFunction(()=>!window.mteStudio.recoveryPending,null,{timeout:30000});
  const recovered=await page.evaluate(()=>{const stage=window.mteStudio;stage.draw();const data=new Uint8Array(window.nativeRecovery.pixels.length);stage.gl.readPixels(0,0,stage.canvas.width,stage.canvas.height,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,data);return JSON.stringify(stage.snapshot())===JSON.stringify(window.nativeRecovery.saved)&&data.every((value,index)=>value===window.nativeRecovery.pixels[index]);});assert.equal(recovered,true);assert.deepEqual(errors,[]);
  await page.getByRole('button',{name:'Studio',exact:true}).click();await page.getByRole('button',{name:'Duplicate',exact:true}).click();await page.waitForFunction(()=>window.mteStudio.groups.length===2);
  const isolated=await page.evaluate(()=>{const [a,b]=window.mteStudio.groups,original=a.nativeAnimations[0].model.snapshot();b.nativeAnimations[0].model.advance(.1);return JSON.stringify(a.nativeAnimations[0].model.snapshot())===JSON.stringify(original)&&a.nodes.get(a.nativeImages[0].source.transform)!==b.nodes.get(b.nativeImages[0].source.transform)&&a.nativeImages[0].color!==b.nativeImages[0].color;});assert.equal(isolated,true);assert.deepEqual(errors,[]);
  console.log('Native smoke checks passed: source curves, inactive hierarchy, pause, exact restore, legacy scenes, invalid source safety, PNG parity, backward seeking, context recovery and duplicate isolation',result);
}finally{await browser.close();}
