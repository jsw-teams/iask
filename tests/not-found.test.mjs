import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {copyWidgetAssets} from '../tools/assets.mjs';
import {writeErrorPage} from '../tools/error-page.mjs';
import {fetchService} from '../backend/handler.js';
import {fileAssets} from '../backend/assets.js';

test('black bear 404 pages retain HTTP status, static routing, immutable assets and readable mobile layouts',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'iask-404-'));
  let mf,browser;
  try {
    const {catalog}=await copyWidgetAssets(dir);
    await writeErrorPage(dir,catalog);
    const assets=fileAssets(dir);
    const env=new Proxy({COMMENTNEST_ASSETS:assets},{get(target,name){if(name==='COMMENTNEST_ASSETS')return target[name];throw new Error('Unexpected backend access');}});
    const direct=await fetchService(new Request('https://comments.example/api/comments/not-a-route'),env);
    assert.equal(direct.status,404);
    assert.equal(direct.headers.get('cache-control'),'no-store');
    const directHtml=await direct.text();
    assert.match(directHtml,/<html lang="en">/);
    assert.match(directHtml,/Where there's a will, there's a way/);
    const head=await fetchService(new Request('https://comments.example/missing',{method:'HEAD'}),env);
    assert.equal(head.status,404);assert.equal(await head.text(),'');
    const config=JSON.parse(await readFile(new URL('../backend/cloudflare/wrangler.production.jsonc',import.meta.url),'utf8'));
    mf=new Miniflare(convertV4MiniflareOptions({name:'bear-404',modules:true,script:"export default{fetch(){return new Response('Unexpected function',{status:500})}}",compatibilityDate:config.compatibility_date,
      assets:{directory:dir,run_worker_first:config.assets.run_worker_first,routerConfig:{has_user_worker:true},assetConfig:{not_found_handling:'404-page',html_handling:'auto-trailing-slash'}}}));
    const response=await mf.dispatchFetch('https://comments.example/this-page-is-missing');
    assert.equal(response.status,404);
    const html=await response.text();
    assert(html.includes('Resource not found'));
    for(const path of [html.match(/href="(\/not-found\.[^"]+\.css)"/)[1],html.match(/src="([^"]+blackbear-think\.[^"]+\.webp)"/)[1]]) {
      const asset=await mf.dispatchFetch('https://comments.example'+path);
      assert.equal(asset.status,200);
      assert.equal(asset.headers.get('cache-control'),'public, max-age=31536000, immutable');
    }
    browser=await chromium.launch({headless:true});
    for(const width of [1440,390,320])for(const colorScheme of ['light','dark']) {
      const page=await browser.newPage({viewport:{width,height:844},colorScheme});
      await page.route('https://comments.example/**',async route=>{
        const response=await mf.dispatchFetch(route.request().url(),{headers:route.request().headers()});
        await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
      });
      const navigation=await page.goto('https://comments.example/this-page-is-missing');
      assert.equal(navigation.status(),404);
      assert.equal(await page.locator('main h1').count(),1);
      assert.equal(await page.locator('html').getAttribute('lang'),'en');
      assert.match(await page.locator('.proverb').textContent(),/Where there's a will, there's a way/);
      assert(await page.locator('.bear-scene img').evaluate(image=>image.complete&&image.naturalWidth>0));
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      assert(await page.locator('figcaption').evaluate(node=>parseFloat(getComputedStyle(node).fontSize)>=14));
      await page.keyboard.press('Tab');
      assert(await page.locator('.skip-link').evaluate(node=>node===document.activeElement));
      if(width===390)await page.screenshot({path:join(tmpdir(),'iask-404-'+colorScheme+'.png'),fullPage:true});
      await page.close();
    }
    for(const colorScheme of ['light','dark']) {
      const page=await browser.newPage({viewport:{width:320,height:844},colorScheme});
      page.on('request',request=>assert.equal(request.url(),'https://comments.example/missing'));
      await page.route('https://comments.example/missing',async route=>{
        const response=await fetchService(new Request(route.request().url()),{});
        await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
      });
      assert.equal((await page.goto('https://comments.example/missing')).status(),404);
      assert(await page.locator('.bear-scene svg').isVisible());
      assert.equal(await page.locator('main').evaluate(node=>getComputedStyle(node).display),'grid');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await page.close();
    }
  }finally{await browser?.close();await mf?.dispose();await rm(dir,{recursive:true});}
});

test('missing or failed asset bindings retain the illustrated English fallback without reflecting request input',async()=>{
  for(const env of [{},{ASSETS:{fetch:async()=>{throw new Error('offline');}}}]) {
    const response=await fetchService(new Request('https://comments.example/missing?private=do-not-display'),env);
    assert.equal(response.status,404);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.match(response.headers.get('Content-Security-Policy'),/style-src 'self' 'sha256-/);
    assert.doesNotMatch(response.headers.get('Content-Security-Policy'),/unsafe-inline/);
    const html=await response.text();
    assert.match(html,/<html lang="en">/);
    assert.match(html,/<svg[^>]+role="img"/);
    assert.match(html,/Where there's a will, there's a way/);
    assert.doesNotMatch(html,/do-not-display|<script/);
  }
});
