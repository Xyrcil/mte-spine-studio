import {selectAsset} from './select_asset.mjs';
import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';

const {browser,close}=await launchTestBrowser('chromium');
const bundle=process.argv[2]||'Spines/painting/301500101_spine';
try{
  const page=await browser.newPage({viewport:{width:1600,height:1200}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);await page.locator('#pause').click();
  await selectAsset(page,bundle);await page.waitForFunction(bundle=>window.mteStudio.groups[0]?.presentation.id===bundle,bundle);
  const result=await page.evaluate(async()=>{
    const stage=window.mteStudio,group=stage.groups[0],catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries;
    const pixels=()=>{stage.draw();const result=new Uint8Array(stage.canvas.width*stage.canvas.height*4);stage.gl.readPixels(0,0,stage.canvas.width,stage.canvas.height,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,result);return result;};
    stage.evaluate(1);const withEffects=pixels(),before=stage.snapshot();
    for(const effect of group.effects)effect.reason='test';const plain=pixels();for(const effect of group.effects)effect.reason=undefined;
    const difference=withEffects.reduce((sum,value,index)=>sum+Number(value!==plain[index]),0);
    for(let i=0;i<100;i++){stage.evaluate(0);stage.draw();}const frozen=JSON.stringify(stage.snapshot())===JSON.stringify(before);
    stage.evaluate(.5);await stage.restore(before,catalog,entries);const restored=pixels(),equal=restored.every((value,index)=>value===withEffects[index]);
    const saved=stage.snapshot(),bad=structuredClone(saved);bad.objects[0].effects[0].state.clock=NaN;let rejected=false;try{await stage.restore(bad,catalog,entries);}catch{rejected=true;}
    const preserved=JSON.stringify(stage.snapshot())===JSON.stringify(saved);
    const {exportMedia,RenderSession}=await import('/src/engine/export.js'),{exportPlan}=await import('/src/engine/export-plan.js');
    const settings={format:'png',width:stage.canvas.width,height:stage.canvas.height,scale:1,fps:30,speed:1,start:0,end:1,loops:1,loopMode:'repeat',fade:.2,background:stage.background,transparent:false,fit:'contain',crop:{x:0,y:0,width:1,height:1}};
    const output=await exportMedia({scene:saved,catalog,entries,imageAssets:stage.imageAssets,sourceAspect:stage.canvas.width/stage.canvas.height,settings});
    const verificationWarning=output.warnings.some(warning=>warning.includes('visual verification'));
    const bitmap=await createImageBitmap(output.blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();const png=ctx.getImageData(0,0,canvas.width,canvas.height).data;let exportError=0;
    const reference=new RenderSession(saved,catalog,entries,stage.imageAssets,stage.canvas.width/stage.canvas.height,{...exportPlan(settings,saved.speed),supersampling:true});
    try{await reference.initialize();await reference.seek(0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingQuality='high';ctx.drawImage(reference.canvas,0,0,canvas.width,canvas.height);const expected=ctx.getImageData(0,0,canvas.width,canvas.height).data;for(let i=0;i<png.length;i++)exportError=Math.max(exportError,Math.abs(png[i]-expected[i]));}finally{reference.dispose();}
    let cropError=0;
    if(group.effects.some(effect=>effect.maskedProfile)){
      const width=Math.floor(stage.canvas.width/2),cropped=await exportMedia({scene:saved,catalog,entries,imageAssets:stage.imageAssets,sourceAspect:stage.canvas.width/stage.canvas.height,settings:{...settings,width,crop:{x:0,y:0,width:width/stage.canvas.width,height:1}}}),bitmap=await createImageBitmap(cropped.blob),cropCanvas=document.createElement('canvas');cropCanvas.width=bitmap.width;cropCanvas.height=bitmap.height;const context=cropCanvas.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();const data=context.getImageData(0,0,width,cropCanvas.height).data;
      for(let y=0;y<cropCanvas.height;y++)for(let x=2;x<width-2;x++)for(let c=0;c<4;c++)cropError=Math.max(cropError,Math.abs(data[(y*width+x)*4+c]-png[(y*canvas.width+x)*4+c]));
    }
    const session=new RenderSession(saved,catalog,entries,stage.imageAssets,stage.canvas.width/stage.canvas.height,exportPlan(settings,saved.speed));let sessionError=0;
    try{await session.initialize();await session.seek(0);const data=new Uint8Array(restored.length);session.stage.gl.readPixels(0,0,session.canvas.width,session.canvas.height,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,data);for(let i=0;i<data.length;i++)sessionError=Math.max(sessionError,Math.abs(data[i]-restored[i]));}finally{session.dispose();}
    return {difference,frozen,equal,rejected,preserved,exportError,cropError,sessionError,verificationWarning,glError:stage.gl.getError(),minAlpha:restored.reduce((min,value,index)=>index%4===3?Math.min(min,value):min,255),effects:group.effects.length,counts:group.effects.map(effect=>effect.model.view().length)};
  });
  assert.equal(result.effects,bundle==='Spines/painting/3016009_spine'?1:2);assert.ok(result.difference>100,JSON.stringify(result));assert.equal(result.frozen,true);assert.equal(result.equal,true);assert.equal(result.rejected,true);assert.equal(result.preserved,true);assert.ok(result.exportError<=1,JSON.stringify(result));assert.ok(result.cropError<=2,JSON.stringify(result));assert.deepEqual(errors,[]);
  assert.equal(result.verificationWarning,bundle==='Spines/painting/3016009_spine');assert.equal(result.glError,0);
  await page.evaluate(()=>{const stage=window.mteStudio;stage.draw();window.particleRecovery={snapshot:stage.snapshot(),pixels:new Uint8Array(stage.canvas.width*stage.canvas.height*4),extension:stage.gl.getExtension('WEBGL_lose_context')};stage.gl.readPixels(0,0,stage.canvas.width,stage.canvas.height,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,window.particleRecovery.pixels);if(!window.particleRecovery.extension)throw new Error('Context loss extension unavailable');window.particleRecovery.extension.loseContext();});
  await page.waitForFunction(()=>window.mteStudio.contextLost&&window.mteStudio.recoveryPending);
  assert.equal(await page.evaluate(()=>JSON.stringify(window.mteStudio.snapshot())===JSON.stringify(window.particleRecovery.snapshot)),true);
  await page.evaluate(()=>window.particleRecovery.extension.restoreContext());await page.waitForFunction(()=>!window.mteStudio.recoveryPending,null,{timeout:30000});
  const recovery=await page.evaluate(()=>{const stage=window.mteStudio;stage.draw();const pixels=new Uint8Array(window.particleRecovery.pixels.length);stage.gl.readPixels(0,0,stage.canvas.width,stage.canvas.height,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,pixels);return {state:JSON.stringify(stage.snapshot())===JSON.stringify(window.particleRecovery.snapshot),pixels:pixels.every((value,index)=>value===window.particleRecovery.pixels[index])};});
  assert.deepEqual(recovery,{state:true,pixels:true});assert.equal(result.sessionError,0);assert.equal(result.minAlpha,255);assert.deepEqual(errors,[]);
  await page.getByRole('button',{name:'Studio',exact:true}).click();await page.getByRole('button',{name:'Duplicate',exact:true}).click();await page.waitForFunction(()=>window.mteStudio.groups.length===2);
  const duplicate=await page.evaluate(()=>{const [original,copy]=window.mteStudio.groups;return {offset:copy.x-original.x,separate:original.effects.every((effect,index)=>effect.model!==copy.effects[index].model),particles:original.effects.every((effect,index)=>{const a=effect.model.snapshot(),b=copy.effects[index].model.snapshot();return a.seed===b.seed&&a.state.particles.every((particle,i)=>Math.abs(b.state.particles[i].position[0]-particle.position[0]-1)<1e-9&&b.state.particles[i].position[1]===particle.position[1]);})};});assert.deepEqual(duplicate,{offset:1,separate:true,particles:true});assert.deepEqual(errors,[]);
  console.log('Native particle rendering checks passed: real sprite pixels, pause, exact restore, invalid checkpoint safety, export parity and context recovery',result,recovery);
}finally{await close();}
