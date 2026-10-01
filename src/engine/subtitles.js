export function subtitleActive(time,duration,{offset=0,rate=1,repeat=false}={}){
  const elapsed=(time-offset)*rate;return duration>0&&elapsed>=0&&(repeat||elapsed<duration);
}
export function subtitleLines(text,width,measure){
  const lines=[];let line='';
  for(const char of Array.from(text)){if(char==='\n'){lines.push(line);line='';continue;}if(line&&measure(line+char)>width){lines.push(line);line=char;}else line+=char;}
  if(line)lines.push(line);return lines;
}
export function prepareSubtitle(ctx,text,width,height){
  if(typeof text!=='string'||text.length>20000)throw new Error('Invalid subtitle text');
  const padding=Math.max(4,height*.015),available=width*.9-padding*2;let size=Math.max(8,Math.min(64,Math.round(height*.035))),lines;
  do{ctx.font=`${size}px sans-serif`;lines=subtitleLines(text,available,value=>ctx.measureText(value).width);if(lines.length*size*1.35+padding*2<=height*.4)break;size--;}while(size>=8);
  if(size<8)throw new Error('Subtitle is too long for this output size; use a larger resolution');
  return {size,lines,padding,height:lines.length*size*1.35+padding*2};
}
export function drawSubtitle(ctx,layout,width,height,bottomOffset=0,opacity=1){
  const y=height-height*.035-layout.height-bottomOffset;
  ctx.save();ctx.globalAlpha=opacity;ctx.globalCompositeOperation='source-over';ctx.fillStyle='rgba(0,0,0,.72)';ctx.fillRect(width*.05,y,width*.9,layout.height);
  ctx.font=`${layout.size}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='top';ctx.fillStyle='#ffffff';
  layout.lines.forEach((line,index)=>ctx.fillText(line,width/2,y+layout.padding+index*layout.size*1.35));ctx.restore();
}
