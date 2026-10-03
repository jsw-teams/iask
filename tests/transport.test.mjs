import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchService} from '../backend/handler.js';
import {handleCommentRequest} from '../backend/comments.js';
import {transportRequest,requestThread} from '../backend/transport.js';
import {appDefaults,mockInstallation,mockRepositoryInstallation} from './helpers.mjs';
const origin='https://comments.example';

test('fixed API headers retain publication, origin, session and CSRF checks without URL identifiers',async()=>{
  const original=globalThis.fetch,seen=[],state=new Map(),thread='文章/第一篇';
  const env={...appDefaults,COMMENTNEST_SITE_ORIGIN:origin,COMMENTNEST_WEBSITE_ORIGIN:'https://journal.example',COMMENTNEST_REPOSITORY:'owner/comments',COMMENTNEST_GITHUB_APP_CLIENT_ID:'app',COMMENTNEST_GITHUB_APP_CLIENT_SECRET:'secret',COMMENTNEST_SESSION_SECRET:'s'.repeat(64),COMMENTNEST_IDENTITY_SECRET:'i'.repeat(64)};
  env.COMMENTNEST_THREADS={idFromName:name=>name,get:()=>({fetch:request=>handleCommentRequest(request,{...env,REPORELAY_STORAGE:{get:key=>state.get(key),put:(key,value)=>state.set(key,value),delete:key=>state.delete(key)}},{coordinated:true})})};
  globalThis.fetch=async(url,options)=>{
    const href=String(url);seen.push(href);
    if(href==='https://journal.example/edgepress/service-contexts.json')return Response.json([{thread,title:'Published title'}]);
    if(href.endsWith('/installation'))return mockRepositoryInstallation(url,options);
    if(href.includes('/app/installations/'))return mockInstallation();
    if(href.startsWith('https://api.github.com/search/issues'))return Response.json({items:[]});
    throw new Error('Unexpected request');
  };
  const headers={'X-Service-Action':'comments','X-Service-Thread':encodeURIComponent(thread)};
  try {
    const response=await fetchService(new Request(origin+'/api',{headers}),env);
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{comments:[],closed:false});
    const before=seen.length;
    const unknown=await fetchService(new Request(origin+'/api',{headers:{...headers,'X-Service-Thread':'unpublished'}}),env);
    assert.equal(unknown.status,404);assert.ok(seen.slice(before).every(url=>!url.includes('api.github.com')));
    for(const request of [
      new Request(origin+'/api',{method:'POST',headers:{...headers,'Content-Type':'application/json',Origin:origin},body:JSON.stringify({body:'Hello'})}),
      new Request(origin+'/api',{method:'POST',headers:{...headers,'Content-Type':'application/json',Origin:'https://attacker.example'},body:JSON.stringify({body:'Hello'})})
    ]) {const before=seen.length;const result=await fetchService(request,env);assert.ok([401,403].includes(result.status));assert.equal(seen.length,before);}
  }finally{globalThis.fetch=original;}
});

test('invalid actions, queries, resources and header injection fail before backend access',async()=>{
  const env=new Proxy({}, {get(){throw new Error('Unexpected binding access');}});
  for(const [url,headers] of [
    ['/api',{}],['/api?thread=hidden',{'X-Service-Action':'comments','X-Service-Thread':'article'}],
    ['/api',{'X-Service-Action':'../private'}],['/api',{'X-Service-Action':'avatar','X-Service-Resource':'//attacker.example'}],
    ['/api',{'X-Service-Action':'comments','X-Service-Thread':'%0d%0aInjected'}],
    ['/api',{'X-Service-Action':'comments','X-Service-Thread':'%FF'}]
  ]) assert.ok([400,404].includes((await fetchService(new Request(origin+url,{headers}),env)).status));
  const mapped=transportRequest(new Request(origin+'/api',{headers:{'X-Service-Action':'comments','X-Service-Thread':encodeURIComponent('文章/第一篇')}}));
  assert.equal(new URL(mapped.url).search,'');assert.equal(requestThread(mapped),'文章/第一篇');
});
