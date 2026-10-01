export async function chooseVideoCodec(format,options,probe){
  if(!['mp4','webm'].includes(format))return null;
  for(const codec of format==='mp4'?['avc']:['vp9','vp8'])if(await probe(codec,options))return codec;
  throw new Error(`${format.toUpperCase()} encoding is unavailable at these settings. Try another format or PNG sequence.`);
}
