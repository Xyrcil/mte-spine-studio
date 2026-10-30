// Keep only a small number of recently viewed, fully prepared artworks in this tab.
export function createPreviewPool(stage,{maxItems=2,maxBytes=96*1024*1024}={}){
  const rows=[];let bytes=0;
  const estimate=group=>{
    const textures=new Set();for(const value of Object.values(group.manager?.assets||{})){if(value?.pages)for(const page of value.pages)if(page.texture)textures.add(page.texture);if(typeof value?.getImage==='function')textures.add(value);}
    let total=0;for(const texture of textures){const image=texture.getImage?.();if(!image?.width||!image?.height)return Infinity;total+=image.width*image.height*8;}
    return textures.size?total:Infinity;
  };
  const remove=index=>{const [row]=rows.splice(index,1);if(row){bytes-=row.bytes;stage.release(row.group);}};
  return {
    take(key){const index=rows.findIndex(row=>row.key===key);if(index<0)return null;const [row]=rows.splice(index,1);bytes-=row.bytes;return row.group;},
    put(group){const size=estimate(group);if(!group.previewInitial||size>maxBytes){stage.release(group);return;}const key=group.presentation.id;const prior=rows.findIndex(row=>row.key===key);if(prior>=0)remove(prior);rows.push({key,group,bytes:size});bytes+=size;while(rows.length>maxItems||bytes>maxBytes)remove(0);},
    clear(){while(rows.length)remove(0);},
    stats(){return {items:rows.length,estimatedBytes:bytes};}
  };
}
