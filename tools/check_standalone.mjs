import {selectAsset} from './select_asset.mjs';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {launchTestBrowser} from './test_browser.mjs';
const engine=process.argv.slice(2).find(arg=>!arg.startsWith('--'))||'chromium';
const all=process.argv.includes('--all'),{browser,close}=await launchTestBrowser(engine);
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length>0);
  await page.locator('#category').selectOption('story');assert.equal(await page.locator('#library-count').textContent(),'244 artwork entries');assert.equal(await page.locator('#assets [data-asset]').count(),24);
  await selectAsset(page,'Spines/story/gelei');await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/story/gelei');
  assert.equal(await page.locator('#animation-preview').inputValue(),'stand');
  await page.locator('#animation-preview').selectOption('weixiao');assert.equal(await page.evaluate(()=>window.mteStudio.groups[0].layers[0].state.getCurrent(0).animation.name),'weixiao');
  await page.waitForTimeout(400);await page.screenshot({path:'private/browser-story.png'});
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  const result=await page.evaluate(async()=>{
    const stage=window.mteStudio,presentations=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries;
    const standalone=presentations.filter(p=>p.standalone),failures=[];let loaded=0;
    for(const presentation of standalone){
      for(const group of [...stage.groups])stage.remove(group.id);
      try{await stage.add(presentation,entries.filter(entry=>entry.bundle===presentation.id));stage.evaluate(1/30);stage.draw();const error=stage.gl.getError();if(error!==stage.gl.NO_ERROR)throw new Error(`WebGL error ${error}`);loaded++;}
      catch(error){failures.push({id:presentation.id,error:error.message});}
    }
    return {expected:standalone.length,loaded,failures};
  });console.log(result);assert.deepEqual(result.failures,[]);assert.equal(result.loaded,275);
  if(all){
    page.on('console',message=>{if(message.text().startsWith('Library rendering:'))console.log(message.text());});
    const library=await page.evaluate(async()=>{
      const {Stage}=await import('/src/engine/stage.js'),catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries;
      const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;
      const stage=new Stage(canvas,{manual:true,transparent:true}),failures=[],covered=new Set();let loaded=0,processed=0,layers=0,animations=0,poses=0,variants=0,extraSamples=0;
      const pixels=new Uint8Array(canvas.width*canvas.height*4),empty=[],brieflyVisible=[];
      const draw=()=>{stage.fit();stage.draw();const error=stage.gl.getError();if(error!==stage.gl.NO_ERROR)throw new Error('WebGL error '+error);stage.gl.readPixels(0,0,canvas.width,canvas.height,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,pixels);};
      try{
        for(const presentation of catalog){
          let group;
          try{
            stage.suppressEvents=false;
            group=await stage.add(presentation,entries.filter(entry=>entry.bundle===presentation.id));
            stage.evaluate(1/30);draw();loaded++;
            stage.suppressEvents=true;
            const effects=group.effects;group.effects=[];
            for(const image of group.nativeImages||[])image.used=false;
            for(const slot of group.nativeTextLayer?.slots||[])slot.used=false;
            for(const layer of group.layers){
              layers++;covered.add(presentation.id+'\0'+layer.entry.id);
              for(const member of group.layers)member.active=member===layer;
              const data=layer.skeleton.data,skinNames=data.skins.map(skin=>skin.name);
              for(const skinName of skinNames.length?skinNames:[null]){
                layer.skeleton.setSkin(skinName?data.findSkin(skinName):null);variants++;
                for(const animation of data.animations){
                  animations++;
                  const state=new window.spine.AnimationState(new window.spine.AnimationStateData(data));state.setAnimation(0,animation.name,false);
                  let previous=0,visible=false,drawableSamples=0,maxAlpha=0;
                  const sample=time=>{
                    layer.skeleton.setToSetupPose();state.update(time-previous);state.apply(layer.skeleton);previous=time;
                    stage.transformLayer(group,layer);
                    if(layer.skeleton.bones.some(bone=>![bone.a,bone.b,bone.c,bone.d,bone.worldX,bone.worldY].every(Number.isFinite)))throw new Error('Non-finite pose: '+layer.entry.id+' / '+animation.name);
                    for(const slot of layer.skeleton.slots){const attachment=slot.attachment;if(slot.bone.active&&(attachment instanceof window.spine.RegionAttachment||attachment instanceof window.spine.MeshAttachment)){drawableSamples++;maxAlpha=Math.max(maxAlpha,slot.color.a*attachment.color.a*layer.skeleton.color.a);}}
                    draw();poses++;return pixels.some((value,index)=>index%4===3&&value!==0);
                  };
                  for(const time of [0,animation.duration/2,Math.max(0,animation.duration-1e-5)]){
                    const shown=sample(time);visible ||= shown;
                  }
                  const row={bundle:presentation.id,skeleton:layer.entry.id,skin:skinName,animation:animation.name};
                  if(!visible){
                    const keys=new Set([0,animation.duration]);
                    for(const timeline of animation.timelines){const frames=timeline.frames;if(!frames?.length)continue;const count=timeline.getFrameCount?.()||frames.length,stride=frames.length/count;if(!Number.isInteger(stride))throw new Error('Invalid timeline frame layout');for(let index=0;index<frames.length;index+=stride)keys.add(frames[index]);}
                    const times=[...keys].filter(time=>Number.isFinite(time)&&time>=0&&time<=animation.duration).sort((a,b)=>a-b),samples=new Set(times);
                    for(let index=1;index<times.length;index++)samples.add((times[index-1]+times[index])/2);
                    state.clearTracks();state.setAnimation(0,animation.name,false);previous=0;
                    let checked=0;
                    for(const time of [...samples].sort((a,b)=>a-b)){checked++;extraSamples++;if(sample(time)){visible=true;brieflyVisible.push({...row,time,keySamples:checked});break;}}
                    if(!visible)empty.push({...row,keySamples:checked,maxAlpha,reason:!drawableSamples?'no-drawable-attachments':maxAlpha===0?'source-alpha-zero':'sampled-no-pixels'});
                  }
                }
              }
            }
            group.effects=effects;
          }catch(error){failures.push({id:presentation.id,error:error.message});}
          finally{if(group)stage.remove(group.id);}
          processed++;if(processed%16===0)console.log('Library rendering: '+processed+'/'+catalog.length+' presentations, '+poses+' sampled poses');
        }
        return {expected:catalog.length,loaded,layers,animations,poses,extraSamples,variants,brieflyVisible,unassignedTemplates:catalog.filter(row=>!row.instances.length&&row.unassignedInstances?.length).map(row=>row.id),unreferenced:entries.filter(entry=>!covered.has(entry.bundle+'\0'+entry.id)).map(entry=>({bundle:entry.bundle,id:entry.id})),empty,failures};
      }finally{stage.dispose();}
    });
    await writeFile('private/library-rendering-'+engine+'.json',JSON.stringify(library,null,2));
    console.log(engine+' full library rendering',{...library,brieflyVisible:library.brieflyVisible.length,empty:library.empty.length,emptyReasons:library.empty.reduce((counts,row)=>(counts[row.reason]=(counts[row.reason]||0)+1,counts),{})});assert.deepEqual(library.failures,[]);assert.equal(library.loaded,library.expected);assert.deepEqual(library.unreferenced,[]);assert.equal(library.poses,library.animations*3+library.extraSamples);
  }
  assert.deepEqual(errors,[]);
}finally{await close();}
