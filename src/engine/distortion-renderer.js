import {distortionPhases,textureMipLevels} from './material-distortion.js';
import {drawSkeletonSlots} from './material-order.js';

const vertex=`attribute vec2 position;attribute vec4 light;attribute vec2 atlasUV;uniform mat4 projection;varying vec2 webUV;varying vec4 tint;void main(){gl_Position=projection*vec4(position,0.0,1.0);webUV=atlasUV;tint=light;}`;
const fragment=`precision highp float;
uniform sampler2D artwork,flowTexture,noiseTexture,maskTexture;
uniform vec4 mainST,noiseST,maskST,noiseOffsets;
uniform vec3 flowPhases;
uniform vec2 intensity;
uniform float flowEnabled,noiseEnabled,whiteMask,flowPower;
varying vec2 webUV;varying vec4 tint;
vec2 png(vec2 source){return vec2(source.x,1.0-source.y);}
vec2 placed(vec2 uv,vec4 st){return uv*st.xy+st.zw;}
void main(){
  vec2 source=png(webUV),uv=placed(source,mainST);
  if(noiseEnabled>0.5){
    vec2 lookup=placed(source,noiseST);
    float strength=texture2D(noiseTexture,png(lookup+noiseOffsets.xy)).r+texture2D(noiseTexture,png(lookup+noiseOffsets.zw)).r;
    vec2 coverage=whiteMask>0.5?vec2(1.0):texture2D(maskTexture,png(placed(source,maskST))).rg;
    uv=mix(uv,source+strength*intensity,coverage);
  }
  vec4 texel;
  if(flowEnabled>0.5){
    vec2 movement=(texture2D(flowTexture,webUV).rg*2.0-1.0)*flowPower;
    vec4 first=texture2D(artwork,png(uv-flowPhases.x*movement));
    vec4 second=texture2D(artwork,png(uv-flowPhases.y*movement));
    texel=mix(first,second,flowPhases.z);
  }else texel=texture2D(artwork,png(uv));
  gl_FragColor=texel*tint;
}`;

