import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';

for(const engine of process.argv.slice(2).length?process.argv.slice(2):['chromium','firefox','webkit']){
  const {browser,close}=await launchTestBrowser(engine);
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(process.env.MTE_TEST_URL||'http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
    const results=await page.evaluate(async()=>{
      const {Stage}=await import('/src/engine/stage.js');
      const [catalog,runtime]=await Promise.all(['presentations.json','runtime-index.json'].map(name=>fetch('/assets/'+name).then(response=>response.json())));
      const results=[];let preview;
      const differences=(a,b,path='',out=[])=>{
        if(Object.is(a,b))return out;
        if(a&&b&&typeof a==='object'&&typeof b==='object'){
          for(const key of new Set([...Object.keys(a),...Object.keys(b)]))differences(a[key],b[key],`${path}/${key}`,out);
        }else if(out.length<12)out.push({path,before:a,after:b});return out;
      };
      for(const presentation of catalog.presentations.filter(row=>row.controllers.length&&row.instances.some(layer=>layer.active===false))){
        const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const stage=new Stage(canvas,{manual:true});
        try{
          let group=await stage.add(presentation,runtime.entries.filter(row=>row.bundle===presentation.id));
          const source=group.layers.map(layer=>({id:layer.instance.id,active:layer.active})),hidden=source.filter(layer=>!layer.active);
          const configurations=[source,...hidden.map(layer=>source.map(row=>({...row,active:row.active||row.id===layer.id}))),...hidden.map(layer=>source.map(row=>({...row,active:row.id===layer.id}))),source.map(row=>({...row,active:true}))];
          for(const configuration of configurations){
            for(const row of configuration)stage.setLayerActive(group,row.id,row.active);
            for(let step=0;step<30;step++)stage.evaluate(1/120);
            stage.draw();const scene=stage.snapshot(),image=canvas.toDataURL(),primary=group.controllers[0].primary?.instance.id;
            if(presentation.id==='Spines/painting/301600905_spine'&&!preview)preview=scene;
            const inactive=group.controllers[0].hotspots.filter(hit=>!group.isActiveTransform(hit.transform)).map(hit=>hit.id);
            await stage.restore(scene,catalog.presentations,runtime.entries);group=stage.groups[0];
            const restored=stage.snapshot(),diff=differences(scene,restored),sameScene=diff.length===0,sameImage=canvas.toDataURL()===image;
            const finite=group.layers.every(layer=>layer.skeleton.bones.every(bone=>['worldX','worldY','a','b','c','d'].every(key=>Number.isFinite(bone[key]))));
            results.push({bundle:presentation.id,active:configuration.filter(row=>row.active).map(row=>row.id),primary,restoredPrimary:group.controllers[0].primary?.instance.id,sameScene,diff,sameImage,finite,inactivePreserved:JSON.stringify(inactive)===JSON.stringify(group.controllers[0].hotspots.filter(hit=>!group.isActiveTransform(hit.transform)).map(hit=>hit.id))});
          }
        }finally{stage.dispose();stage.gl.getExtension('WEBGL_lose_context')?.loseContext();}
      }
      await window.mteStudio.restore({...preview,paused:true},catalog.presentations,runtime.entries);const selected=window.mteStudio.groups[0];window.mteEditor.choose(selected);
      const details=document.querySelector('#details').textContent,hiddenLayer=selected.layers.find(layer=>layer.authoredActive===false);
      const checkbox=[...document.querySelectorAll('#layers label')].find(label=>label.textContent.includes(hiddenLayer.instance.id))?.querySelector('input[type="checkbox"]');
      if(!checkbox)throw new Error('Optional layer control missing');checkbox.click();
      return {silent:window.__mteSilentTest,results,details,optionalControlWorks:hiddenLayer.active===true,updatedDetails:document.querySelector('#details').textContent};
    });
    assert.deepEqual(errors,[]);assert.equal(results.silent,true);assert.ok(results.results.length>0);
    assert.ok(results.details.includes('13 interaction regions disabled in the source configuration'));assert.equal(results.optionalControlWorks,true);assert.ok(results.updatedDetails.includes('13 interaction regions disabled in the source configuration'));
    for(const row of results.results){assert.equal(row.sameScene,true,JSON.stringify(row));assert.equal(row.sameImage,true,JSON.stringify(row));assert.equal(row.finite,true,JSON.stringify(row));assert.equal(row.primary,row.restoredPrimary,JSON.stringify(row));assert.equal(row.inactivePreserved,true,JSON.stringify(row));}
    console.log(engine,JSON.stringify({bundles:new Set(results.results.map(row=>row.bundle)).size,configurations:results.results.length,exactRestores:true}));
  }finally{await close();}
}
