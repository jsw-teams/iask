import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPostgresNamespace} from '../backend/vercel/storage.js';
import {createVercelHandler} from '../backend/vercel/handler.js';
import {fileAssets} from '../backend/vercel/assets.js';
import {CommentCoordinator} from '../backend/comments.js';
import {loadDictionary,canonicalLocale,localeCandidates,direction} from '../static/commentnest/i18n.js';
import {contrast} from '../static/commentnest/palette.js';
import {copyWidgetAssets} from '../tools/assets.mjs';

test('platform adapters fail closed, preserve durable keys and release database locks on failure',async()=>{
  const state=new Map(),calls=[];let released=0;
  const client={
    async query(sql,args=[]) {
      calls.push(sql);
      if(sql.startsWith('SELECT value'))return {rows:state.has(args[0]+args[1])?[{value:state.get(args[0]+args[1])}]:[]};
      if(sql.startsWith('INSERT'))state.set(args[0]+args[1],JSON.parse(args[2]));
      return {rows:[]};
    },release(){released++;}
  };
  const pool={query:async()=>({rows:[]}),connect:async()=>client,end:async()=>{}};
  const namespace=createPostgresNamespace(null,{pool});namespace.bindEnvironment({});
  const read=()=>namespace.get('signing:one').fetch(new Request('https://internal/__reporelay/keys'));
  const first=await (await read()).json(),second=await (await read()).json();
  assert.equal(first.session,second.session);assert.equal(first.identity,second.identity);
  assert.notEqual((await (await namespace.get('signing:two').fetch(new Request('https://internal/__reporelay/keys'))).json()).identity,first.identity);
  assert.equal(released,3);assert.equal(calls.filter(sql=>sql.includes('pg_advisory_unlock')).length,3);
  const handler=createVercelHandler({});const unavailable=await handler(new Request('https://comments.example/api/comments'));
  assert.equal(unavailable.status,503);assert.equal(unavailable.headers.get('cache-control'),'no-store');
  const original=CommentCoordinator.prototype.fetch;
  try {
    CommentCoordinator.prototype.fetch=async()=>{throw new Error('simulated operation failure');};
    await assert.rejects(read(),/simulated/);assert.equal(released,4);assert.ok(calls.at(-1).includes('pg_advisory_unlock'));
  }finally{CommentCoordinator.prototype.fetch=original;}
});

test('all language packs build with immutable names; regional tags, RTL and unavailable packs fall back safely',async()=>{
  const output=await mkdtemp(join(tmpdir(),'commentnest-languages-'));
  try {
    await copyWidgetAssets(output);await copyWidgetAssets(output);
    const manifest=JSON.parse(await readFile(join(output,'commentnest/manifest.json'),'utf8'));
    assert.equal(canonicalLocale('es-mx'),'es-MX');assert.equal(canonicalLocale('invalid_tag'),'en');
    assert.ok(localeCandidates('zh-Hant-HK').includes('zh-TW'));assert.equal(direction('ar-EG'),'rtl');assert.equal(direction('en'),'ltr');
    const original=globalThis.fetch;
    globalThis.fetch=async address=>new Response(await readFile(join(output,new URL(address,'https://comments.example').pathname)));
    try {
      const pack=await loadDictionary('ja-JP',manifest.localeFiles);assert.equal(pack.locale,'ja');assert.equal(pack.messages.commentsTitle,'コメント');
      const arabic=await loadDictionary('ar-EG',manifest.localeFiles);assert.equal(arabic.locale,'ar');
      assert.equal((await loadDictionary('xx-YY',manifest.localeFiles)).locale,'en');
      globalThis.fetch=async()=>new Response('',{status:503});assert.equal((await loadDictionary('fr-FR',manifest.localeFiles)).locale,'en');
    }finally{globalThis.fetch=original;}
    const headers=await readFile(join(output,'_headers'),'utf8');assert.match(headers,/max-age=31536000, immutable/);
    for(const path of Object.values(manifest.localeFiles))assert.match(path,/\.[a-f0-9]{16}\.json$/);
    const assets=fileAssets(output);
    assert.equal((await assets.fetch(new Request('https://comments.example/commentnest/widget.js'))).status,200);
    assert.equal((await assets.fetch(new Request('https://comments.example/commentnest/%2e%2e%2f..%2fpackage.json'))).status,404);
    assert.equal((await assets.fetch(new Request('https://comments.example/commentnest/%5c..%5cpackage.json'))).status,404);
    assert.ok(contrast('#000000','#ffffff')>=21);assert.equal(contrast('transparent','#ffffff'),0);
  }finally{await rm(output,{recursive:true});}
});

test('Vercel serves hashed assets statically and routes only dynamic service entry points',async()=>{
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.ok(!config.rewrites.some(rule=>rule.source==='/commentnest/:path*'));
  assert.ok(config.rewrites.some(rule=>rule.source==='/commentnest/embed'));
  assert.ok(config.headers.some(rule=>rule.headers.some(header=>header.value.includes('immutable'))));
  const worker=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  assert.ok(Array.isArray(worker.assets.run_worker_first));
  assert.ok(!worker.assets.run_worker_first.includes('/commentnest/*'));
});
