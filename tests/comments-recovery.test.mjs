import test from 'node:test';
import assert from 'node:assert/strict';
import { worker, appDefaults, mockInstallation } from './helpers.mjs';
import { signValue } from '../src/auth.js';
const origin='https://js.gripe';
async function scenario(run, override) {
  const thread='recovery-'+crypto.randomUUID();
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(thread))).subarray(0,12).toString('hex');
  const env={...appDefaults,REPORELAY_REPOSITORY:'jsw-teams/web',REPORELAY_GITHUB_APP_BOT_LOGIN:'Writer[bot]',
    REPORELAY_SITE_ORIGIN:origin,REPORELAY_GITHUB_APP_CLIENT_ID:'app',REPORELAY_GITHUB_APP_CLIENT_SECRET:'client-secret',
    REPORELAY_SESSION_SECRET:'session'.repeat(8),REPORELAY_IDENTITY_SECRET:'identity'.repeat(8),
    ASSETS:{fetch:async()=>Response.json([{thread,title:'Published title'}])}};
  const cookie='__Host-reporelay_session_v2='+await signValue({id:17,login:'Reader',csrf:'csrf',exp:Date.now()+600000},env,'session');
  const calls=[];
  const saved=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{
    assert.equal(init.redirect,'manual','Workers support manual redirects; credentials must never follow a redirect');
    if (String(url).includes('/app/installations/')) return mockInstallation();
    const path=new URL(url).pathname+new URL(url).search, method=init.method||'GET';
    calls.push({path,method});
    const special=await override?.(path,method,init);
    if(special)return special;
    if(path.startsWith('/search/issues?'))return Response.json({items:[{number:7,body:'<!-- reporelay-thread:v2:test-v2:'+hash+' -->',title:'💬 Fixture',state:'open'}]});
    if(path.includes('/labels/'))return Response.json({name:decodeURIComponent(path.split('/').at(-1))});
    if(path==='/repos/jsw-teams/web')return Response.json({has_issues:true,default_branch:'main'});
    if(path.startsWith('/repos/jsw-teams/web/issues?'))return Response.json([]);
    if(path==='/repos/jsw-teams/web/issues'&&method==='POST')return Response.json({number:44,state:'open'}, {status:201});
    if(/\/issues\/\d+$/.test(path)) {
      const number=Number(path.split('/').at(-1));
      if(method==='PATCH')return Response.json({number,state:'open',locked:false,title:'💬 Published title',body:'<!-- reporelay-thread:v2:test-v2:'+hash+' -->',labels:[{name:'comments'},{name:'reporelay'}]});
      return Response.json({number,state:'open',locked:false,title:'💬 Published title',body:'<!-- reporelay-thread:v2:test-v2:'+hash+' -->',labels:[{name:'comments'},{name:'reporelay'}]});
    }
    if(path.includes('/comments?'))return Response.json([]);
    if(path.endsWith('/comments')&&method==='POST')return Response.json({id:99,user:{login:'Writer[bot]'},created_at:'2026-10-02T12:00:00Z',body:JSON.parse(init.body).body},{status:201});
    throw new Error('Unexpected API request: '+method+' '+path);
  };
  const get=()=>worker.fetch(new Request(origin+'/api/comments?thread='+thread),env);
  const post=()=>worker.fetch(new Request(origin+'/api/comments',{method:'POST',headers:{origin,cookie,'content-type':'application/json','x-comments-csrf':'csrf'},body:JSON.stringify({thread,body:'Draft survives'})}),env);
  try {await run({get,post,calls});}finally{globalThis.fetch=saved;}
}

for(const [status,headers,code] of [[401,{},'comments_credentials_unavailable'],[403,{},'comments_permission_denied'],
  [403,{'x-ratelimit-remaining':'0','retry-after':'90'},'comments_rate_limited'],[429,{'retry-after':'90'},'comments_rate_limited']])
