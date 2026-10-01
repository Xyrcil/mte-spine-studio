import {defineConfig} from 'vite';
const buildId=new Date().toISOString();
export default defineConfig({
  base:process.env.MTE_BASE_PATH||'/',define:{__MTE_BUILD_ID__:JSON.stringify(buildId)},
  worker:{format:'iife',rolldownOptions:{output:{entryFileNames:'sw.js'}}},
  plugins:[{name:'offline-shell',generateBundle(_options,bundle){const files=['','index.html','vendor/spine-webgl.js','vendor/SPINE-LICENSE','app-shell.json',...Object.keys(bundle).filter(name=>/\.(js|css)$/.test(name)&&name!=='sw.js')];this.emitFile({type:'asset',fileName:'app-shell.json',source:JSON.stringify({schema:1,build:buildId,files})});}}],
});
