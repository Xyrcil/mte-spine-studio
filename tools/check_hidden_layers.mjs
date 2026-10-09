import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';
const engine=process.argv[2]||'chromium',{browser,close}=await launchTestBrowser(engine);
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
  const result=await page.evaluate(async()=>{
    const {Stage}=await import('/src/engine/stage.js'),{exportMedia}=await import('/src/engine/export.js'),catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries,canvas=document.createElement('canvas');canvas.width=320;canvas.height=192;const stage=new Stage(canvas,{manual:true}),checked=[];
    const hasHidden=source=>{const nodes=new Map(source.hierarchy.map(row=>[row.id,row]));return source.instances.some(instance=>{if(instance.active===false)return true;let node=nodes.get(instance.transform),seen=new Set();while(node&&!seen.has(node.id)){seen.add(node.id);if(nodes.get(String(node.data.m_GameObject?.m_PathID))?.data.m_IsActive===false)return true;node=nodes.get(String(node.data.m_Father?.m_PathID));}return false;});};
    try{
      for(const presentation of catalog.filter(hasHidden)){
        const group=await stage.add(presentation,entries.filter(row=>row.bundle===presentation.id));if(group.layers.length!==presentation.instances.length)throw new Error('A source skeleton layer was dropped');const baseline=stage.snapshot(),hidden=group.layers.filter(layer=>!layer.authoredActive);if(hidden.some(layer=>layer.active))throw new Error('Hidden layers became visible by default');
        const target=hidden.find(layer=>layer.instance.name.startsWith('role'))||hidden[0];stage.setLayerActive(group,target.instance.id,true);if(!target.active||group.controllers.some(root=>!root.layers.includes(target)))throw new Error('Selected layer did not bind to its controller');stage.evaluate(.4);stage.fit();stage.draw();
        const saved=stage.snapshot(),shown=new Uint8Array(320*192*4);stage.gl.readPixels(0,0,320,192,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,shown);await stage.restore(baseline,[presentation],entries);if(hidden.some(layer=>layer.active))throw new Error('Layer selection survived restoring source defaults');await stage.restore(saved,[presentation],entries);
        stage.draw();const restored=new Uint8Array(shown.length);stage.gl.readPixels(0,0,320,192,stage.gl.RGBA,stage.gl.UNSIGNED_BYTE,restored);if(!restored.every((value,index)=>value===shown[index]))throw new Error('Selected layer pixels changed on restore');
        const old=structuredClone(baseline);old.objects[0].layers=old.objects[0].layers.filter(row=>group.layers.find(layer=>layer.instance.id===row.id).authoredActive);await stage.restore(old,[presentation],entries);if(hidden.some(layer=>layer.active))throw new Error('Legacy scene enabled an omitted hidden layer');
        const bad=structuredClone(old);bad.objects[0].layers.pop();const before=stage.snapshot();let rejected=false;try{await stage.restore(bad,[presentation],entries);}catch{rejected=true;}if(!rejected||JSON.stringify(stage.snapshot())!==JSON.stringify(before))throw new Error('Missing visible layer changed the editing scene');
        await stage.restore(saved,[presentation],entries);const output=await exportMedia({scene:saved,catalog:[presentation],entries,imageAssets:stage.imageAssets,sourceAspect:320/192,settings:{format:'png',width:320,height:192,fps:30,start:0,end:1,speed:1,loops:1,loopMode:'repeat',background:stage.background,fit:'contain',crop:{x:0,y:0,width:1,height:1}}}),bitmap=await createImageBitmap(output.blob),image=document.createElement('canvas');image.width=320;image.height=192;const context=image.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();const png=context.getImageData(0,0,320,192).data;let exportError=0;for(let y=0;y<192;y++)for(let x=0;x<320;x++)for(let c=0;c<4;c++)exportError=Math.max(exportError,Math.abs(png[(y*320+x)*4+c]-shown[((191-y)*320+x)*4+c]));if(exportError>1)throw new Error('Selected layer PNG differs: '+exportError);
        checked.push({id:presentation.id,layers:group.layers.length,hidden:hidden.length,exportError});stage.remove(group.id);
      }
      return checked;
    }finally{stage.dispose();}
  });assert.ok(result.length>=6);assert.deepEqual(errors,[]);console.log(engine+': all source-hidden layers load, rebind, restore legacy scenes and export PNG',result);
}finally{await close();}
