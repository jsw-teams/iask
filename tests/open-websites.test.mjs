import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {chromium} from 'playwright';
import {embeddingWebsite} from '../backend/websites.js';
import {websiteOrigin} from '../static/commentnest/website.js';
import {fetchPublicManifest,publicAddress} from '../backend/public-website-node.js';
import {fetchService} from '../backend/handler.js';
import {handleCommentRequest} from '../backend/comments.js';
import {copyWidgetAssets} from '../tools/assets.mjs';
import {fileAssets} from '../backend/assets.js';
import {appDefaults,mockInstallation,mockRepositoryInstallation} from './helpers.mjs';

test('unregistered websites receive stable separate namespaces and unsafe origins are rejected',async()=>{
  const configured=[{origin:'https://js.gripe',prefix:''},{origin:'https://connect.js.gripe',prefix:'connect:'},{origin:'https://signal.js.gripe',prefix:'signal:'}];
  for(const site of configured)assert.deepEqual(await embeddingWebsite(configured,site.origin),site);
  const first=await embeddingWebsite(configured,'https://first.example');
  const second=await embeddingWebsite(configured,'https://second.example');
  assert.notEqual(first.prefix,second.prefix);
  assert.deepEqual(await embeddingWebsite(configured,'https://FIRST.example/'),first);
  assert(await embeddingWebsite(configured,'https://first.example:8443'));
  for(const value of ['null','http://first.example','https://localhost','https://127.0.0.1','https://[::1]','https://server.local','https://server.internal','https://user:pass@first.example','https://first.example/path','https://first.example/?query=yes'])assert.equal(websiteOrigin(value),null,value);
  const unopened=new Proxy({}, {get(){throw new Error('Unexpected backend access');}});
  const invalid=await fetchService(new Request('https://comments.example/api',{headers:{'X-Service-Action':'comments','X-Service-Thread':'article','X-Service-Website':'https://127.0.0.1'}}),unopened);
  assert.equal(invalid.status,400);assert.equal((await invalid.json()).error,'invalid_website');
});

test('Node manifest requests reject private DNS results and pin one public address without credentials',async()=>{
  for(const address of ['127.0.0.1','10.0.0.1','172.31.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1'])assert.equal(publicAddress(address),false,address);
  assert.equal(publicAddress('8.8.8.8'),true);
  assert.equal(publicAddress('2606:4700:4700::1111'),true);
  let sends=0,lookups=0;
  for(const addresses of [[{address:'127.0.0.1',family:4}],[{address:'8.8.8.8',family:4},{address:'::1',family:6}]])await assert.rejects(fetchPublicManifest('https://first.example/edgepress/service-contexts.json',{
    resolveHost:async()=>addresses,send:()=>{sends++;throw new Error('Unexpected connection');}
  }),/public addresses/);
  assert.equal(sends,0);
  const response=await fetchPublicManifest('https://first.example/edgepress/service-contexts.json',{
    resolveHost:async()=>{lookups++;return [{address:'8.8.8.8',family:4}];},
    send:(url,options,callback)=>{
      assert.equal(url.hostname,'first.example');
      assert.deepEqual(options.headers,{Accept:'application/json'});
      options.lookup(url.hostname,{all:true},(error,addresses)=>{assert.equal(error,null);assert.deepEqual(addresses,[{address:'8.8.8.8',family:4}]);});
      const outgoing=new EventEmitter();outgoing.end=()=>{
        const incoming=Readable.from([Buffer.from('[]')]);incoming.statusCode=200;incoming.headers={'content-type':'application/json'};callback(incoming);
      };return outgoing;
    }
  });
  assert.equal(lookups,1);assert.equal(await response.text(),'[]');
  await assert.rejects(fetchPublicManifest('https://first.example/other-path'),/Invalid website manifest/);
});