export class DistortionRenderer {
  constructor(gl){
    this.gl=gl;this.shaders=[];this.uploadedMips=new WeakMap();
    this.anisotropy=gl.getExtension('EXT_texture_filter_anisotropic')||gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic')||gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
    this.maxAnisotropy=this.anisotropy?gl.getParameter(this.anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT):1;
    try{
      for(const [kind,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){const shader=gl.createShader(kind);this.shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error('Material distortion shader could not compile');}
      this.program=gl.createProgram();for(const shader of this.shaders)gl.attachShader(this.program,shader);gl.linkProgram(this.program);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error('Material distortion shader could not link');
      this.vertices=gl.createBuffer();this.indices=gl.createBuffer();this.attributes=Object.fromEntries(['position','light','atlasUV'].map(name=>[name,gl.getAttribLocation(this.program,name)]));
      this.uniforms=Object.fromEntries(['projection','artwork','flowTexture','noiseTexture','maskTexture','mainST','noiseST','maskST','noiseOffsets','flowPhases','intensity','flowEnabled','noiseEnabled','whiteMask','flowPower'].map(name=>[name,gl.getUniformLocation(this.program,name)]));
      this.white=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.white);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    }catch(error){this.dispose();throw error;}
  }
  configureAnisotropy(settings){if(this.anisotropy)this.gl.texParameterf(this.gl.TEXTURE_2D,this.anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(this.maxAnisotropy,Math.max(1,settings.m_Aniso??1)));}
  samplerLimitations(material){return Object.entries(material.textures||{}).filter(([,texture])=>texture.path&&Math.max(1,texture.settings?.m_Aniso??1)>this.maxAnisotropy).map(([name,texture])=>`Anisotropic filtering unavailable: ${name} (${texture.settings.m_Aniso}x requested, ${this.maxAnisotropy}x available)`);}
  uploadMips(texture,metadata,getMip){
    const levels=textureMipLevels(metadata);if(!levels.length)return false;
    const signature=JSON.stringify(levels);if(this.uploadedMips.get(texture)===signature)return true;
    const gl=this.gl,base=texture.getImage();if(base.width!==metadata.width||base.height!==metadata.height)throw new Error('Material distortion base texture dimensions differ from source');
    const images=levels.map(level=>{const image=getMip?.(level)?.getImage();if(!image||image.width!==level.width||image.height!==level.height)throw new Error('Material distortion source mip image is unavailable');return image;});
    for(let index=0;index<levels.length;index++)gl.texImage2D(gl.TEXTURE_2D,levels[index].level,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,images[index]);
    this.uploadedMips.set(texture,signature);return true;
  }
  prepare(renderer,profile,time,getTexture,stride){
    const gl=this.gl,u=this.uniforms,phases=distortionPhases(profile,time);gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.vertices);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indices);
    for(const [name,size,offset] of [['position',2,0],['light',4,8],['atlasUV',2,24]]){const location=this.attributes[name];gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,stride*4,offset);}
    gl.uniformMatrix4fv(u.projection,false,renderer.camera.projectionView.values);gl.uniform4fv(u.mainST,profile.mainST);gl.uniform4fv(u.noiseST,profile.noiseST||[1,1,0,0]);gl.uniform4fv(u.maskST,profile.maskST||[1,1,0,0]);gl.uniform4fv(u.noiseOffsets,phases.noise);gl.uniform3fv(u.flowPhases,phases.flow);gl.uniform2fv(u.intensity,profile.intensity||[0,0]);
    gl.uniform1f(u.flowEnabled,Number(profile.flow));gl.uniform1f(u.noiseEnabled,Number(profile.noise));gl.uniform1f(u.whiteMask,Number(Boolean(profile.whiteMask)));gl.uniform1f(u.flowPower,profile.flowPower||0);gl.uniform1i(u.artwork,0);
    for(const [name,uniform,unit] of [['_FlowMap','flowTexture',1],['_NoiseTex','noiseTexture',2],['_MaskTex','maskTexture',3]]){
      const result=getTexture(name);gl.activeTexture(gl.TEXTURE0+unit);
      if(result){const {texture,metadata,getMip}=result;texture.bind(unit);const settings=metadata.settings,mips=this.uploadMips(texture,metadata,getMip);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,settings.m_WrapU===0?gl.REPEAT:gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,settings.m_WrapV===0?gl.REPEAT:gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,settings.m_FilterMode===0?(mips?gl.NEAREST_MIPMAP_NEAREST:gl.NEAREST):(mips?gl.LINEAR_MIPMAP_NEAREST:gl.LINEAR));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,settings.m_FilterMode===0?gl.NEAREST:gl.LINEAR);
        this.configureAnisotropy(settings);
      }else gl.bindTexture(gl.TEXTURE_2D,this.white);gl.uniform1i(u[uniform],unit);
    }
  }
  draw(renderer,group,draw,time){
    const target=renderer.skeletonRenderer,stride=target.twoColorTint?12:8,gl=this.gl,profile=draw.distortion,material=draw.sourceMaterial;
    const getTexture=name=>{const metadata=material.textures?.[name];if(!metadata?.path)return null;const texture=group.manager.get(group.materialBase+metadata.path);if(!texture)throw new Error('Material distortion texture is unavailable');return {texture,metadata,getMip:level=>group.manager.get(group.materialBase+level.path)};};
    renderer.end();
    try{
      this.prepare(renderer,profile,time,getTexture,stride);
      let source=gl.SRC_ALPHA,destination=gl.ONE_MINUS_SRC_ALPHA,texture=null,vertices=[],indices=[];
      const flush=()=>{if(!indices.length)return;texture.bind(0);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.DYNAMIC_DRAW);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.DYNAMIC_DRAW);gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFuncSeparate(source,destination,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.drawElements(gl.TRIANGLES,indices.length,gl.UNSIGNED_SHORT,0);vertices=[];indices=[];};
      const batch={setBlendMode(src,dst){if(src!==source||dst!==destination){flush();source=src;destination=dst;}},draw(next,data,triangles){if(texture!==next||vertices.length/stride+data.length/stride>65535)flush();texture=next;const offset=vertices.length/stride;for(const value of data)vertices.push(value);for(const index of triangles){if(index+offset>65535)throw new Error('Material distortion geometry exceeds device limits');indices.push(index+offset);}}};
      const previousPMA=target.premultipliedAlpha;
      try{drawSkeletonSlots({skeletonRenderer:target,drawSkeleton(skeleton,pma){target.premultipliedAlpha=pma;target.draw(batch,skeleton);}},draw.layer.skeleton,draw.slots,draw.tint,draw.vertexColorPower);flush();}finally{target.premultipliedAlpha=previousPMA;}
    }finally{for(const location of Object.values(this.attributes))gl.disableVertexAttribArray(location);gl.activeTexture(gl.TEXTURE0);gl.disable(gl.BLEND);renderer.begin();}
  }
  dispose(){const gl=this.gl;if(this.vertices)gl.deleteBuffer(this.vertices);if(this.indices)gl.deleteBuffer(this.indices);if(this.white)gl.deleteTexture(this.white);if(this.program)gl.deleteProgram(this.program);for(const shader of this.shaders||[])gl.deleteShader(shader);}
}
