import {selectAsset} from './select_asset.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launchTestBrowser} from './test_browser.mjs';

const engine=process.argv[2]||'chromium',{browser,close}=await launchTestBrowser(engine),expected=JSON.parse(await readFile('public/assets/presentations.json','utf8')).presentations;
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
  const result=await page.evaluate(async()=>{
    const catalog=await fetch('/assets/presentations.json').then(response=>response.json()),entries=[],images=new Map();
    let uiImages=0;
    for(const presentation of catalog.presentations){
      for(const image of presentation.images||[]){
        if(image.status!=='extracted'||image.errors.length||!image.transform)throw new Error(`Incomplete UI image: ${presentation.id}/${image.id}`);
        if(image.sprite)images.set(image.assetPath||`${presentation.path}/${image.sprite.path}`,image.sprite);
        uiImages++;
      }
      for(const effect of presentation.effects||[]){
        if(effect.status!=='extracted'||effect.errors.length||!effect.transform)throw new Error(`Incomplete effect: ${presentation.id}/${effect.id}`);
        for(const image of [...effect.sprites,...effect.materials.flatMap(material=>Object.values(material.textures))])images.set(`${presentation.path}/${image.path}`,image);
        const material=effect.materials[0];if(!Array.isArray(material?.keywords)||!Number.isInteger(material.renderQueue)||!Array.isArray(material.disabledPasses))throw new Error(`Incomplete material settings: ${presentation.id}/${effect.id}`);
        if(material.shader==='AOI/Effect/AOI_Effect_UrpV2'){
          const floats=Object.fromEntries(material.properties.m_Floats);if(material.renderQueue!==3001||!material.keywords.includes('_SCREEN_MASK_ON')||floats._SrcBlend!==1||floats._DstBlend!==1||!material.disabledPasses.includes('SHADOWCASTER'))throw new Error('Original masked particle material changed');
        }
        entries.push({bundle:presentation.id,name:effect.name,sprites:effect.sprites.length,shader:material.shader,keywords:material.keywords,renderQueue:material.renderQueue,transform:effect.transform});
      }
    }
    let nonempty=0;
    for(const [path,metadata] of images){const response=await fetch('/assets/'+path);if(!response.ok)throw new Error(`Image unavailable: ${path}`);const bitmap=await createImageBitmap(await response.blob());if(bitmap.width!==metadata.width||bitmap.height!==metadata.height)throw new Error('Effect image dimensions changed');const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;if(pixels.some((value,index)=>index%4===3&&value>0))nonempty++;}
    const onsen=catalog.presentations.find(presentation=>presentation.id==='Spines/ui/Onsen');
    if(onsen.images.length!==4||onsen.canvasGroups.length!==2||onsen.images.some(image=>image.sprite?.id!=='5562774842075140937'))throw new Error('Original smoke image or opacity components missing');
    return {entries,images:images.size,uiImages,nonempty,smoke:onsen.visualAnimations.filter(row=>row.type==='AnimationClip').map(row=>row.data.m_Name),bundles:catalog.presentations.map(row=>row.id)};
  });
  assert.deepEqual(result.bundles,expected.map(row=>row.id));assert.equal(result.entries.length,expected.reduce((total,row)=>total+row.effects.length,0));assert.equal(result.uiImages,expected.reduce((total,row)=>total+row.images.length,0));assert.equal(result.nonempty,result.images);assert.ok(result.smoke.includes('ani_smoke_loop'));
  for(const bundle of [...new Set(result.entries.map(entry=>entry.bundle))]){
    await selectAsset(page,bundle);await page.waitForFunction(bundle=>window.mteStudio.groups[0]?.presentation.id===bundle,bundle);
    const unavailable=await page.evaluate(()=>window.mteStudio.groups[0].effects.some(effect=>effect.reason));
    if(unavailable)assert.match(await page.locator('#details').textContent(),/Additional effects unavailable:/);
    else assert.doesNotMatch(await page.locator('#details').textContent(),/Additional effects unavailable:/);
  }
  assert.deepEqual(errors,[]);console.log(engine+': Complete effect resources checked: indexed bundles, native images and particle textures, preserved material settings, smoke clips and explicit rendering status',{...result,bundles:result.bundles.length});
}finally{await close();}
