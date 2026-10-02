import assert from 'node:assert/strict';
import {chromium,webkit} from '@playwright/test';
const engine=process.argv[2]||'chromium',type={chromium,webkit}[engine];assert.ok(type,'Choose chromium or webkit');
const browser=await type.launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
  const result=await page.evaluate(async()=>{
    const catalogue=await fetch('/assets/presentations.json').then(response=>response.json()),fonts=catalogue.presentations.find(row=>row.id==='UI/Prefab/Onsen').fontAssets,results=[];
    for(let i=0;i<fonts.length;i++){
      const source=fonts[i],response=await fetch('/assets/'+source.path);if(!response.ok)throw new Error('Original font file is unavailable');const data=await response.arrayBuffer();if(data.byteLength!==source.bytes)throw new Error('Original font bytes do not match the catalogue');
      const family='mte-font-check-'+i,font=new FontFace(family,data);await font.load();document.fonts.add(font);
      try{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=90;const context=canvas.getContext('2d');context.font=`36px "${family}"`;context.fillText('千年之旅 Millennium',0,60);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;results.push({name:source.name,status:font.status,bytes:data.byteLength,width:context.measureText('千年之旅').width,visible:pixels.filter((value,index)=>index%4===3&&value>0).length});}finally{document.fonts.delete(font);}
    }return results;
  });
  assert.equal(result.length,2);for(const row of result){assert.equal(row.status,'loaded');assert.ok(row.bytes>9_000_000);assert.ok(row.visible>100);assert.ok(row.width>0);}assert.deepEqual(errors,[]);console.log(engine+': original font files loaded and rendered',result);
}finally{await browser.close();}
