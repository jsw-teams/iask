import test from 'node:test';
import assert from 'node:assert/strict';
import {worker,appDefaults,mockRepositoryInstallation,mockInstallation} from './helpers.mjs';
import {signValue} from '../src/auth.js';
import {dataScope} from '../src/scope.js';

const env={...appDefaults,REPORELAY_REPOSITORY:'jsw-teams/web',REPORELAY_SITE_ORIGIN:'https://js.gripe',
  REPORELAY_GITHUB_APP_CLIENT_ID:'test-app',REPORELAY_GITHUB_APP_CLIENT_SECRET:'test-secret',
  REPORELAY_SESSION_SECRET:'a'.repeat(48),REPORELAY_IDENTITY_SECRET:'b'.repeat(48)};
const namespace=await dataScope(env);
const cookie='__Host-reporelay_session='+await signValue({id:17,login:'Reader',csrf:'csrf',exp:Date.now()+600000},env,'session');
const del=(thread,extra={})=>worker.fetch(new Request('https://js.gripe/api/comments',{
  method:'DELETE',headers:{origin:'https://js.gripe',cookie,'content-type':'application/json','x-comments-csrf':'csrf',...extra},
  body:JSON.stringify({thread,commentId:'123'})}),env);

for(const mode of ['own','other','wrong-issue','copied-marker','wrong-thread','ordinary-own','closed-own','missing']) {
  test('delete comment ownership: '+mode,async()=>{
    const thread='delete-'+mode+'-'+crypto.randomUUID();
    env.ASSETS={fetch:async()=>Response.json([{thread,title:'Fixture'}])};
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(thread))).slice(0,12),b=>b.toString(16).padStart(2,'0')).join('');
    const marker=await signValue({format:1,id:mode==='other'?18:17,login:'Reader',body:'Text',attachments:[],thread:mode==='wrong-thread'?'different':thread,namespace},env,'comment');
    let writes=0;
    const saved=globalThis.fetch;
    globalThis.fetch=async(url,init={})=>{
      const href=String(url);
      if(href.endsWith('/installation'))return mockRepositoryInstallation(url,init);
      if(href.includes('/app/installations/70001/'))return mockInstallation();
      if(href.includes('/search/issues?'))return Response.json({items:[{number:9,body:'<!-- reporelay-thread:'+namespace+':'+hash+' -->',state:mode==='closed-own'?'closed':'open'}]});
      if(href.endsWith('/issues/comments/123')){
        if(init.method==='DELETE'){writes++;return new Response(null,{status:204});}
        if(mode==='missing')return new Response(null,{status:404});
        return Response.json({id:123,issue_url:'https://api.github.com/repos/jsw-teams/web/issues/'+(mode==='wrong-issue'?10:9),
          user:{id:mode==='ordinary-own'?17:80,login:mode==='ordinary-own'?'Reader':mode==='copied-marker'?'Impersonator':'comment-bot[bot]'},
          body:mode==='ordinary-own'?'Text':'<!-- reporelay-comment:'+marker+' -->\n\nText',created_at:'2026-10-03T00:00:00Z'});
      }
      throw new Error('Unexpected request '+href);
    };
    try{
      const response=await del(thread);
      const allowed=['own','ordinary-own','closed-own'].includes(mode);
      assert.equal(response.status,allowed?200:['wrong-issue','missing'].includes(mode)?404:403);
      assert.equal(writes,allowed?1:0);
    }finally{globalThis.fetch=saved;}
  });
}

test('delete rejects missing login, invalid CSRF, cross-origin and unknown pages before GitHub',async()=>{
  env.ASSETS={fetch:async()=>Response.json([])};
  const saved=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Must not reach GitHub');};
  try{
    assert.equal((await del('unknown',{cookie:''})).status,401);
    assert.equal((await del('unknown',{'x-comments-csrf':'wrong'})).status,403);
    assert.equal((await del('unknown',{origin:'https://other.example'})).status,403);
    assert.equal((await del('unknown')).status,404);
  }finally{globalThis.fetch=saved;}
});

test('avatars proxy fixed upstream only, bounds content, and forwards no visitor credentials',async()=>{
  const saved=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async(url,init)=>{
    calls++;
    assert.equal(String(url),'https://avatars.githubusercontent.com/u/17?s=96&v=4');
    assert.deepEqual(init,{redirect:'manual'});
    return new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png'}});
  };
  try{
    const response=await worker.fetch(new Request('https://js.gripe/api/comments/avatar/17',{headers:{cookie:'secret'}}),{});
    assert.equal(response.status,200);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.equal((await worker.fetch(new Request('https://js.gripe/api/comments/avatar/https://evil.example'),{})).status,400);
    assert.equal(calls,1);
    globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://evil.example'}});
    assert.equal((await worker.fetch(new Request('https://js.gripe/api/comments/avatar/17'),{})).status,502);
    globalThis.fetch=async()=>new Response(new Uint8Array(256001),{headers:{'Content-Type':'image/png'}});
    assert.equal((await worker.fetch(new Request('https://js.gripe/api/comments/avatar/17'),{})).status,502);
    globalThis.fetch=async()=>new Response('<svg/>',{headers:{'Content-Type':'image/svg+xml'}});
    assert.equal((await worker.fetch(new Request('https://js.gripe/api/comments/avatar/17'),{})).status,502);
  }finally{globalThis.fetch=saved;}
});
