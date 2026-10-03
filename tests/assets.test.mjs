import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {copyWidgetAssets} from '../tools/assets.mjs';
import {handleServiceRequest} from '../backend/service.js';
test('built widget has a coherent fingerprinted dependency graph and immutable sticker assets',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'commentnest-assets-'));
 try {
  await copyWidgetAssets(dir);
  const root=join(dir,'commentnest'),manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
  const embed=await readFile(join(root,manifest['embed.js']),'utf8');
  for(const name of ['i18n.js','markup.js','comments.js'])assert.ok(embed.includes(manifest[name]));
  assert.ok((await readFile(join(root,manifest['i18n.js']),'utf8')).includes(manifest['locales.js']));
  const comments=await readFile(join(root,manifest['comments.js']),'utf8');
  const catalogPath=comments.match(/\/commentnest\/(stickers\/packs\.[a-f0-9]{16}\.json)/)[1];
  const catalog=JSON.parse(await readFile(join(root,catalogPath),'utf8'));
  for(const pack of catalog.packs)for(const item of pack.items){assert.match(item.src,/\.[a-f0-9]{16}\.png$/);assert.ok((await readFile(join(dir,item.src.slice(1)))).length>0);}
  const env={COMMENTNEST_SITE_ORIGIN:'https://comments.example',COMMENTNEST_WEBSITE_ORIGIN:'https://website.example',ASSETS:{fetch:async request=>new Response(await readFile(join(dir,new URL(request.url).pathname.slice(1))))}};
  const params=new URLSearchParams({parent:env.COMMENTNEST_WEBSITE_ORIGIN,thread:'post',channel:'a'.repeat(32)});
  const html=await (await handleServiceRequest(new Request(env.COMMENTNEST_SITE_ORIGIN+'/commentnest/embed?'+params),env)).text();assert.ok(html.includes(manifest['embed.js']));assert.ok(html.includes(manifest['widget.css']));
  const response=await handleServiceRequest(new Request(env.COMMENTNEST_SITE_ORIGIN+catalog.packs[0].items[0].src),env);assert.equal(response.headers.get('cache-control'),'public, max-age=31536000, immutable');
  const entry=await handleServiceRequest(new Request(env.COMMENTNEST_SITE_ORIGIN+'/commentnest/widget.js'),env);assert.equal(entry.headers.get('cache-control'),'public, max-age=60, must-revalidate');
  const headers=await readFile(join(dir,'_headers'),'utf8');
  assert.doesNotMatch(headers,/\/commentnest\/\*\n(?:  [^\n]+\n)*  Cache-Control:/,'A broad rule must not append a second max-age to hashed files');
  await assert.rejects(readFile(join(root,'embed.js')),/ENOENT/,'Unreachable source modules are omitted from deployed assets');
  const obsolete=join(root,'embed.0000000000000000.js');
  const {writeFile}=await import('node:fs/promises');await writeFile(obsolete,'old graph');
  await copyWidgetAssets(dir);await assert.rejects(readFile(obsolete),/ENOENT/,'Rebuilds prune stale fingerprinted modules');
 }finally{await rm(dir,{recursive:true});}
});
