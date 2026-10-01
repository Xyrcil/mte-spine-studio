import {defineConfig} from 'vite';
import {readdirSync,readFileSync} from 'node:fs';
const buildId=new Date().toISOString();
export default defineConfig(({mode})=>({
  build:{copyPublicDir:mode==='local-assets'},
  base:process.env.MTE_BASE_PATH||'/',define:{__MTE_BUILD_ID__:JSON.stringify(buildId)},
  worker:{format:'iife',rolldownOptions:{output:{entryFileNames:'sw.js'}}},
  plugins:[{name:'offline-shell',generateBundle(_options,bundle){if(mode!=='local-assets')for(const file of readdirSync('public/vendor'))this.emitFile({type:'asset',fileName:'vendor/'+file,source:readFileSync('public/vendor/'+file)});const files=['','index.html','vendor/spine-webgl.js','vendor/SPINE-LICENSE','app-shell.json',...Object.keys(bundle).filter(name=>/\.(js|css)$/.test(name)&&name!=='sw.js')];this.emitFile({type:'asset',fileName:'app-shell.json',source:JSON.stringify({schema:1,build:buildId,files})});}}],
}));
