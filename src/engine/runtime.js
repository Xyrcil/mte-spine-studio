let pending;

export function loadSpineRuntime(base){
  if(window.spine?.webgl)return Promise.resolve();
  if(pending)return pending;
  pending=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=new URL('vendor/spine-webgl.js',base).href;
    const timer=setTimeout(()=>fail(),30000);
    function fail(){clearTimeout(timer);script.remove();pending=undefined;reject(new Error('Animation runtime could not load. Reload to try again.'));}
    script.onerror=fail;script.onload=()=>{clearTimeout(timer);if(window.spine?.webgl)resolve();else fail();};
    document.head.append(script);
  });
  return pending;
}