test('new website frames read only their own published contexts and propagate website headers',async()=>{
  const original=globalThis.fetch,output=await mkdtemp(join(tmpdir(),'iask-open-websites-'));
  let browser;
  const service='https://comments.example',primary='https://journal.example',hosts=['https://first.example','https://second.example'];
  const calls=[],scopes=[],api=[];
  const env={...appDefaults,COMMENTNEST_SITE_ORIGIN:service,COMMENTNEST_WEBSITE_ORIGIN:primary,COMMENTNEST_REPOSITORY:'owner/comments',
    COMMENTNEST_GITHUB_APP_CLIENT_ID:'app',COMMENTNEST_GITHUB_APP_CLIENT_SECRET:'secret',COMMENTNEST_SESSION_SECRET:'s'.repeat(64),COMMENTNEST_IDENTITY_SECRET:'i'.repeat(64)};
  env.COMMENTNEST_THREADS={idFromName:name=>{scopes.push(name);return name;},get:()=>({fetch:request=>handleCommentRequest(request,env,{coordinated:true})})};
  globalThis.fetch=async(url,options)=>{
    const address=String(url);calls.push(address);
    if(hosts.some(host=>address===host+'/edgepress/service-contexts.json'))return Response.json([{thread:'article',title:'Published article'}]);
    if(address.endsWith('/installation'))return mockRepositoryInstallation(url,options);
    if(address.includes('/app/installations/'))return mockInstallation();
    if(address.startsWith('https://api.github.com/search/issues'))return Response.json({items:[]});
    throw new Error('Unexpected upstream: '+address);
  };
  try {
    await copyWidgetAssets(output);env.COMMENTNEST_ASSETS=fileAssets(output);
    browser=await chromium.launch({headless:true});
    for(const host of hosts) {
      const context=await browser.newContext({viewport:{width:390,height:844}});
      await context.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.origin===host)return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><main><div id="widget"></div></main><script type="module">import {mount} from '${service}/commentnest/widget.js';mount(document.getElementById('widget'),{backendUrl:'${service}',thread:'article',title:'Published article'});</script></html>`});
        assert.equal(url.origin,service);
        if(url.pathname==='/api')api.push({website:request.headers()['x-service-website'],thread:request.headers()['x-service-thread'],action:request.headers()['x-service-action']});
        const response=await fetchService(new Request(url,{headers:request.headers()}),env);
        await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
      });
      const page=await context.newPage();
      await page.goto(host+'/article/');
      const frame=page.frameLocator('iframe');
      await frame.locator('[data-comments-list]').waitFor({state:'attached'});
      await frame.locator('[data-comments-status]').filter({hasText:'还没有评论'}).waitFor();
      const expected=await embeddingWebsite([{origin:primary,prefix:''}],host);
      assert.equal(await frame.locator('[data-commentnest-comments]').getAttribute('data-comments-thread'),expected.prefix+'article');
      assert(api.some(call=>call.website===encodeURIComponent(host)&&decodeURIComponent(call.thread||'')===expected.prefix+'article'));
      const bad=await fetchService(new Request(service+'/api',{headers:{'X-Service-Action':'comments','X-Service-Website':host,'X-Service-Thread':expected.prefix+'draft'}}),env);
      assert.equal(bad.status,404);
      await context.close();
    }
    assert(calls.includes(hosts[0]+'/edgepress/service-contexts.json'));
    assert(calls.includes(hosts[1]+'/edgepress/service-contexts.json'));
    assert(!calls.includes(primary+'/edgepress/service-contexts.json'));
    assert(new Set(scopes).size>=2);
    const first=await embeddingWebsite([{origin:primary,prefix:''}],hosts[0]);
    const wrong=await fetchService(new Request(service+'/api',{headers:{'X-Service-Action':'comments','X-Service-Website':hosts[1],'X-Service-Thread':first.prefix+'article'}}),env);
    assert.equal(wrong.status,404);
  } finally {
    globalThis.fetch=original;await browser?.close();await rm(output,{recursive:true});
  }
});
