import test from 'node:test';
import assert from 'node:assert/strict';
import {configuredWebsites} from '../backend/websites.js';
import {handleServiceRequest} from '../backend/service.js';
import {fetchService} from '../backend/handler.js';
import {handleCommentRequest} from '../backend/comments.js';
import {appDefaults,mockInstallation,mockRepositoryInstallation} from './helpers.mjs';
const service='https://comments.example',primary='https://journal.example',secondary='https://second.example';
const env={...appDefaults,COMMENTNEST_SITE_ORIGIN:service,COMMENTNEST_WEBSITE_ORIGIN:primary,
  COMMENTNEST_ADDITIONAL_WEBSITES:JSON.stringify([{origin:secondary,prefix:'second:'}]),
  COMMENTNEST_REPOSITORY:'owner/comments',COMMENTNEST_GITHUB_APP_CLIENT_ID:'app',
  COMMENTNEST_GITHUB_APP_CLIENT_SECRET:'secret',COMMENTNEST_SESSION_SECRET:'s'.repeat(64),
  COMMENTNEST_IDENTITY_SECRET:'i'.repeat(64)};
test('additional website origins and prefixes are exact, unique and bounded',()=>{
  assert.deepEqual(configuredWebsites(env),[{origin:primary,prefix:''},{origin:secondary,prefix:'second:'}]);
  for(const sites of [[{origin:primary,prefix:'second:'}],[{origin:secondary,prefix:'page:'}],
    [{origin:secondary+'/path',prefix:'second:'}],[{origin:'http://second.example',prefix:'second:'}],
    [{origin:secondary,prefix:'second:'},{origin:'https://third.example',prefix:'second:'}]])
    assert.throws(()=>configuredWebsites({...env,COMMENTNEST_ADDITIONAL_WEBSITES:JSON.stringify(sites)}));
});
test('frame CSP and module CORS permit only configured websites, with no origin reflection',async()=>{
  const assets={fetch:async()=>new Response('export const ok=true')};
  const response=await handleServiceRequest(new Request(service+'/frame'),{...env,COMMENTNEST_ASSETS:assets});
  assert.equal(response.status,200);assert.ok(response.headers.get('content-security-policy').includes('frame-ancestors '+primary+' '+secondary));
  for(const origin of [primary,secondary,'https://attacker.example']){
    const result=await handleServiceRequest(new Request(service+'/commentnest/widget.js',{headers:{Origin:origin}}),{...env,COMMENTNEST_ASSETS:assets});
    assert.equal(result.headers.get('access-control-allow-origin'),origin==='https://attacker.example'?primary:origin);
    assert.equal(result.headers.get('vary'),'Origin');
  }
  const query=new URLSearchParams({parent:secondary,thread:'page:guide',title:'Guide',channel:'a'.repeat(32)});
  assert.match(await (await handleServiceRequest(new Request(service+'/commentnest/embed?'+query),env)).text(),/second:page:guide/);
});
test('same page IDs use separate website manifests and preserve the primary thread namespace',async()=>{
  const original=globalThis.fetch,seen=[];
  const context={...env,COMMENTNEST_THREADS:{idFromName:name=>name,get:()=>({fetch:request=>handleCommentRequest(request,env,{coordinated:true})})}};
  globalThis.fetch=async(url,options)=>{
    const address=String(url);seen.push(address);
    if([primary,secondary].some(origin=>address===origin+'/edgepress/service-contexts.json'))return Response.json([{thread:'page:guide',title:'Guide'}]);
    if(address.endsWith('/installation'))return mockRepositoryInstallation(url,options);
    if(address.includes('/app/installations/'))return mockInstallation();
    if(address.startsWith('https://api.github.com/search/issues'))return Response.json({items:[]});
    throw new Error('Unexpected upstream');
  };
  try{
    for(const [thread,origin] of [['page:guide',primary],['second:page:guide',secondary]]){
      seen.length=0;
      const response=await fetchService(new Request(service+'/api',{headers:{'X-Service-Action':'comments','X-Service-Thread':thread}}),context);
      assert.equal(response.status,200);assert.ok(seen.includes(origin+'/edgepress/service-contexts.json'));
      assert.ok(!seen.includes((origin===primary?secondary:primary)+'/edgepress/service-contexts.json'));
    }
  }finally{globalThis.fetch=original;}
});
