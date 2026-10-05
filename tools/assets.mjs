import {cp,mkdir,readFile,writeFile,readdir,unlink} from 'node:fs/promises';
import {dictionaries} from '../static/commentnest/locales.js';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
const fingerprint=bytes=>createHash('sha256').update(bytes).digest('hex').slice(0,16);
export async function copyWidgetAssets(destination) {
  const target=resolve(destination,'commentnest');
  if(target===fileURLToPath(new URL('../static/commentnest/',import.meta.url)).replace(/[\\/]$/,''))throw new Error('Asset output must be separate from source files');
  await mkdir(target,{recursive:true});
  await cp(new URL('../static/commentnest/',import.meta.url),target,{recursive:true});
  await cp(new URL('../content/assets/commentnest/stickers/',import.meta.url),resolve(target,'stickers'),{recursive:true});
  const catalog=JSON.parse(await readFile(resolve(target,'stickers/packs.json'),'utf8'));
  const hashedImages=new Map();
  for(const pack of catalog.packs)for(const item of pack.items){
    if(hashedImages.has(item.src)){item.src=hashedImages.get(item.src);continue;}
    const file=item.src?.replace(/^\/commentnest\//,'');
    if(!file || !/^stickers\/[A-Za-z0-9_/-]+\.(png|gif|jpg|webp|avif)$/.test(file))throw new Error('Invalid sticker asset');
    // Publish small transparent renditions; retain generated originals as build inputs.
    const bytes=await sharp(await readFile(resolve(target,file))).resize(192,192,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).webp({quality:85,alphaQuality:100,effort:6}).toBuffer();
    const hashed=file.replace(/\.(\w+)$/,'.'+fingerprint(bytes)+'.webp');
    await writeFile(resolve(target,hashed),bytes);hashedImages.set(item.src,'/commentnest/'+hashed);item.src='/commentnest/'+hashed;
  }
  const catalogText=JSON.stringify(catalog),catalogName='stickers/packs.'+fingerprint(catalogText)+'.json';
  await writeFile(resolve(target,catalogName),catalogText);
  // Hash dependencies before entry points so every cached module graph stays coherent.
  const localeFiles={};
  await mkdir(resolve(target,'languages'),{recursive:true});
  for(const file of await readdir(new URL('../static/commentnest/languages/',import.meta.url))) {
    if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*\.json$/.test(file)) throw new Error('Language packs need canonical BCP 47 filenames');
    const source=await readFile(resolve(target,'languages',file),'utf8'), pack=JSON.parse(source);
    if (!pack || Array.isArray(pack) || Object.entries(pack).some(([key,value])=>!Object.hasOwn(dictionaries.en,key) || typeof value!=='string' || value.length>2000)) throw new Error('Invalid language pack: '+file);
    const name=file.slice(0,-5)+'.'+fingerprint(source)+'.json';
    await writeFile(resolve(target,'languages',name),source);localeFiles[file.slice(0,-5)]='languages/'+name;
  }
  const manifest={};
  for(const file of ['website.js','locales.js','i18n.js','palette.js','markup.js','stickers.js','editor.js','client.js','comments.js','widget.js','embed.js','widget.css']){
    let text=await readFile(resolve(target,file),'utf8');
    for(const [name,hashed] of Object.entries(manifest))text=text.replaceAll('./'+name,'./'+hashed);
    text=text.replaceAll('/commentnest/stickers/packs.json','/commentnest/'+catalogName);
    const hashed=file.replace(/\.(js|css)$/,'.'+fingerprint(text)+'.$1');
    await writeFile(resolve(target,hashed),text);manifest[file]=hashed;
  }
  await writeFile(resolve(target,'widget.js'),"export {mount} from './"+manifest['widget.js']+"';\n");
  await writeFile(resolve(target,'manifest.json'),JSON.stringify({...manifest,localeFiles}));
  const immutable=[...new Set([...Object.values(manifest),...Object.values(localeFiles),catalogName,...catalog.packs.flatMap(pack=>pack.items.map(item=>item.src.slice('/commentnest/'.length)))])];
  await writeFile(resolve(destination,'_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n/commentnest/*\n  Access-Control-Allow-Origin: *\n  Cross-Origin-Resource-Policy: cross-origin\n/commentnest/manifest.json\n  Cache-Control: public, max-age=300, must-revalidate\n/commentnest/widget.js\n  Cache-Control: public, max-age=60, must-revalidate\n' + immutable.map(file=>'/commentnest/'+file+'\n  Cache-Control: public, max-age=31536000, immutable\n').join(''));
  // Keep only the reachable module graph and catalog, including on repeated builds.
  // Unlink individual generated files; never recursively remove a supplied directory.
  const reachable=new Set([...immutable,'manifest.json','widget.js']);
  async function prune(directory,prefix='') {
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const file=prefix+entry.name,path=resolve(directory,entry.name);
      if(entry.isDirectory())await prune(path,file+'/');
      else if(entry.isFile() && !reachable.has(file) && (/\.[a-f0-9]{16}\./.test(file) || Object.hasOwn(manifest,file) || /^languages\/.+\.json$/.test(file) || file==='stickers/packs.json' || /^stickers\/.+\.(png|gif|jpg|webp|avif)$/.test(file)))await unlink(path);
    }
  }
  await prune(target);
  return {manifest,catalog};
}
