import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';

for(const engine of process.argv.slice(2).length?process.argv.slice(2):['chromium','firefox','webkit']){
  const {browser,close}=await launchTestBrowser(engine);
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(process.env.MTE_TEST_URL||'http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
    const result=await page.evaluate(async()=>{
      const {Stage}=await import('/src/engine/stage.js'),{RenderSession,collectInteractionEffects}=await import('/src/engine/export.js');
      const {exportPlan}=await import('/src/engine/export-plan.js'),{ensureInteractionAmbients}=await import('/src/engine/interaction-audio.js');
      const {audioResourceLookup}=await import('/src/engine/audio.js');
      const [catalog,runtime,library,index]=await Promise.all(['presentations.json','runtime-index.json','library.json','audio-index.json'].map(name=>fetch('/assets/'+name).then(r=>r.json())));
      const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const stage=new Stage(canvas,{manual:true});let session;
      try{
        await ensureInteractionAmbients(stage);
        const presentation=catalog.presentations.find(row=>row.id==='Spines/painting/301600901_spine');
        const group=await stage.add(presentation,runtime.entries.filter(row=>row.bundle===presentation.id));
        for(let i=0;i<30;i++)stage.evaluate(1/120);
        const initial=stage.snapshot(),counter=group.controllers[0].value.voiceTimes;
        const plan=exportPlan({format:'webm',width:64,height:64,fps:8,start:0,end:17,speed:1,loops:1,background:'#191b20',fit:'contain',crop:{x:0,y:0,width:1,height:1},loopMode:'repeat'});
        session=new RenderSession(initial,catalog.presentations,runtime.entries,new Map(),1,plan);await session.initialize();
        const audio=audioResourceLookup(index,library.soundResources),provider=(name,category)=>{
          const clip=audio.resolve(name,category);if(!clip)throw new Error('Original ambient audio missing');return {url:'/assets/'+clip.path,gain:1,duration:clip.duration};
        };
        const first=await collectInteractionEffects(session,plan,provider),second=await collectInteractionEffects(session,plan,provider);
        await session.seek(12);await session.seek(0);
        return {silent:window.__mteSilentTest,counter,restored:session.stage.groups[0].controllers[0].value.voiceTimes,first:first.clips,second:second.clips,warnings:first.warnings};
      }finally{session?.dispose();stage.dispose();}
    });
    assert.deepEqual(errors,[]);assert.equal(result.silent,true);assert.equal(result.counter,1);assert.equal(result.restored,1);
    assert.deepEqual(result.first,result.second);assert.deepEqual(result.warnings,[]);assert.equal(result.first.length,2);
    assert.ok(result.first.every(clip=>clip.url.includes('301600901')&&clip.repeat===false));
    console.log(engine,JSON.stringify({events:result.first.length,offsets:result.first.map(clip=>clip.offset),counterRestored:result.restored}));
  }finally{await close();}
}
