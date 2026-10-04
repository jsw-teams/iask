import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

export async function writeErrorPage(output,catalog) {
  const css=await readFile(new URL('../static/not-found.css',import.meta.url));
  const stylesheet='not-found.'+createHash('sha256').update(css).digest('hex').slice(0,16)+'.css';
  await writeFile(resolve(output,stylesheet),css);
  const bear=catalog.packs.find(pack=>pack.id==='blackbear')?.items.find(item=>item.token===':blackbear-think:')?.src;
  if(!bear)throw new Error('Missing black bear illustration');
  const page=(await readFile(new URL('../static/404.html',import.meta.url),'utf8')).replaceAll('__ERROR_STYLESHEET__','/'+stylesheet).replaceAll('__BLACKBEAR_IMAGE__',bear);
  await writeFile(resolve(output,'404.html'),page);
  const headers=await readFile(resolve(output,'_headers'),'utf8');
  await writeFile(resolve(output,'_headers'),'/*\n  Cache-Control: public, max-age=0, must-revalidate\n  Content-Security-Policy: default-src \'none\'; style-src \'self\'; img-src \'self\'; base-uri \'none\'; form-action \'none\'; frame-ancestors \'none\'\n'+headers+'\n/'+stylesheet+'\n  Cache-Control: public, max-age=31536000, immutable\n');
}
