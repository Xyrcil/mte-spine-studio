export function maskedParticleProfile(source){
  const material=source.materials?.[0],floats=Object.fromEntries(material?.properties?.m_Floats||[]);
  if(material?.shader!=='AOI/Effect/AOI_Effect_UrpV2'||source.renderer?.m_RenderMode!==1||source.renderer.m_CameraVelocityScale!==0||source.renderer.m_VelocityScale!==0||material.keywords?.some(key=>!['_SCREEN_MASK_ON','_RECEIVE_SHADOWS_OFF'].includes(key))||!material.keywords?.includes('_SCREEN_MASK_ON'))throw new Error('Masked particle variant is not supported yet');
  for(const [key,value] of Object.entries(floats))if((/ON$|On$/.test(key)||['_BlendType','_MainTex_Alpha_R','_MainTexAngle','_MainTex_Uspeed','_MainTex_Vspeed','_ColorHDRIntensity','_BloomFactor'].includes(key))&&value!==0&&key!=='_ScreenMaskON')throw new Error(`Masked particle option is not supported yet: ${key}`);
  if(floats._SrcBlend!==1||floats._DstBlend!==1||floats._BlendOp!==0||floats._Alpha!==1||floats._Alpha_Intensity!==1||floats._RGBMultiply2!==1||!material.textures?._MainTex||!material.textures?._ScreenMask||source.data.UVModule?.mode!==0||source.data.UVModule.animationType!==0)throw new Error('Masked particle blend or texture layout is not supported yet');
  return {material,color:Object.fromEntries(material.properties.m_Colors||[])._Color||{r:1,g:1,b:1,a:1}};
}

export function stretchedParticleQuad(particle,source,scale=1){
  const velocity=particle.velocity,speed=Math.hypot(velocity[0],velocity[1]),direction=speed>1e-12?[velocity[0]/speed,velocity[1]/speed]:[Math.sin(particle.rotation[2]),Math.cos(particle.rotation[2])];
  const side=[direction[1],-direction[0]],width=particle.size[0]*scale,length=particle.size[1]*scale*source.renderer.m_LengthScale,pivot=source.renderer.m_Pivot||{x:0,y:0},uv=source.data.UVModule;
  const tilesX=uv.tilesX||1,tilesY=uv.tilesY||1,column=particle.frame%tilesX,row=Math.floor(particle.frame/tilesX),result=[];
  for(const [x,y,u,v] of [[-.5,-.5,0,1],[.5,-.5,1,1],[.5,.5,1,0],[-.5,.5,0,0]]){
    const across=(x-pivot.x)*width,along=(y-pivot.y)*length;
    result.push([particle.position[0]+side[0]*across+direction[0]*along,particle.position[1]+side[1]*across+direction[1]*along,(column+(particle.flipU?1-u:u))/tilesX,(row+(particle.flipV?1-v:v))/tilesY]);
  }
  return result;
}

const vertex=`attribute vec2 position;attribute vec2 uv;attribute vec4 color;uniform mat4 projection;varying vec2 texCoord;varying vec2 worldPosition;varying vec4 tint;void main(){gl_Position=projection*vec4(position,0.0,1.0);worldPosition=position;texCoord=uv;tint=color;}`;
const fragment=`precision mediump float;uniform sampler2D artwork;uniform sampler2D mask;uniform vec4 artworkST;uniform vec4 maskST;uniform vec4 sourceBounds;uniform vec4 materialColor;uniform float opacity;varying vec2 texCoord;varying vec2 worldPosition;varying vec4 tint;void main(){vec4 texel=texture2D(artwork,texCoord*artworkST.xy+artworkST.zw);vec2 screen=(worldPosition-sourceBounds.xy)/sourceBounds.zw;vec2 maskUV=screen*maskST.xy+maskST.zw;vec3 coverage=texture2D(mask,vec2(maskUV.x,1.0-maskUV.y)).rgb;vec3 emission=texel.rgb*texel.a*materialColor.rgb*tint.rgb*tint.a*coverage*opacity;gl_FragColor=vec4(min(emission,vec3(60.0)),clamp(texel.a*materialColor.a*opacity,0.0,1.0));}`;

export class MaskedParticleRenderer {
  constructor(gl){
    this.gl=gl;this.shaders=[];
    try{
      for(const [kind,text] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){const shader=gl.createShader(kind);this.shaders.push(shader);gl.shaderSource(shader,text);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));}
      this.program=gl.createProgram();for(const shader of this.shaders)gl.attachShader(this.program,shader);gl.linkProgram(this.program);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.program));
      this.buffer=gl.createBuffer();this.attributes=Object.fromEntries(['position','uv','color'].map(name=>[name,gl.getAttribLocation(this.program,name)]));this.uniforms=Object.fromEntries(['projection','artwork','mask','artworkST','maskST','sourceBounds','materialColor','opacity'].map(name=>[name,gl.getUniformLocation(this.program,name)]));
    }catch(error){this.dispose();throw error;}
  }
  draw(renderer,group,layer,maskCamera){
    const gl=this.gl,material=layer.material,profile=layer.maskedProfile,particles=layer.model.view(),vertices=[];
    for(const particle of particles){const quad=stretchedParticleQuad(particle,layer.source,Math.abs(group.scale));for(const index of [0,1,2,2,3,0]){const [x,y,u,v]=quad[index];vertices.push(x,y,u,v,...particle.color);}}
    if(!vertices.length)return;
    renderer.end();gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.DYNAMIC_DRAW);
    for(const [name,size,offset] of [['position',2,0],['uv',2,8],['color',4,16]]){const location=this.attributes[name];gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,32,offset);}
    const uniforms=this.uniforms,camera=maskCamera||{x:renderer.camera.position.x,y:renderer.camera.position.y,width:renderer.camera.viewportWidth,height:renderer.camera.viewportHeight};gl.uniformMatrix4fv(uniforms.projection,false,renderer.camera.projectionView.values);gl.uniform4f(uniforms.sourceBounds,camera.x-camera.width/2,camera.y-camera.height/2,camera.width,camera.height);gl.uniform1f(uniforms.opacity,group.opacity);const color=profile.color;gl.uniform4f(uniforms.materialColor,color.r,color.g,color.b,color.a);
    for(const [name,slot,st] of [['_MainTex',0,'artworkST'],['_ScreenMask',1,'maskST']]){const metadata=material.textures[name],texture=group.manager.get(layer.textureMap[name]);texture.bind(slot);gl.uniform1i(uniforms[name==='_MainTex'?'artwork':'mask'],slot);gl.uniform4f(uniforms[st],metadata.scale?.x??1,metadata.scale?.y??1,metadata.offset?.x??0,metadata.offset?.y??0);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,metadata.settings?.m_WrapU===0?gl.REPEAT:gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,metadata.settings?.m_WrapV===0?gl.REPEAT:gl.CLAMP_TO_EDGE);}
    gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFuncSeparate(gl.ONE,gl.ONE,gl.ONE,gl.ONE);gl.drawArrays(gl.TRIANGLES,0,vertices.length/8);
    for(const location of Object.values(this.attributes))gl.disableVertexAttribArray(location);gl.activeTexture(gl.TEXTURE0);gl.disable(gl.BLEND);renderer.begin();
  }
  dispose(){const gl=this.gl;if(this.buffer)gl.deleteBuffer(this.buffer);if(this.program)gl.deleteProgram(this.program);for(const shader of this.shaders||[])gl.deleteShader(shader);}
}
