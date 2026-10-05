import assert from 'node:assert/strict';
import {launchTestBrowser} from './test_browser.mjs';
const engine=process.argv[2]||'chromium',{browser,close}=await launchTestBrowser(engine);
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length>0);
  const storage=await page.evaluate(async()=>{
    const factory=indexedDB,original=factory.open,connections=[],databaseName='mte-storage-check-'+crypto.randomUUID();let attempts=0,version=1;
    factory.open=function(){attempts++;if(attempts===1){const request={error:new DOMException('Temporary storage failure','UnknownError')};queueMicrotask(()=>request.onerror());return request;}const request=original.call(this,databaseName,version);request.addEventListener('success',()=>connections.push(request.result));return request;};
    const {saveLocalScene,loadLocalScene,listLocalScenes,deleteLocalScene}=await import('/src/engine/scene.js?storage-recovery');
    const key='Storage recovery check',scene={schema:1,name:key,background:'#123456',camera:{x:0,y:0,width:10,height:10},speed:1,paused:true,objects:[]};let firstFailed=false;
    try{
      try{await listLocalScenes();}catch(error){if(error.name!=='UnknownError')throw error;firstFailed=true;}
      await saveLocalScene(scene,key);const initial=await loadLocalScene(key);
      await new Promise((resolve,reject)=>{const request=original.call(factory,databaseName,2);request.onsuccess=()=>{request.result.close();version=2;resolve();};request.onerror=()=>reject(request.error);});
      const reopened=await loadLocalScene(key);connections.at(-1).close();connections.at(-1).onclose();
      const reconnected=await loadLocalScene(key);await deleteLocalScene(key);
      return {firstFailed,attempts,initial:JSON.stringify(initial)===JSON.stringify(scene),reopened:JSON.stringify(reopened)===JSON.stringify(scene),reconnected:JSON.stringify(reconnected)===JSON.stringify(scene),removed:!(await listLocalScenes()).includes(key)};
    }finally{factory.open=original;for(const db of connections)db.close();await new Promise((resolve,reject)=>{const request=factory.deleteDatabase(databaseName);request.onsuccess=resolve;request.onerror=()=>reject(request.error);});}
  });assert.deepEqual(storage,{firstFailed:true,attempts:4,initial:true,reopened:true,reconnected:true,removed:true});
  const wrongTypes=await page.evaluate(async()=>{
    const {Stage}=await import('/src/engine/stage.js'),catalog=(await fetch('/assets/presentations.json').then(r=>r.json())).presentations,entries=(await fetch('/assets/runtime-index.json').then(r=>r.json())).entries,canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const stage=new Stage(canvas,{manual:true});
    try{
      await stage.add(catalog.find(row=>row.id==='Spines/painting/301600901_spine'),entries);stage.paused=true;const original=stage.snapshot(),results=[];
      for(const state of [{kind:'skill-display',ended:false},{kind:'skill-words',schema:1,count:2,clock:0,step:0,nextUpdate:0,playing:false},{kind:'bone-drag',schema:1,writing:false,pointer:null,motion:{schema:1,current:{x:0,y:0},from:{x:0,y:0},dragging:false,returning:false,elapsed:0}}]){
        const changed=structuredClone(original);changed.objects[0].x=999;changed.objects[0].interactions[0].state=state;let reason='';try{await stage.restore(changed,catalog,entries);}catch(error){reason=error.message;}
        results.push({kind:state.kind,reason,unchanged:JSON.stringify(stage.snapshot())===JSON.stringify(original)});
      }
      return results;
    }finally{stage.dispose();}
  });
  for(const result of wrongTypes){assert.match(result.reason,/interaction type does not match asset/,result.kind);assert.equal(result.unchanged,true,result.kind);}
  await page.getByRole('button',{name:'Studio',exact:true}).click();
  const initialFields=await page.evaluate(()=>({name:window.mteEditor.selected().name,scene:window.mteEditor.snapshot().name,x:window.mteEditor.selected().x}));
  await page.getByLabel('Object name',{exact:true}).fill('Uncommitted object draft');
  const objectDraft=await page.evaluate(async()=>{document.activeElement.setSelectionRange(2,7,'backward');window.mteEditor.changed({audioOnly:true});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const field=document.querySelector('.object-controls input');return {model:window.mteEditor.selected().name,value:field.value,focused:field===document.activeElement,start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection};});assert.deepEqual(objectDraft,{model:initialFields.name,value:'Uncommitted object draft',focused:true,start:2,end:7,direction:'backward'});
  await page.getByLabel('Object name',{exact:true}).press('Tab');assert.equal(await page.evaluate(()=>window.mteEditor.selected().name),'Uncommitted object draft');await page.getByRole('button',{name:'Undo',exact:true}).click();await page.waitForFunction(name=>!window.mteEditor.busy&&window.mteEditor.selected().name===name,initialFields.name);
  await page.getByLabel('Object name',{exact:true}).focus();const composition=await page.evaluate(async()=>{const field=document.activeElement;window.sceneCompositionNode=field;field.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));field.value='你';field.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:'你'}));window.mteEditor.changed({audioOnly:true});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {retained:field===document.activeElement&&field.isConnected,model:window.mteEditor.selected().name};});assert.deepEqual(composition,{retained:true,model:initialFields.name});
  await page.evaluate(()=>{const field=window.sceneCompositionNode;field.value='你好';field.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'你好'}));field.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:false,data:'你好'}));});await page.waitForFunction(()=>document.querySelector('.object-controls input').value==='你好');assert.equal(await page.getByLabel('Object name',{exact:true}).inputValue(),'你好');await page.getByLabel('Object name',{exact:true}).press('Tab');assert.equal(await page.evaluate(()=>window.mteEditor.selected().name),'你好');await page.getByRole('button',{name:'Undo',exact:true}).click();await page.waitForFunction(name=>!window.mteEditor.busy&&window.mteEditor.selected().name===name,initialFields.name);
  if(engine==='chromium'){
    const ime=await page.context().newCDPSession(page);await page.getByLabel('Object name',{exact:true}).fill('');await page.evaluate(()=>window.sceneCompositionNode=document.activeElement);await ime.send('Input.imeSetComposition',{text:'你',selectionStart:1,selectionEnd:1});assert.equal(await page.evaluate(async()=>{window.mteEditor.changed({cameraOnly:true});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return window.sceneCompositionNode===document.activeElement&&window.sceneCompositionNode.isConnected;}),true);await ime.send('Input.insertText',{text:'你好'});await page.waitForFunction(()=>document.querySelector('.object-controls input').value==='你好');assert.equal(await page.getByLabel('Object name',{exact:true}).inputValue(),'你好');assert.equal(await page.evaluate(()=>window.mteEditor.selected().name),initialFields.name);await page.getByLabel('Object name',{exact:true}).press('Tab');assert.equal(await page.evaluate(()=>window.mteEditor.selected().name),'你好');await page.getByRole('button',{name:'Undo',exact:true}).click();await page.waitForFunction(name=>!window.mteEditor.busy&&window.mteEditor.selected().name===name,initialFields.name);await ime.detach();
  }
  await page.getByLabel('Scene name',{exact:true}).fill('Uncommitted scene draft');const sceneDraft=await page.evaluate(async()=>{window.mteEditor.changed({audioOnly:true});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {value:document.querySelector('#scene-name').value,model:window.mteEditor.snapshot().name,focused:document.activeElement.id};});assert.deepEqual(sceneDraft,{value:'Uncommitted scene draft',model:initialFields.scene,focused:'scene-name'});await page.getByLabel('Scene name',{exact:true}).fill(initialFields.scene);await page.getByLabel('Scene name',{exact:true}).press('Tab');
  await page.getByLabel('Visible',{exact:true}).focus();await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>window.mteEditor.selected().visible),false);assert.equal(await page.getByLabel('Visible',{exact:true}).evaluate(node=>node===document.activeElement),true);await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>window.mteEditor.selected().visible),true);
  await page.getByLabel('X',{exact:true}).fill('2.5');const numericDraft=await page.evaluate(async()=>{window.mteEditor.changed({cameraOnly:true});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const field=[...document.querySelectorAll('.object-controls label')].find(node=>node.firstChild.textContent==='X').querySelector('input');return {value:field.value,model:window.mteEditor.selected().x,focused:field===document.activeElement};});assert.deepEqual(numericDraft,{value:'2.5',model:initialFields.x,focused:true});await page.getByLabel('X',{exact:true}).press('Tab');assert.equal(await page.evaluate(()=>window.mteEditor.selected().x),2.5);await page.waitForFunction(()=>document.activeElement.closest('label')?.firstChild.textContent==='Y',null,{timeout:2000});await page.keyboard.press('Shift+Tab');await page.waitForFunction(()=>document.activeElement.closest('label')?.firstChild.textContent==='X',null,{timeout:2000});await page.keyboard.press('Tab');await page.waitForFunction(()=>document.activeElement.closest('label')?.firstChild.textContent==='Y',null,{timeout:2000});await page.getByRole('button',{name:'Undo',exact:true}).click();await page.waitForFunction(x=>!window.mteEditor.busy&&window.mteEditor.selected().x===x,initialFields.x);
  await page.getByRole('button',{name:'Duplicate',exact:true}).click();
  await page.waitForFunction(()=>window.mteStudio.groups.length===2&&!window.mteEditor.busy);
  const owners=await page.evaluate(()=>({selected:window.mteEditor.selected().id,other:window.mteStudio.groups.find(group=>group.id!==window.mteEditor.selected().id).id}));await page.getByLabel('Object name',{exact:true}).fill('Do not transfer this draft');const switched=await page.evaluate(owners=>{const editor=window.mteEditor,other=window.mteStudio.groups.find(group=>group.id===owners.other),old=document.activeElement;old.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));editor.choose(other);const field=document.querySelector('.object-controls input');return {owner:editor.selected().id,value:field.value,name:other.name,oldDetached:!old.isConnected};},owners);assert.equal(switched.owner,owners.other);assert.equal(switched.value,switched.name);assert.equal(switched.oldDetached,true);assert.notEqual(switched.value,'Do not transfer this draft');await page.evaluate(id=>window.mteEditor.choose(window.mteStudio.groups.find(group=>group.id===id)),owners.selected);
  await page.getByLabel('X',{exact:true}).fill('3');await page.getByLabel('X',{exact:true}).press('Tab');
  assert.equal(await page.evaluate(()=>window.mteEditor.selected().x),3);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await page.waitForFunction(()=>!window.mteEditor.busy&&window.mteEditor.selected().x===1);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await page.waitForFunction(()=>!window.mteEditor.busy&&window.mteEditor.selected().x===3);
  const image=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const ctx=canvas.getContext('2d');ctx.fillStyle='#6699aa';ctx.fillRect(0,0,32,32);return canvas.toDataURL().split(',')[1];});
  await page.locator('#background-file').setInputFiles({name:'background.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await page.waitForFunction(()=>window.mteStudio.groups.length===3&&!window.mteEditor.busy);
  await page.locator('#scene-name').fill('Scene round trip');await page.locator('#scene-name').press('Tab');
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export scene',exact:true}).click();
  const stream=await (await download).createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);const saved=JSON.parse(Buffer.concat(chunks).toString());
  assert.equal(saved.objects.length,3);assert.equal(saved.objects[0].kind,'image');assert.equal(saved.paused,true);
  const before=await page.evaluate(()=>window.mteEditor.snapshot());
  const broken=structuredClone(saved);broken.objects[1].x=999;broken.objects[2].layers[0].tracks[0].name='Missing animation';
  await page.locator('#scene-file').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(broken))});
  await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Import failed'));
  assert.deepEqual(await page.evaluate(()=>window.mteEditor.snapshot()),before);
  await page.getByRole('button',{name:'Remove',exact:true}).first().click();
  await page.locator('#scene-file').setInputFiles({name:'saved.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
  await page.waitForFunction(()=>window.mteStudio.groups.length===3&&!window.mteEditor.busy);
  assert.deepEqual(await page.evaluate(()=>window.mteEditor.snapshot()),saved);
  await page.getByRole('button',{name:'Save locally',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#saved-scenes').options.length===2);
  await page.waitForTimeout(800);await page.reload();await page.waitForFunction(()=>window.mteStudio?.groups.length===3&&!window.mteEditor.busy);
  assert.deepEqual(await page.evaluate(()=>window.mteEditor.snapshot()),saved);
  await page.screenshot({path:'private/browser-scene.png'});
  await page.setViewportSize({width:600,height:900});
  await page.getByRole('button',{name:'Controls',exact:true}).click();
  assert.equal(await page.locator('.inspector').isVisible(),true);
  await page.getByRole('button',{name:'Controls',exact:true}).click();
  assert.equal(await page.locator('.inspector').isVisible(),false);
  assert.deepEqual(errors,[]);console.log(engine+': Scene checks passed: focus/caret and uncommitted object/scene/numeric drafts, composition-event deferral'+(engine==='chromium'?' and native IME commit':'')+', keyboard checkbox, owner isolation, edit, undo/redo, image, import failure, controller type preflight, round trip and reload');
}finally{await close();}
