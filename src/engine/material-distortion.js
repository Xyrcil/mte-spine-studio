const pairs=value=>Array.isArray(value)?Object.fromEntries(value):value||{};
const finite=(value,name)=>{if(!Number.isFinite(value))throw new Error(`Material distortion ${name} is unavailable`);return value;};
const st=(value,name)=>[finite(value?.m_Scale?.x,name),finite(value?.m_Scale?.y,name),finite(value?.m_Offset?.x,name),finite(value?.m_Offset?.y,name)];
const transform=(uv,values)=>[uv[0]*values[0]+values[2],uv[1]*values[1]+values[3]];
const pngUV=uv=>[uv[0],1-uv[1]];
const fract=value=>value-Math.floor(value);

export function textureMipLevels(texture){
  if(texture.mipCount===undefined)return [];
  const count=texture.mipCount,levels=texture.mips;
  if(!Number.isInteger(count)||count<1||!Array.isArray(levels)||levels.length!==count-1)throw new Error('Material distortion source mip chain is unavailable');
  if(count===1)return levels;
  if(!Number.isInteger(Math.log2(texture.width))||!Number.isInteger(Math.log2(texture.height))||count!==Math.log2(Math.max(texture.width,texture.height))+1)throw new Error('Material distortion source mip dimensions exceed renderer limits');
  for(let index=0;index<levels.length;index++){const level=index+1,row=levels[index];if(row.level!==level||row.width!==Math.max(1,texture.width/2**level)||row.height!==Math.max(1,texture.height/2**level)||typeof row.path!=='string'||!row.path)throw new Error('Material distortion source mip level is unavailable');}
  return levels;
}

export function distortionSettings(material){
  const flow=material.keywords?.includes('_FLOW_MAP_ON'),noise=material.keywords?.includes('_NOISE_TEX_ON');
  if(!flow&&!noise)return null;
  if(material.shader!=='Spine/Skeleton')throw new Error('Material distortion shader is unavailable');
  if(!material.keywords.includes('_STRAIGHT_ALPHA_INPUT'))throw new Error('Material distortion premultiplied texture input is unavailable');
  const floats=pairs(material.properties?.m_Floats),envs=pairs(material.properties?.m_TexEnvs),result={flow:Boolean(flow),noise:Boolean(noise),mainST:st(envs._MainTex,'artwork transform')};
  const texture=name=>{const value=material.textures?.[name];if(!value?.path&&!(name==='_MaskTex'&&value?.default==='white'))throw new Error(`Material distortion texture ${name} is unavailable`);if(value.path){const settings=value.settings;if(!settings||![0,1].includes(settings.m_FilterMode)||![0,1].includes(settings.m_WrapU)||![0,1].includes(settings.m_WrapV))throw new Error(`Material distortion sampler ${name} is unavailable`);if((settings.m_WrapU===0||settings.m_WrapV===0)&&(!Number.isInteger(Math.log2(value.width))||!Number.isInteger(Math.log2(value.height))))throw new Error(`Material distortion repeat texture ${name} exceeds renderer limits`);}return value;};
  for(const value of Object.values(material.textures||{}))if(value.path){textureMipLevels(value);const settings=value.settings;if(settings?.m_Aniso!==undefined&&(!Number.isInteger(settings.m_Aniso)||settings.m_Aniso<0||settings.m_Aniso>16))throw new Error('Material distortion anisotropic sampler is unavailable');if(settings?.m_MipBias!==undefined&&settings.m_MipBias!==0)throw new Error('Material distortion mip bias is unavailable');}
  if(flow){texture('_FlowMap');result.flowSpeed=finite(floats._FlowSpeed,'flow speed');result.flowPower=finite(floats._FlowPower,'flow strength');}
  if(noise){texture('_NoiseTex');const mask=texture('_MaskTex');result.whiteMask=mask.default==='white';result.noiseST=st(envs._NoiseTex,'noise transform');if(!result.whiteMask)result.maskST=st(envs._MaskTex,'mask transform');result.noisePower=finite(floats._NoiseDistortPower,'noise speed');result.intensity=[finite(floats._DistortIntensityX,'horizontal strength'),finite(floats._DistortIntensityY,'vertical strength')];}
  return result;
}

export function distortionPhases(settings,time){
  finite(time,'time');if(time<0)throw new Error('Material distortion time must be non-negative');
  const phase=fract(time*(settings.flowSpeed||0)*.1);
  return {flow:[phase,fract(phase+.5),Math.abs(phase*2-1)],noise:[time/20,time*2,time,time*3].map(value=>(value*(settings.noisePower||0))%1)};
}

export function sampleDistortedTexel(settings,webUV,time,sample){
  const sourceUV=pngUV(webUV),phases=distortionPhases(settings,time);let artworkUV=transform(sourceUV,settings.mainST);
  if(settings.noise){
    const uv=transform(sourceUV,settings.noiseST),offset=phases.noise;
    const strength=sample('_NoiseTex',pngUV([uv[0]+offset[0],uv[1]+offset[1]]))[0]+sample('_NoiseTex',pngUV([uv[0]+offset[2],uv[1]+offset[3]]))[0];
    const mask=settings.whiteMask?[1,1]:sample('_MaskTex',pngUV(transform(sourceUV,settings.maskST)));
    artworkUV=artworkUV.map((value,index)=>value+mask[index]*(sourceUV[index]+strength*settings.intensity[index]-value));
  }
  if(!settings.flow)return sample('_MainTex',pngUV(artworkUV));
  const vector=sample('_FlowMap',webUV).slice(0,2).map(value=>(value*2-1)*settings.flowPower);
  const first=sample('_MainTex',pngUV(artworkUV.map((value,index)=>value-phases.flow[0]*vector[index]))),second=sample('_MainTex',pngUV(artworkUV.map((value,index)=>value-phases.flow[1]*vector[index])));
  return first.map((value,index)=>value+(second[index]-value)*phases.flow[2]);
}

export function hasMaterialDistortion(entry){return entry?.materialBindings?.pages?.some(page=>Object.values(page.materials).some(material=>material.keywords?.some(keyword=>['_FLOW_MAP_ON','_NOISE_TEX_ON'].includes(keyword))))||false;}
