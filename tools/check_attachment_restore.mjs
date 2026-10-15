import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {launchTestBrowser} from './test_browser.mjs';
const engine=process.argv[2]||'chromium',{browser,close}=await launchTestBrowser(engine);
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
  const results=await page.evaluate(async()=>{
    const {Stage}=await import('/src/engine/stage.js'),{invalidControllerPose}=await import('/tools/controller_pose.mjs'),catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries,rows=[];
    const canonical=value=>JSON.stringify(value,(_key,current)=>current&&typeof current==='object'&&!Array.isArray(current)?Object.fromEntries(Object.entries(current).sort(([a],[b])=>a.localeCompare(b))):current);
    for(const name of ['301619101','301600901','301601601','301602402']){
      const source=catalog.find(row=>row.id===`Spines/painting/${name}_spine`),make=()=>{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;return new Stage(canvas,{manual:true});},stage=make(),clone=make();
      try{
        stage.paused=true;const group=await stage.add(source,entries.filter(row=>row.bundle===source.id)),saved=stage.snapshot(),root=group.controllers[0];let omitted=0,historyActions=0,historyFrames=0;
        for(let action=0;action<3;action++){
          let accepted=false;for(const hit of root.hotspots){if(!hit.event||hit.enabled===0||hit.enabled===false||!group.isActiveTransform(hit.transform)||!root.layers.some(layer=>layer.skeleton.data.findAnimation(root.animationRequest(hit).name)))continue;if(stage.triggerInteraction(group.id,root.source.id,hit.id).accepted){accepted=true;break;}}
          if(!accepted)throw Error('Source history command is unavailable');historyActions++;for(let frame=0;frame<3600&&(root.value.playing||root.value.tasks.length);frame++){stage.evaluate(1/120);historyFrames++;if(invalidControllerPose(group).length)throw Error('Invalid history pose');}if(root.value.playing||root.value.tasks.length)throw Error('History command remained locked');
        }
        for(const layer of group.layers){const pose=saved.objects[0].layers.find(row=>row.id===layer.instance.id).pose;for(let index=0;index<pose.slots.length;index++)if(pose.slots[index].attachmentState===undefined){layer.skeleton.slots[index].attachmentState=layer.state.unkeyedState+1;omitted++;}}
        if(!omitted)throw Error('Source fixture has no omitted attachment cursor');await stage.restore(saved,catalog,entries);if(canonical(stage.snapshot())!==canonical(saved))throw Error('Prior attachment cursors leaked into the restored scene');await clone.restore(saved,catalog,entries);
        const events=[[],[]];for(const [index,target]of [stage,clone].entries())for(const type of ['animation-event','interaction-change','sound-request','effect-request','voice-request'])target.addEventListener(type,event=>events[index].push({type,detail:event.detail}));
        let interaction;
        for(const hit of root.hotspots){if(!hit.event||hit.enabled===0||hit.enabled===false||!group.isActiveTransform(hit.transform)||!root.layers.some(layer=>layer.skeleton.data.findAnimation(root.animationRequest(hit).name)))continue;const result=stage.triggerInteraction(group.id,root.source.id,hit.id);if(!result.accepted)continue;const other=clone.triggerInteraction(group.id,root.source.id,hit.id);if(!other.accepted||other.animation!==result.animation)throw Error('Restored command differs from a fresh player');interaction=result.animation;break;}
        if(!interaction)throw Error('Source fixture has no executable interaction');
        const matrices=target=>target.groups[0].layers.flatMap(layer=>layer.skeleton.bones.flatMap(bone=>[bone.a,bone.b,bone.c,bone.d,bone.worldX,bone.worldY]));
        const attachments=target=>target.groups[0].layers.map(layer=>layer.skeleton.slots.map(slot=>slot.getAttachment()?.name||null));
        const pixels=target=>{target.draw();const values=new Uint8Array(320*240*4);target.gl.readPixels(0,0,320,240,target.gl.RGBA,target.gl.UNSIGNED_BYTE,values);if(target.gl.getError())throw Error('Rendering error');return values;};
        let boneError=0,pixelError=0;
        for(let frame=0;frame<=60;frame++){
          if(frame){stage.evaluate(1/120);clone.evaluate(1/120);}if(invalidControllerPose(stage.groups[0]).length||invalidControllerPose(clone.groups[0]).length)throw Error('Non-finite restored pose');
          const left=matrices(stage),right=matrices(clone);for(let index=0;index<left.length;index++)boneError=Math.max(boneError,Math.abs(left[index]-right[index]));if(JSON.stringify(attachments(stage))!==JSON.stringify(attachments(clone)))throw Error('Playback history replaced a restored attachment');
          if(frame%15===0){const a=pixels(stage),b=pixels(clone);for(let index=0;index<a.length;index++)pixelError=Math.max(pixelError,Math.abs(a[index]-b[index]));}
        }
        if(boneError>1e-8||pixelError>1||!events[0].length||JSON.stringify(events[0])!==JSON.stringify(events[1]))throw Error('Restore changed future bone, pixel or event output');rows.push({bundle:source.id,historyActions,historyFrames,omitted,interaction,frames:61,boneError,pixelError,events:events[0].length,pathConstraints:group.layers.reduce((n,layer)=>n+layer.skeleton.pathConstraints.length,0)});
      }finally{for(const target of [stage,clone]){target.dispose();target.gl.getExtension('WEBGL_lose_context')?.loseContext();}}
    }
    return rows;
  });assert.equal(results.length,4);assert.ok(results.some(row=>row.pathConstraints>0));assert.deepEqual(errors,[]);await writeFile(`private/attachment-restore-browser-${engine}.json`,JSON.stringify(results,null,2));console.log(engine+': restored attachment cursors, future bones, attachments, pixels and events passed',results);
}finally{await close();}
