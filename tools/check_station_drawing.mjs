import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';
import {selectAsset} from './select_asset.mjs';
const engine=process.argv[2]||'chromium',{browser,close}=await launchTestBrowser(engine);
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
  const result=await page.evaluate(async engine=>{
    const {Stage}=await import('/src/engine/stage.js'),{expandStationDrawings}=await import('/src/engine/station-drawing.js'),{InteractionRecorder,InteractionPlayer}=await import('/src/engine/interaction-sequence.js'),{exportMedia}=await import('/src/engine/export.js'),{createSceneFile,readSceneFile}=await import('/src/engine/scene-file.js');
    const raw=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,library=await fetch('/assets/library.json').then(r=>r.json()),entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries,catalog=expandStationDrawings(raw,library,entries),drawings=catalog.filter(row=>row.stationDrawing?.pairs.length);
    const check=(value,message)=>{if(!value)throw new Error(message);},canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;const stage=new Stage(canvas,{manual:true}),advance=seconds=>{for(let i=0;i<Math.ceil(seconds*120);i++)stage.evaluate(1/120);},rows=[];
    try{
      check(drawings.length===5,'Five source interactions were not bound');
      for(const presentation of drawings){
        const group=await stage.add(presentation,entries.filter(row=>row.bundle===presentation.resourceBundle)),root=group.controllers[0],layer=group.layers[0],seen=new Set(),recorder=new InteractionRecorder(stage);
        check(layer.state.getCurrent(0).animation.name==='stand'&&layer.state.getCurrent(1).animation.name===presentation.stationDrawing.defaultExpression,'Source idle tracks differ');
        const offset=root.source.colliders[0].data.m_Offset;check(root.hitAt(offset.x,offset.y)?.id==='station-touch','Authored collider cannot be clicked');check(root.hitAt(1000,1000)===null,'Click outside collider accepted');
        recorder.start();
        for(let i=0;i<512&&seen.size<presentation.stationDrawing.pairs.length;i++){
          const invoked=stage.triggerInteraction(group.id,root.source.id,'station-touch');check(invoked.accepted,'Source touch was rejected');const selected=root.value.selected,pair=root.drawing.pairs[selected];seen.add(selected);
          check(layer.state.getCurrent(0).animation.name===pair.action&&!layer.state.getCurrent(0).loop&&layer.state.getCurrent(1).animation.name===pair.expression&&layer.state.getCurrent(1).loop,'Action/expression tracks differ');
          check(!stage.triggerInteraction(group.id,root.source.id,'station-touch').accepted,'Repeated click was accepted');
          advance(.25);
          if(i===0){const saved=stage.snapshot();for(const format of ['json','zip']){const file=await createSceneFile(saved,{format}),restored=await readSceneFile(file.blob);check(file.extension===format,'Wrong scene file format');await stage.restore(restored,catalog,entries);check(JSON.stringify(root.snapshot())===JSON.stringify(saved.objects[0].interactions[0].state),'Mid-action checkpoint differs');}}
          advance(layer.skeleton.data.findAnimation(pair.action).duration+.25);
          check(root.value.selected===-1&&layer.state.getCurrent(0).animation.name==='stand'&&layer.state.getCurrent(1).animation.name===root.drawing.defaultExpression,'Complete did not restore both idle tracks');
        }
        const sequence=recorder.stop(),final=root.snapshot();recorder.dispose();check(seen.size===root.drawing.pairs.length,'Random stream did not cover every original action');
        await stage.restore(sequence.initial,catalog,entries);stage.sequencePlayer=new InteractionPlayer(stage,sequence);advance(sequence.duration);delete stage.sequencePlayer;check(JSON.stringify(root.snapshot())===JSON.stringify(final),'Recorded action choices differ after replay');
        const settings={format:'png',width:160,height:120,fps:8,speed:1,start:0,end:1,loops:1,loopMode:'repeat',background:stage.background,fit:'contain',crop:{x:0,y:0,width:1,height:1},useSequence:true},scene={...stage.snapshot(),sequence};
        const png=await exportMedia({scene,catalog,entries,imageAssets:stage.imageAssets,sourceAspect:4/3,settings});check(png.blob.size>1000,'Station PNG export is empty');
        if(rows.length===0){const video=await exportMedia({scene,catalog,entries,imageAssets:stage.imageAssets,sourceAspect:4/3,settings:{...settings,format:engine==='firefox'?'webm':'mp4'}});check(video.blob.size>1000,'Station video export is empty');const {Input,BlobSource,ALL_FORMATS,VideoSampleSink}=await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs'),input=new Input({source:new BlobSource(video.blob),formats:ALL_FORMATS});try{const track=await input.getPrimaryVideoTrack();check((await track.computePacketStats()).packetCount===8,'Station video frame count differs');const sink=new VideoSampleSink(track);for(let i=0;i<8;i++){const sample=await sink.getSample((i+.25)/8);check(Boolean(sample),'Station video frame cannot decode');sample.close();}}finally{input.dispose();}}
        check(stage.gl.getError()===0,'Station rendering produced a GL error');rows.push({id:presentation.stationDrawing.id,pairs:seen.size,recordedActions:sequence.actions.length,pngBytes:png.blob.size});stage.groups=[];stage.release(group);
      }
      let idleDrawings=0;for(const presentation of catalog.filter(row=>row.stationDrawing&&!row.stationDrawing.pairs.length)){const group=await stage.add(presentation,entries.filter(row=>row.bundle===presentation.resourceBundle)),root=group.controllers[0],layer=group.layers[0];advance(.25);stage.draw();check(root.hotspots.length===0,'Idle-only drawing received a fabricated hit');check(layer.state.getCurrent(0).animation.name==='stand','Idle-only drawing lost source stand');if(root.drawing.defaultExpression)check(layer.state.getCurrent(1).animation.name===root.drawing.defaultExpression,'Idle-only expression differs');check(stage.gl.getError()===0,'Idle-only drawing produced a GL error');idleDrawings++;stage.groups=[];stage.release(group);}
      check(idleDrawings===88,'Not every idle-only station drawing was loaded');return {engine,drawings:rows,idleDrawings};
    }finally{stage.dispose();stage.gl.getExtension('WEBGL_lose_context')?.loseContext();}
  },engine);
  await selectAsset(page,'Spines/drawing/station/100101');await page.waitForFunction(()=>window.mteStudio.groups[0]?.presentation.id==='Spines/drawing/station/100101'&&!window.mteEditor.busy);
  assert.ok((await page.locator('#details').textContent()).includes('1 interaction regions'));
  const target=await page.evaluate(()=>{window.mteHost.resume();const stage=window.mteStudio,rect=stage.canvas.getBoundingClientRect(),offset=stage.groups[0].controllers[0].source.colliders[0].data.m_Offset,aspect=rect.width/rect.height,width=Math.max(stage.camera.width,stage.camera.height*aspect);return {x:rect.left+(offset.x-stage.camera.x)/width*rect.width+rect.width/2,y:rect.top+rect.height/2-(offset.y-stage.camera.y)/(width/aspect)*rect.height};});await page.mouse.click(target.x,target.y);assert.ok(await page.evaluate(()=>window.mteStudio.groups[0].controllers[0].value.selected>=0));
  await page.evaluate(()=>{window.mteHost.pause();window.mteStudio.evaluate(0);window.mteEditor.changed();});const saved=await page.evaluate(()=>window.mteEditor.snapshot());await page.waitForTimeout(900);await page.reload();await page.waitForFunction(()=>window.mteStudio?.groups[0]?.presentation.id==='Spines/drawing/station/100101'&&!window.mteEditor.busy);assert.deepEqual(await page.evaluate(()=>window.mteEditor.snapshot()),saved);
  await page.screenshot({path:`private/station-drawing-${engine}.png`});assert.deepEqual(errors,[]);console.log('Real station drawing interaction, recording, persistence and export checks passed',result);
}finally{await close();}
