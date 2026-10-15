// Browser-only QA reference: separate playback session, not a second exportMedia call.
export async function comparePngReference({scene,catalog,entries,imageAssets,sourceAspect,settings,sourceTime},blob){
  const {RenderSession}=await import('/src/engine/export.js');
  const {exportPlan}=await import('/src/engine/export-plan.js');
  const source=settings.useSequence?scene.sequence.initial:scene;
  const plan=exportPlan(settings,source.speed);
  if(plan.format!=='png'||plan.loopMode!=='repeat')throw new Error('Reference requires a single repeat-mode PNG');
  if(!Number.isFinite(sourceTime)||sourceTime<0)throw new Error('Reference requires an explicit source time');
  const session=new RenderSession(structuredClone(scene),catalog,entries,imageAssets,sourceAspect,{...plan,supersampling:true});
  const decode=async png=>{
    const bitmap=await createImageBitmap(png);
    try{
      if(bitmap.width!==plan.width||bitmap.height!==plan.height)throw new Error('PNG dimensions differ from the requested output');
      const canvas=document.createElement('canvas');canvas.width=plan.width;canvas.height=plan.height;
      const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);
      return context.getImageData(0,0,plan.width,plan.height).data;
    }finally{bitmap.close();}
  };
  try{
    await session.initialize();await session.seek(sourceTime);
    if(session.renderScale!==2)throw new Error('Reference fixture requires 2× supersampling');
    const canvas=document.createElement('canvas');canvas.width=plan.width;canvas.height=plan.height;
    const context=canvas.getContext('2d',{alpha:Boolean(plan.transparent)});
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
    context.drawImage(session.canvas,0,0,plan.width,plan.height);
    // Both sides traverse PNG encoding/decoding, avoiding CPU/GPU readback conversion differences.
    const reference=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Reference PNG encoding failed')),'image/png'));
    const expected=await decode(reference),actual=await decode(blob);
    let maximum=0;for(let index=0;index<expected.length;index++)maximum=Math.max(maximum,Math.abs(expected[index]-actual[index]));
    return maximum;
  }finally{session.dispose();}
}
