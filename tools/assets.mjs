import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const fingerprint=bytes=>createHash('sha256').update(bytes).digest('hex').slice(0,16);
export async function copyWidgetAssets(destination) {
  const target=resolve(destination,'commentnest');
  await mkdir(target,{recursive:true});
  await cp(new URL('../static/commentnest/',import.meta.url),target,{recursive:true});
  await cp(new URL('../content/assets/commentnest/stickers/',import.meta.url),resolve(target,'stickers'),{recursive:true});
  const catalog=JSON.parse(await readFile(resolve(target,'stickers/packs.json'),'utf8'));
  for(const pack of catalog.packs)for(const item of pack.items){
    const file=item.src?.replace(/^\/commentnest\//,'');
    if(!file || !/^stickers\/[A-Za-z0-9_/-]+\.(png|gif|jpg|webp|avif)$/.test(file))throw new Error('Invalid sticker asset');
    const bytes=await readFile(resolve(target,file));
    const hashed=file.replace(/\.(\w+)$/,'.'+fingerprint(bytes)+'.$1');
    await writeFile(resolve(target,hashed),bytes);item.src='/commentnest/'+hashed;
  }
  const catalogText=JSON.stringify(catalog),catalogName='stickers/packs.'+fingerprint(catalogText)+'.json';
  await writeFile(resolve(target,catalogName),catalogText);
  // Hash dependencies before entry points so every cached module graph stays coherent.
  const manifest={};
  for(const file of ['locales.js','markup.js','comments.js','widget.js','embed.js','widget.css']){
    let text=await readFile(resolve(target,file),'utf8');
    for(const [name,hashed] of Object.entries(manifest))text=text.replaceAll('./'+name,'./'+hashed);
    text=text.replaceAll('/commentnest/stickers/packs.json','/commentnest/'+catalogName);
    const hashed=file.replace(/\.(js|css)$/,'.'+fingerprint(text)+'.$1');
    await writeFile(resolve(target,hashed),text);manifest[file]=hashed;
  }
  await writeFile(resolve(target,'widget.js'),"export {mount} from './"+manifest['widget.js']+"';\n");
  await writeFile(resolve(target,'manifest.json'),JSON.stringify(manifest));
}
