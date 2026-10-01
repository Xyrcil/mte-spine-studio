export function initializeAnimation(layer,{interactive=false}={}){
  const name=layer.instance.animation,data=layer.skeleton.data;
  if(!name||!data.findAnimation(name))return;
  if(interactive&&name==='start'&&data.findAnimation('animation')){
    const entry=layer.state.setAnimation(0,'start',false);
    layer.state.addAnimation(0,'animation',true,entry.animation.duration);
  }else layer.state.setAnimation(0,name,layer.instance.loop);
}
