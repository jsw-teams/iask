import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {notFoundPage,notFoundStyles} from '../static/not-found-page.js';

export async function writeErrorPage(output,catalog) {
  const css=notFoundStyles;
  const stylesheet='not-found.'+createHash('sha256').update(css).digest('hex').slice(0,16)+'.css';
  await writeFile(resolve(output,stylesheet),css);
  const bear=catalog.packs.find(pack=>pack.id==='blackbear')?.items.find(item=>item.token===':blackbear-think:')?.src;
  if(!bear)throw new Error('Missing black bear illustration');
  const page=notFoundPage({stylesheet:'/'+stylesheet,illustration:bear});
  await writeFile(resolve(output,'404.html'),page);
  const headers=await readFile(resolve(output,'_headers'),'utf8');
  await writeFile(resolve(output,'_headers'),'/*\n  Content-Security-Policy: default-src \'none\'; style-src \'self\'; img-src \'self\'; base-uri \'none\'; form-action \'none\'; frame-ancestors \'none\'\n'+headers+'\n/'+stylesheet+'\n  Cache-Control: public, max-age=31536000, immutable\n');
}