test('repository authentication/rate failure '+status+' '+code+' does not create issues',async()=>{
  await scenario(async({get,post,calls})=>{
    for(const response of [await get(),await post()]){
      assert.equal(response.status,503);
      assert.equal((await response.json()).error,code);
      if(code==='comments_rate_limited')assert.equal(response.headers.get('retry-after'),'90');
    }
    assert.ok(calls.every(c=>c.method==='GET'));
  },()=>new Response(null,{status,headers}));
});

for(const status of [404,410]) test('deleted cached Issue '+status+' reads empty, then recreates on the next authenticated submission',async()=>{
  let deleted=false;
  await scenario(async({get,post,calls})=>{
    assert.deepEqual(await (await get()).json(),{comments:[],closed:false});
    deleted=true;
    const reset=await get(); assert.equal(reset.status,200);
    assert.deepEqual(await reset.json(),{comments:[],closed:false,threadReset:true});
    assert.ok(calls.every(c=>c.method==='GET'));
    const result=await post(); assert.equal(result.status,201);
    assert.equal((await result.json()).comment.author,'Reader');
    assert.equal(calls.filter(c=>c.method==='POST'&&c.path==='/repos/jsw-teams/web/issues').length,1);
  },path=>deleted&&path.includes('/issues/7/')?new Response(null,{status}):null);
});

test('deletion between moderation check and write retries one replacement only',async()=>{
  await scenario(async({post,calls})=>{
    assert.equal((await post()).status,201);
    assert.equal(calls.filter(c=>c.method==='POST'&&c.path.endsWith('/comments')).length,2);
    assert.equal(calls.filter(c=>c.method==='POST'&&c.path==='/repos/jsw-teams/web/issues').length,1);
  },(path,method)=>path==='/repos/jsw-teams/web/issues/7/comments'&&method==='POST'?new Response(null,{status:404}):null);
});

test('persistent deletion stops after one replacement instead of looping',async()=>{
  await scenario(async({post,calls})=>{
    assert.equal((await post()).status,503);
    assert.equal(calls.filter(c=>c.method==='POST'&&c.path==='/repos/jsw-teams/web/issues').length,1);
  },path=>path==='/repos/jsw-teams/web/issues/7'||path==='/repos/jsw-teams/web/issues/44/comments'?new Response(null,{status:404}):null);
});

test('a permissions-masked 404 is not interpreted as thread deletion',async()=>{
  await scenario(async({get,calls})=>{
    const result=await get();assert.equal(result.status,503);
    assert.equal((await result.json()).error,'comments_permission_denied');
    assert.ok(calls.every(c=>c.method==='GET'));
  },path=>path==='/repos/jsw-teams/web'?new Response(null,{status:403}):path.includes('/issues/7/comments')?new Response(null,{status:404}):null);
});

test('ambiguous failed writes are not retried and closed threads stay closed',async()=>{
  await scenario(async({post,calls})=>{
    assert.equal((await post()).status,502);
    assert.equal(calls.filter(c=>c.method==='POST').length,1);
  },(path,method)=>path.endsWith('/comments')&&method==='POST'?new Response(null,{status:500}):null);
  await scenario(async({post,calls})=>{
    assert.equal((await post()).status,409);
    assert.ok(calls.every(c=>c.method==='GET'));
  },path=>path==='/repos/jsw-teams/web/issues/7'?Response.json({number:7,state:'closed'}):null);
});

test('unexpected GitHub redirects fail without forwarding credentials or creating issues',async()=>{
  await scenario(async({get,post,calls})=>{
    assert.equal((await get()).status,502);
    assert.equal((await post()).status,502);
    assert.equal(calls.length,2);
    assert.ok(calls.every(call=>call.path.startsWith('/search/issues?')&&call.method==='GET'));
  },()=>new Response(null,{status:302,headers:{location:'https://untrusted.invalid'}}));
});
