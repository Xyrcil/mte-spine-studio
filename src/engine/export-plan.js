const number=(value,label,min,max)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error(`Invalid ${label}`);return value;};
export function exportPlan(value,sceneSpeed=1){
  const width=number(value.width,'width',2,8192),height=number(value.height,'height',2,8192),scale=number(value.scale??1,'pixel multiplier',.25,4);
  const outputWidth=Math.round(width*scale),outputHeight=Math.round(height*scale);
  if(!Number.isInteger(width)||!Number.isInteger(height)||outputWidth>8192||outputHeight>8192)throw new Error('Output dimensions must be whole pixels, at most 8192 per side');
  const fps=number(value.fps,'frame rate',1,120),speed=number(value.speed,'animation speed',.01,10)*number(sceneSpeed,'scene speed',.01,10);
  const start=number(value.start,'start',0,86400),end=number(value.end,'end',0,86400);if(end<=start)throw new Error('End must be after start');
  if(!['png','sequence','mp4','webm'].includes(value.format))throw new Error('Unsupported export format');
  if(value.format==='mp4'&&(outputWidth%2||outputHeight%2))throw new Error('MP4 output dimensions must be even');
  if(value.transparent&&['mp4','webm'].includes(value.format))throw new Error('Use PNG or a PNG sequence for transparent output');
  if(!/^#[0-9a-f]{6}$/i.test(value.background))throw new Error('Invalid export background');
  if(!['contain','cover'].includes(value.fit))throw new Error('Invalid crop fit');
  const crop={};for(const key of ['x','y','width','height'])crop[key]=number(value.crop?.[key],`crop ${key}`,0,1);
  if(crop.width<=0||crop.height<=0||crop.x+crop.width>1+1e-8||crop.y+crop.height>1+1e-8)throw new Error('Crop must fit inside the viewport');
  const loops=number(value.loops,'loop count',1,10000);if(!Number.isInteger(loops))throw new Error('Loop count must be a whole number');
  if(!['repeat','ping-pong','crossfade'].includes(value.loopMode))throw new Error('Invalid loop mode');
  const segmentFrames=Math.max(1,Math.round((end-start)/speed*fps)),fadeFrames=value.loopMode==='crossfade'?Math.round(number(value.fade,'crossfade duration',0,60)*fps):0;
  if(value.loopMode==='crossfade'&&(fadeFrames<1||fadeFrames*2>=segmentFrames))throw new Error('Crossfade must be shorter than half the interval');
  const cycleFrames=value.loopMode==='ping-pong'?Math.max(1,2*segmentFrames-2):segmentFrames-fadeFrames;
  const frames=value.format==='png'?1:cycleFrames*loops;if(frames>1e7)throw new Error('Export contains too many frames');
  if(value.format==='sequence'&&frames>65535)throw new Error('A ZIP sequence supports at most 65535 frames');
  const bitrate=number(value.bitrate??8e6,'bitrate',100000,100e6);
  number(value.audioOffset??0,'audio offset',0,86400);number(value.audioGain??1,'audio volume',0,2);
  return {...value,crop,width:outputWidth,height:outputHeight,fps,speed,start,end,loops,segmentFrames,fadeFrames,cycleFrames,frames,duration:frames/fps,bitrate};
}
export function frameSources(plan,index){
  const i=index%plan.cycleFrames;
  if(plan.loopMode==='ping-pong')return [{frame:i<plan.segmentFrames?i:2*plan.segmentFrames-2-i,weight:1}];
  if(plan.loopMode==='crossfade'){
    const frame=i+plan.fadeFrames;
    if(frame>=plan.segmentFrames-plan.fadeFrames){const head=frame-(plan.segmentFrames-plan.fadeFrames),weight=(head+1)/plan.fadeFrames;return [{frame,weight:1-weight},{frame:head,weight}];}
    return [{frame,weight:1}];
  }
  return [{frame:i,weight:1}];
}
export function exportCamera(camera,sourceAspect,plan){
  if(camera.sourcePreview)sourceAspect=camera.sourcePreview.aspect;
  number(sourceAspect,'viewport aspect',.001,1000);
  const sourceWidth=Math.max(camera.width,camera.height*sourceAspect),sourceHeight=sourceWidth/sourceAspect,cropWidth=sourceWidth*plan.crop.width,cropHeight=sourceHeight*plan.crop.height,aspect=plan.width/plan.height;
  const width=plan.fit==='contain'?Math.max(cropWidth,cropHeight*aspect):Math.min(cropWidth,cropHeight*aspect);
  const result={x:camera.x+(plan.crop.x+plan.crop.width/2-.5)*sourceWidth,y:camera.y+(.5-plan.crop.y-plan.crop.height/2)*sourceHeight,width,height:width/aspect};
  const pixelWidth=cropWidth/width*plan.width,pixelHeight=cropHeight/result.height*plan.height;
  return {camera:result,maskCamera:{x:camera.x,y:camera.y,width:sourceWidth,height:sourceHeight},clip:plan.fit==='contain'?{x:Math.round((plan.width-pixelWidth)/2),y:Math.round((plan.height-pixelHeight)/2),width:Math.round(pixelWidth),height:Math.round(pixelHeight)}:null};
}
export function clipSample(channels,sampleRate,time,{offset=0,rate=1,repeat=false,gain=1}={},result=[0,0]){
  result[0]=0;result[1]=0;if(time<offset||!channels[0]?.length)return result;
  let position=(time-offset)*rate*sampleRate;const length=channels[0].length;
  if(repeat)position%=length;else if(position>=length)return result;
  const index=Math.floor(position),fraction=position-index,next=repeat?(index+1)%length:Math.min(index+1,length-1);
  const envelope=Math.min(1,position/(sampleRate*.005),(length-position)/(sampleRate*.005));
  for(let channel=0;channel<2;channel++){const data=channels[channel]||channels[0];result[channel]=Math.max(-1,Math.min(1,(data[index]*(1-fraction)+data[next]*fraction)*gain*envelope));}return result;
}
