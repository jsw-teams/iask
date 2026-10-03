import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fetchService} from '../backend/handler.js';

test('probes are rejected before any backend binding or signing storage is accessed',async()=>{
  const env=new Proxy({}, {get(){throw new Error('Unexpected backend access');}});
  for(const path of ['/','/random-probe','/api/comments/admin','/api/comments/avatar/not-an-id','/api/comments/media/bad','/.env']) {
    const response=await fetchService(new Request('https://comments.example'+path),env);
    assert.equal(response.status,404,path);assert.equal(response.headers.get('cache-control'),'no-store');
  }
});

test('Cloudflare asset routing bypasses the function for roots, static assets and common probes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'iask-routing-'));
  let mf;
  try {
    await writeFile(join(dir,'404.html'),'<!doctype html><title>404</title>Not found');
    await writeFile(join(dir,'widget.0123456789abcdef.js'),'export const staticAsset=true;');
    await writeFile(join(dir,'_headers'),'/widget.0123456789abcdef.js\n  Cache-Control: public, max-age=31536000, immutable\n');
    const config=JSON.parse(await readFile(new URL('../backend/cloudflare/wrangler.production.jsonc',import.meta.url),'utf8'));
    mf=new Miniflare(convertV4MiniflareOptions({name:'routing-test',modules:true,script:"export default{fetch(){return new Response('function invoked',{headers:{'X-Function-Invoked':'yes'}})}};",compatibilityDate:config.compatibility_date,
      assets:{directory:dir,run_worker_first:config.assets.run_worker_first,routerConfig:{has_user_worker:true},assetConfig:{not_found_handling:'404-page',html_handling:'auto-trailing-slash'}}}));
    for(const path of ['/','/?probe=yes','/.env','/.git/config','/wp-admin','/commentnest/missing.js']) {
      const response=await mf.dispatchFetch('https://comments.example'+path);
      assert.equal(response.status,404,path);assert.equal(response.headers.get('X-Function-Invoked'),null,path);
    }
    const staticResponse=await mf.dispatchFetch('https://comments.example/widget.0123456789abcdef.js');
    assert.equal(staticResponse.headers.get('X-Function-Invoked'),null);assert.equal(staticResponse.headers.get('cache-control'),'public, max-age=31536000, immutable');
    const navigation=await mf.dispatchFetch('https://comments.example/random-probe',{headers:{'Sec-Fetch-Mode':'navigate'}});
    assert.equal(navigation.status,404);assert.equal(navigation.headers.get('X-Function-Invoked'),null);
    for(const path of ['/api','/frame','/auth','/api/comments','/api/comments/session','/api/comments/login','/api/comments/callback','/api/comments/media/','/api/comments/avatar/17','/commentnest/embed','/commentnest/auth-complete']) {
      const response=await mf.dispatchFetch('https://comments.example'+path,{headers:{'Sec-Fetch-Mode':'navigate'}});
      assert.equal(response.headers.get('X-Function-Invoked'),'yes',path);
    }
    // Explicit static routing also keeps non-navigation misses on the static 404 page.
    const probe=await mf.dispatchFetch('https://comments.example/random-probe');
    assert.equal(probe.status,404);assert.equal(probe.headers.get('X-Function-Invoked'),null);
  }finally{await mf?.dispose();await rm(dir,{recursive:true});}
});
