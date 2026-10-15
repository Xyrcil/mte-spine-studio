export function invalidControllerPose(group){
  const invalid=[];
  for(const layer of group.layers)for(const bone of layer.skeleton.bones){
    if(Number.isFinite(bone.a)&&Number.isFinite(bone.b)&&Number.isFinite(bone.c)&&Number.isFinite(bone.d)&&
      Number.isFinite(bone.worldX)&&Number.isFinite(bone.worldY)&&Number.isFinite(bone.x)&&Number.isFinite(bone.y)&&
      Number.isFinite(bone.rotation)&&Number.isFinite(bone.scaleX)&&Number.isFinite(bone.scaleY)&&Number.isFinite(bone.shearX)&&Number.isFinite(bone.shearY)&&
      Number.isFinite(bone.arotation)&&Number.isFinite(bone.ax)&&Number.isFinite(bone.ay)&&Number.isFinite(bone.ascaleX)&&Number.isFinite(bone.ascaleY)&&Number.isFinite(bone.ashearX)&&Number.isFinite(bone.ashearY))continue;
    invalid.push({layer:layer.instance.name,bone:bone.data.name,parent:bone.parent?.data.name,local:[bone.x,bone.y,bone.scaleX,bone.scaleY],parentMatrix:bone.parent&&[bone.parent.a,bone.parent.b,bone.parent.c,bone.parent.d],applied:[bone.ax,bone.ay,bone.arotation]});
  }
  return invalid;
}
