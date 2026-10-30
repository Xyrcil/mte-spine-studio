import {defineConfig} from 'vite';
import {readdirSync,readFileSync} from 'node:fs';
const buildId=new Date().toISOString();
export default defineConfig(({mode})=>({
  build:{copyPublicDir:mode==='local-assets',assetsDir:['wallpaper','web'].includes(mode)?'app':'assets'},
  base:process.env.MTE_BASE_PATH||(mode==='wallpaper'?'./':'/'),define:{__MTE_BUILD_ID__:JSON.stringify(buildId)},
  worker:{format:'iife',rolldownOptions:{output:{entryFileNames:'sw.js'}}},
  plugins:[{name:'offline-shell',transformIndexHtml(){if(mode==='wallpaper')return [{tag:'script',children:readFileSync('src/wallpaper-bootstrap.js','utf8'),injectTo:'head-prepend'}];},generateBundle(_options,bundle){if(mode!=='local-assets')for(const file of readdirSync('public/vendor'))this.emitFile({type:'asset',fileName:'vendor/'+file,source:readFileSync('public/vendor/'+file)});if(mode==='wallpaper')return;const files=['','index.html','vendor/spine-webgl.js','vendor/SPINE-LICENSE','app-shell.json',...Object.keys(bundle).filter(name=>/\.(js|css)$/.test(name)&&name!=='sw.js')];this.emitFile({type:'asset',fileName:'app-shell.json',source:JSON.stringify({schema:1,build:buildId,files})});}}],
}));
