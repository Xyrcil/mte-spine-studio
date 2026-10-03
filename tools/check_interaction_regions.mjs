import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.text().startsWith('[region-check]'))console.log(message.text());});
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
  const result=await page.evaluate(async()=>{
    const {Stage}=await import('/src/engine/stage.js'),{point,colliderContains}=await import('/src/engine/geometry.js'),catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries;
    const results=[];
    for(const presentation of catalog.filter(row=>row.controllers.some(root=>root.data.m_Enabled!==0&&root.data.m_Enabled!==false))){
      const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const stage=new Stage(canvas,{manual:true});
      try{
        const group=await stage.add(presentation,entries),roots=group.controllers.filter(root=>root.transformBindings),checked=[],occluded=[],inactive=[];
        if(roots.length!==presentation.controllers.filter(root=>root.data.m_Enabled!==0&&root.data.m_Enabled!==false).length)throw new Error('Source controller was not loaded: '+presentation.id);
        let entranceFrames=0;while(entranceFrames<3600&&roots.some(root=>root.primary?.state.getCurrent(0)?.animation.name==='start')){stage.evaluate(1/120);entranceFrames++;}
        if(roots.some(root=>root.primary?.state.getCurrent(0)?.animation.name==='start'))throw new Error('Entrance did not reach idle: '+presentation.id);
        for(const elapsed of [0,.5,.5]){
          Object.assign(group,{x:0,y:0,scale:1,rotation:0,flipX:false,flipY:false});stage.evaluate(elapsed);
          const probes=[];
          for(const root of roots)for(const hit of root.hotspots){
            if(!hit.event||hit.enabled===0||hit.enabled===false||!group.isActiveTransform(hit.transform)){if(!inactive.includes(hit.name))inactive.push(hit.name);continue;}
            const matrix=root.matrix(hit);if(!matrix?.every(Number.isFinite))throw new Error('Non-finite region matrix: '+presentation.id+'/'+hit.name);
            let own=false,samples=0;
            for(const collider of hit.colliders){
              const data=collider.data,offset=data.m_Offset||{x:0,y:0};let bounds;
              if(collider.type==='BoxCollider2D')bounds=[-data.m_Size.x/2,-data.m_Size.y/2,data.m_Size.x/2,data.m_Size.y/2];
              else if(collider.type==='PolygonCollider2D'){const vertices=(data.m_Points?.m_Paths||[]).flat();if(!vertices.length)throw new Error('Empty source polygon');bounds=[Math.min(...vertices.map(p=>p.x)),Math.min(...vertices.map(p=>p.y)),Math.max(...vertices.map(p=>p.x)),Math.max(...vertices.map(p=>p.y))];}
              else throw new Error('Unsupported source collider: '+collider.type);
              for(let y=0;y<7;y++)for(let x=0;x<7;x++){
                const local={x:offset.x+bounds[0]+(bounds[2]-bounds[0])*(x+.5)/7,y:offset.y+bounds[1]+(bounds[3]-bounds[1])*(y+.5)/7};if(!colliderContains(collider,local.x,local.y))continue;
                const world=point(matrix,local.x,local.y),winner=root.hitAt(world.x,world.y);if(!winner)throw new Error('Source collider has no raycast hit: '+presentation.id+'/'+hit.name);own ||=winner.id===hit.id;samples++;probes.push({root,hit,local,winner:winner.id});
              }
            }
            if(!samples)throw new Error('Source region has no enabled interior: '+presentation.id+'/'+hit.name);
            if(own&&!checked.includes(hit.name))checked.push(hit.name);else if(!own&&!occluded.includes(hit.name))occluded.push(hit.name);
          }
          Object.assign(group,{x:2,y:-3,scale:.7,rotation:37,flipX:true,flipY:true});stage.evaluate(0);
          for(const probe of probes){const matrix=probe.root.matrix(probe.hit),world=point(matrix,probe.local.x,probe.local.y),winner=probe.root.hitAt(world.x,world.y);if(winner?.id!==probe.winner)throw new Error('Transform changed region priority: '+presentation.id+'/'+probe.hit.name);}
        }
        const row={bundle:presentation.id,controllers:roots.length,regions:roots.reduce((n,root)=>n+root.hotspots.length,0),sampledHits:checked.length,inactive,noSampleHit:occluded.filter(name=>!checked.includes(name))};results.push(row);console.log('[region-check] '+JSON.stringify(row));
      }finally{stage.dispose();stage.gl.getExtension('WEBGL_lose_context')?.loseContext();}
    }
    return results;
  });assert.deepEqual(errors,[]);assert.ok(result.length);console.log('Idle-state source collider geometry and transform invariance checked',JSON.stringify({bundles:result.length,regions:result.reduce((n,row)=>n+row.regions,0),sampledHits:result.reduce((n,row)=>n+row.sampledHits,0),noSampleHit:result.filter(row=>row.noSampleHit.length),inactive:result.filter(row=>row.inactive.length)}));
}finally{await browser.close();}
