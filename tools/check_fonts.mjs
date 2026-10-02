import assert from 'node:assert/strict';
import {chromium,webkit} from '@playwright/test';
const engine=process.argv[2]||'chromium',type={chromium,webkit}[engine];assert.ok(type,'Choose chromium or webkit');
const browser=await type.launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:4173/');await page.waitForFunction(()=>window.mteStudio?.groups.length);
  const result=await page.evaluate(async()=>{
    const catalogue=await fetch('/assets/presentations.json').then(response=>response.json()),fonts=[...catalogue.presentations.find(row=>row.id==='UI/Prefab/Onsen').fontAssets.map(row=>({...row,kind:'tmp'})),...catalogue.presentations.find(row=>row.id==='Spines/ui/fight').nativeFontAssets.map(row=>({...row,kind:'native'}))],results=[];
    const library=await fetch('/assets/library.json').then(response=>response.json()),{layoutDialogueGlyphs}=await import('/src/engine/dialogue-text.js'),ids=new Set(library.hotSpringRoles.flatMap(role=>role.levels.flatMap(pool=>pool.voiceIds))),lines=library.voices.filter(row=>ids.has(row.id));if(lines.length!==52)throw new Error('Source dialogue coverage changed');
    for(let i=0;i<fonts.length;i++){
      const source=fonts[i],response=await fetch('/assets/'+source.path);if(!response.ok)throw new Error('Original font file is unavailable');const data=await response.arrayBuffer();if(data.byteLength!==source.bytes)throw new Error('Original font bytes do not match the catalogue');
      const family='mte-font-check-'+i,font=new FontFace(family,data);await font.load();document.fonts.add(font);
      try{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=90;const context=canvas.getContext('2d'),sample=source.name==='PERTIBD'?'MILLENNIUM TOUR ELF':'千年之旅 Millennium';context.font=`36px "${family}"`;context.fillText(sample,0,60);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
        if(source.kind==='tmp'&&(!source.lineBreaking?.leading||!source.lineBreaking.following))throw new Error('Original line-breaking assets are unavailable');
        context.font=`24px "${family}"`;let wrapped=0;
        const dialogue=source.kind==='tmp'&&source.name!=='PERTIBD';if(dialogue)for(const line of lines){const flow=layoutDialogueGlyphs(line.text,c=>context.measureText(c).width,617,true,source.lineBreaking);if(flow.glyphs.map(row=>row.character).join('')!==line.text.replace(/[\r\n]/g,'')||flow.characters!==Array.from(line.text.replace(/\r/g,'')).length)throw new Error('Wrapping lost source characters');if(flow.width>617.001)throw new Error('Source dialogue overflowed its field');if(flow.lines>1)wrapped++;}
        results.push({name:source.name,kind:source.kind,status:font.status,bytes:data.byteLength,width:context.measureText(sample).width,visible:pixels.filter((value,index)=>index%4===3&&value>0).length,sourceLines:dialogue?lines.length:0,wrapped});}finally{document.fonts.delete(font);}
    }return results;
  });
  assert.equal(result.length,5);for(const row of result){assert.equal(row.status,'loaded');assert.ok(row.bytes>(row.name==='PERTIBD'?30_000:9_000_000));assert.ok(row.visible>100);assert.ok(row.width>0);}assert.deepEqual(errors,[]);console.log(engine+': original TMP and Unity Text font files loaded and rendered',result);
}finally{await browser.close();}
