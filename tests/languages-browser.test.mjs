import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {copyWidgetAssets} from '../tools/assets.mjs';
import {fileAssets} from '../backend/vercel/assets.js';
import {handleServiceRequest} from '../backend/service.js';
import {dictionaries} from '../static/commentnest/locales.js';
import {contrast} from '../static/commentnest/palette.js';

test('built language packs render regional tags, RTL, host colors and platform upload limits on mobile',async()=>{
  const output=await mkdtemp(join(tmpdir(),'commentnest-browser-'));
  let browser;
  try {
    await copyWidgetAssets(output);
    const manifest=JSON.parse(await readFile(join(output,'commentnest/manifest.json'),'utf8'));
    const assets=fileAssets(output);
    const service='https://comments.example.com',website='https://journal.example.com';
    const env={COMMENTNEST_SITE_ORIGIN:service,COMMENTNEST_WEBSITE_ORIGIN:website,COMMENTNEST_MAX_ATTACHMENT_BYTES:4_000_000,COMMENTNEST_ASSETS:assets};
    browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
    for(const locale of Object.keys(manifest.localeFiles)) {
      const context=await browser.newContext({viewport:{width:360,height:800},colorScheme:'dark',reducedMotion:'reduce'});
      const errors=[];
      await context.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.origin===website) return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="'+locale+'-ZZ" data-theme="dark"><style>body{margin:8px;background:#111827;color:#f9fafb}section{--canvas:#111827;--ink:#f9fafb;--accent:#222222;--surface:#1f2937}</style><main><section id="service"></section></main><script type="module">import{mount}from"'+service+'/commentnest/widget.js";mount(document.getElementById("service"),{backendUrl:"'+service+'",thread:"article",title:"Article"});</script></html>'});
        assert.equal(url.origin,service);
        if(url.pathname==='/api' && route.request().headers()['x-service-action']==='session')return route.fulfill({json:{user:{id:17,login:'Reader'},csrf:'csrf'}});
        if(url.pathname==='/api' && route.request().headers()['x-service-action']==='comments')return route.fulfill({json:{comments:[],closed:false}});
        const response=url.pathname==='/frame' ? await handleServiceRequest(new Request(url),env) : await assets.fetch(new Request(url));
        return route.fulfill({status:response.status,headers:{...Object.fromEntries(response.headers),'Access-Control-Allow-Origin':'*'},body:Buffer.from(await response.arrayBuffer())});
      });
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
      await page.goto(website+'/article/');
      const frame=page.frameLocator('iframe');await frame.locator('[data-comments-form]').waitFor({state:'visible'});
      const dictionary=JSON.parse(await readFile(join(output,'commentnest',manifest.localeFiles[locale]),'utf8'));
      assert.equal(await frame.locator('h2').textContent(),dictionary.commentsTitle);
      assert.equal(await frame.locator('html').getAttribute('lang'),locale);
      assert.equal(await frame.locator('html').getAttribute('dir'),['ar','he'].includes(locale)?'rtl':'ltr');
      assert.match(await frame.locator('#comment-attachment-help').textContent(),/4 MB/);
      assert.match(await frame.locator('[data-commentnest-comments]').getAttribute('data-comments-attachment-too-large'),/4 MB/);
      await page.waitForFunction(()=>parseInt(document.querySelector('iframe').style.height)>300);
      await page.frames().find(frame=>frame.url().startsWith(service+'/frame')).waitForFunction(()=>document.documentElement.style.getPropertyValue('--canvas')==='#111827');
      assert.ok(await frame.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      const palette=await frame.locator('html').evaluate(node=>({ink:node.style.getPropertyValue('--ink'),canvas:node.style.getPropertyValue('--canvas'),accent:node.style.getPropertyValue('--accent')}));
      assert.equal(palette.canvas,'#111827');assert.ok(contrast(palette.ink,palette.canvas)>=4.5);assert.ok(contrast(palette.accent,palette.canvas)>=4.5,'Inaccessible host accent must fall back');
      if(locale==='ar') {
        await frame.locator('textarea').focus();await page.keyboard.press('Tab');
        assert.ok(await frame.locator('[data-comments-stickers-toggle]').evaluate(node=>node===document.activeElement));
        await page.emulateMedia({forcedColors:'active'});
        assert.ok(await frame.locator('html').evaluate(()=>matchMedia('(forced-colors: active)').matches));
      }
      assert.deepEqual(errors,[]);await context.close();
    }
    assert.equal(Object.keys(manifest.localeFiles).length+Object.keys(dictionaries).length,17);
  }finally{await browser?.close();await rm(output,{recursive:true});}
});
