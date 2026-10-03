import { dataScope } from '../backend/scope.js';
const scope = await dataScope({REPORELAY_SITE_ORIGIN:'https://js.gripe',REPORELAY_REPOSITORY:'jsw-teams/web'});
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCommentRequest, CommentCoordinator, createRepositoryClient } from '../backend/index.js';
import { signValue, verifyValue, commentSession } from '../backend/auth.js';
import { appDefaults, mockInstallation, mockRepositoryInstallation } from './helpers.mjs';

const origin = 'https://js.gripe';
const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
async function fixture(run, override = () => null) {
  const thread = 'article-' + crypto.randomUUID();
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(thread))).subarray(0,12).toString('hex');
  const env = {...appDefaults, REPORELAY_REPOSITORY:'jsw-teams/web', REPORELAY_SITE_ORIGIN:origin,
    REPORELAY_GITHUB_APP_CLIENT_ID:'app', REPORELAY_GITHUB_APP_CLIENT_SECRET:'secret',
    REPORELAY_SESSION_SECRET:'s'.repeat(48), REPORELAY_IDENTITY_SECRET:'i'.repeat(48),
    ASSETS:{fetch:async()=>Response.json([{thread,title:'Article'}])}};
  const values = new Map();
  const storage = {get:async key=>values.get(key),put:async(key,value)=>values.set(key,value),delete:async key=>values.delete(key)};
  let object = new CommentCoordinator({storage},env);
  env.REPORELAY_THREADS = {idFromName:name=>name,get:()=>({fetch:request=>object.fetch(request)})};
  const cookie = '__Host-reporelay_session=' + await signValue({id:17,login:'Reader',csrf:'csrf',exp:Date.now()+600000},env,'session');
  const issue = {number:42,state:'open',locked:false,title:'💬 Article',body:'<!-- reporelay-thread:' + scope + ':'+hash+' -->',labels:['comments','reporelay']};
  const calls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async(url,init={}) => {
    const path = new URL(url).pathname + new URL(url).search;
    calls.push({path,method:init.method||'GET',init});
    assert.equal(init.redirect,'manual');
    const special = await override(path,init,{env,issue,thread,hash});
    if(special) return special;
    if(path.endsWith('/installation'))return mockRepositoryInstallation(url,init);
    if(path.includes('/app/installations/'))return mockInstallation();
    if(path.startsWith('/search/issues?')) return Response.json({items:[]});
    if(path.includes('/labels/'))return Response.json({});
    if(path.endsWith('/issues')&&init.method==='POST') {await new Promise(resolve=>setTimeout(resolve,5));return Response.json(issue,{status:201});}
    if(path.endsWith('/issues/42'))return Response.json(issue);
    if(path.includes('/issues/42/comments?'))return Response.json([]);
    if(path.endsWith('/issues/42/comments'))return Response.json({id:crypto.randomUUID(),user:{login:'comment-bot[bot]'},body:JSON.parse(init.body).body},{status:201});
    if(path.includes('/git/ref/heads/'))return Response.json({object:{sha:'base'}});
    if(path.includes('/contents/')&&init.method==='PUT')return Response.json({content:{sha:'image'}},{status:201});
    if(path.includes('/contents/'))return new Response(png,{headers:{'Content-Type':'text/html','Set-Cookie':'unsafe=1'}});
    throw new Error('Unexpected '+path);
  };
  const post = (payload={body:'Hello',attachments:[]},headers={}) => handleCommentRequest(new Request(origin+'/api/comments',{
    method:'POST',headers:{origin,cookie,'content-type':'application/json','x-comments-csrf':'csrf',...headers},
    body:JSON.stringify({thread,...payload})}),env);
  const get = () => handleCommentRequest(new Request(origin+'/api/comments?thread='+thread),env);
  const upload = (bytes=png,headers={}) => handleCommentRequest(new Request(origin+'/api/comments/media/',{method:'POST',
    headers:{origin,cookie,'content-type':'image/png','x-comments-csrf':'csrf','x-comments-thread':thread,...headers},body:bytes}),env);
  try {await run({env,thread,hash,cookie,calls,post,get,upload,issue,values,restart:()=>{object=new CommentCoordinator({storage},env);}});}
  finally {globalThis.fetch=saved;}
}

test('old configuration and sessions are rejected; signatures bind the project configuration', async()=>{
  await fixture(async({env,cookie})=>{
    const legacy = {...env, REPORELAY_GITHUB_APP_PRIVATE_KEY:undefined,COMMENTS_GITHUB_TOKEN:'old-pat'};
    assert.equal((await handleCommentRequest(new Request(origin+'/api/comments?thread=article'),legacy)).status,503);
    assert.equal(await commentSession(new Request(origin,{headers:{cookie:cookie.replace('__Host-reporelay_session','__Host-edgepress_session')}}),env),null);
    assert.equal(await commentSession(new Request(origin,{headers:{cookie:cookie.replace('__Host-reporelay_session','__Host-reporelay_session_v2')}}),env),null);
    const signed=await signValue({value:1},env,'comment');
    assert.equal(await verifyValue(signed,{...env,REPORELAY_SITE_ORIGIN:'https://test.example'},'comment'),null);
  });
});

test('legacy and another project Issues never appear or get reused',async()=>{
  await fixture(async({get,post,calls})=>{
    assert.deepEqual(await(await get()).json(),{comments:[],closed:false});
    assert.equal((await post()).status,201);
    assert.equal(calls.filter(c=>c.path.endsWith('/issues')&&c.method==='POST').length,1);
  },(path,init,{hash})=>path.startsWith('/search/issues?')?Response.json({items:[
    {number:7,title:'[edgepress-comments:'+hash+'] Test'},
    {number:8,body:'<!-- reporelay-thread:v1:'+hash+' -->'},
    {number:9,body:'<!-- reporelay-thread:v2:old-tests:'+hash+' -->'}]}):null);
});

test('twenty simultaneous first comments create one Issue; mapping survives object restart',async()=>{
  await fixture(async({post,restart,calls,values})=>{
    const responses=await Promise.all(Array.from({length:20},()=>post()));
    assert.ok(responses.every(response=>response.status===201));
    assert.equal(calls.filter(c=>c.path.endsWith('/issues')&&c.method==='POST').length,1);
    assert.equal(values.get('issue').number,42);
    restart();
    assert.equal((await post()).status,201);
    assert.equal(calls.filter(c=>c.path.startsWith('/search/issues?')).length,1);
  });
});

test('an ambiguous Issue creation stays pending instead of risking a duplicate',async()=>{
  await fixture(async({post,values,calls})=>{
    assert.equal((await post()).status,502);
    assert.equal(values.get('creating'),true);
    const retry=await post();
    assert.equal(retry.status,503);
    assert.equal((await retry.json()).error,'comments_creation_pending');
    assert.equal(calls.filter(c=>c.path.endsWith('/issues')&&c.method==='POST').length,1);
  },(path,init)=>path.endsWith('/issues')&&init.method==='POST'?new Response(null,{status:500}):null);
});

test('anonymous or unpublished reads never call GitHub for unknown articles',async()=>{
  await fixture(async({env,get,calls})=>{
    env.ASSETS.fetch=async()=>Response.json([]);
    assert.equal((await get()).status,404);
    assert.equal(calls.length,0);
  });
});

test('media upload and image-only comments use a signed receipt',async()=>{
  await fixture(async({upload,post,calls})=>{
    const response=await upload(); assert.equal(response.status,201);
    const media=await response.json(); assert.match(media.url,new RegExp('/' + scope + '/'));
    assert.equal((await post({body:'',attachments:[media]})).status,201);
    const write=calls.find(c=>c.method==='PUT');
    assert.equal(JSON.parse(write.init.body).branch,'reporelay-media-' + scope);
  });
});

test('media rejects forged bytes, oversized files, wrong CSRF and another user receipt',async()=>{
  await fixture(async({upload,post,env,thread,hash,calls})=>{
    assert.equal((await upload(new Uint8Array(12))).status,400);
    assert.equal((await upload(png,{'content-length':'5000001'})).status,413);
    assert.equal((await upload(png,{'x-comments-csrf':'wrong'})).status,403);
    assert.equal(calls.length,0);
    const url=origin+'/api/comments/media/' + scope + '/'+hash+'/'+crypto.randomUUID()+'.png';
    const receipt=await signValue({url,thread,id:99,exp:Date.now()+60000},env,'media');
    assert.equal((await post({body:'Hello',attachments:[{url,receipt}]})).status,400);
    assert.equal((await post({body:'Hello',attachments:[url]})).status,400);
  });
});

test('closing a thread also prevents media uploads',async()=>{
  await fixture(async({post,upload,issue,calls})=>{
    assert.equal((await post()).status,201);
    issue.locked=true;
    assert.equal((await upload()).status,409);
    assert.ok(!calls.some(c=>c.method==='PUT'));
  });
});

test('media reuses cached bytes only after fresh validation, and deletion blocks cached attachments',async()=>{
  let records=[],issueDeleted=false;
  const savedCache=globalThis.caches,cache=new Map();
  globalThis.caches={default:{match:async request=>cache.get(request.url)?.clone(),put:async(request,response)=>{assert.equal(response.headers.get('cache-control'),'public, max-age=300');cache.set(request.url,response.clone());}}};
  try{await fixture(async({env,upload,post,hash,calls})=>{
    const attachment=await(await upload()).json();
    const get=()=>handleCommentRequest(new Request(attachment.url),env);
    assert.equal((await get()).status,404,'Unpublished upload is not publicly served');
    assert.equal((await post({body:'Image',attachments:[{url:attachment.url,receipt:attachment.receipt}]})).status,201);
    const response=await get();
    assert.equal(response.status,200);
    assert.equal(response.headers.get('content-type'),'image/png');
    assert.equal(response.headers.get('set-cookie'),null);
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.equal(response.headers.get('cache-control'),'no-store');
    const downloads=()=>calls.filter(call=>call.path.includes('/contents/')&&call.method==='GET').length;
    assert.equal(downloads(),1);assert.equal((await get()).status,200);assert.equal(downloads(),1,'A validated second view reuses file bytes');
    assert.equal((await handleCommentRequest(new Request(origin+'/api/comments/media/old-tests/'+hash+'/old.png'),env)).status,404);
    const saved=records;records=[];assert.equal((await get()).status,404,'Deleting its last comment removes public access');
    records=saved;issueDeleted=true;assert.equal((await get()).status,404,'Deleting the Issue removes public access');
  },(path,init)=>{
    if(path.endsWith('/issues/42') && issueDeleted)return new Response(null,{status:404});
    if(path.endsWith('/issues/42/comments') && init.method==='POST') {
      const record={id:123,user:{login:'comment-bot[bot]'},body:JSON.parse(init.body).body};records.push(record);return Response.json(record,{status:201});
    }
    if(path.includes('/issues/42/comments?'))return Response.json(records);
    return null;
  });}finally{globalThis.caches=savedCache;}
});

test('public read cache reduces upstream calls, rechecks publication and expires before fresh moderation',async()=>{
  await fixture(async({post,get,values,calls,issue,env})=>{
    assert.equal((await post()).status,201);
    assert.equal((await get()).status,200);
    const previous=calls.length;
    issue.locked=true;
    const cached=await get();
    assert.equal(cached.headers.get('cache-control'),'no-store');
    assert.equal((await cached.json()).closed,false);
    assert.equal(calls.length,previous);
    assert.equal((await post()).status,409,'Cached open state must not authorize a new comment');
    assert.equal(values.has('public-read'),false);
    assert.equal((await(await get()).json()).closed,true);
    values.get('public-read').expires=Date.now()-1;
    issue.locked=false;
    assert.equal((await(await get()).json()).closed,false);
    env.ASSETS.fetch=async()=>Response.json([]);
    assert.equal((await get()).status,404,'A cached list must not expose an unpublished article');
  });
});

test('Vercel upload capability rejects bodies over 4 MB before contacting storage',async()=>{
  await fixture(async({env,upload,calls})=>{
    env.REPORELAY_MAX_ATTACHMENT_BYTES=4_000_000;
    assert.equal((await upload(png,{'content-length':'4000001'})).status,413);
    assert.equal(calls.length,0);
  });
});

test('an absent coordinator fails explicitly and methods are restricted',async()=>{
  await fixture(async({env,get})=>{
    env.REPORELAY_THREADS=undefined;
    assert.equal((await get()).status,503);
    assert.equal((await handleCommentRequest(new Request(origin+'/api/comments',{method:'PATCH'}),env)).status,405);
    assert.equal(await handleCommentRequest(new Request(origin+'/other'),env),null);
  });
});

test('server-side file reads stay in the configured repository and reject traversal',async()=>{
  await fixture(async({env})=>{
    const client=createRepositoryClient(env);
    assert.deepEqual(await client.readFile('published/notes.md'),{type:'file',content:'SGVsbG8=',encoding:'base64'});
    for(const path of ['../secrets','/private','a/../secrets','a\\secrets','a//b'])await assert.rejects(client.readFile(path));
  },(path,init)=>path.includes('/contents/published/notes.md')?Response.json({type:'file',content:'SGVsbG8=',encoding:'base64'}):null);
});

test('another operator uses their own callback, cookie and project return address',async()=>{
  await fixture(async({env})=>{
    const ownOrigin='https://independent-operator.example';
    const ownEnv={...env,REPORELAY_SITE_ORIGIN:ownOrigin};
    const response=await handleCommentRequest(new Request(ownOrigin+'/api/comments/login?return=%2Fproject%2Farticle%2F%23comments'),ownEnv);
    assert.equal(response.status,303);
    const target=new URL(response.headers.get('location'));
    assert.equal(target.searchParams.get('redirect_uri'),ownOrigin+'/api/comments/callback');
    const pendingCookie=response.headers.getSetCookie()[0].split(';')[0].split('=')[1];
    const state=await verifyValue(pendingCookie,ownEnv,'oauth');
    assert.equal(state.returnTo,'/project/article/#comments');
    assert.equal(await verifyValue(pendingCookie,env,'oauth'),null);
    assert.ok(!response.headers.get('location').includes('js.gripe'));
  });
});

test('project scope is stable across releases and App key rotation, but separates origins and repositories',async()=>{
  const env={REPORELAY_SITE_ORIGIN:origin,REPORELAY_REPOSITORY:'jsw-teams/web'};
  const expected=await dataScope(env);
  assert.equal(await dataScope({...env,REPORELAY_SITE_ORIGIN:origin+'/',REPORELAY_REPOSITORY:'JSW-TEAMS/WEB'}),expected);
  assert.equal(await dataScope({...env,RELEASE:'202611.1',REPORELAY_GITHUB_APP_PRIVATE_KEY:'rotated'}),expected);
  assert.notEqual(await dataScope({...env,REPORELAY_SITE_ORIGIN:'https://test.example'}),expected);
  assert.notEqual(await dataScope({...env,REPORELAY_REPOSITORY:'jsw-teams/test'}),expected);
});

test('stored baseline comments remain readable; an unsupported format stays isolated without deleting it',async()=>{
  const records=[];
  await fixture(async({env,post,get,thread})=>{
    assert.equal((await post({body:'Keep this discussion',attachments:[]})).status,201);
    const signature=records[0].body.match(/^<!-- reporelay-comment:([^ ]+) -->/)[1];
    const metadata=await verifyValue(signature,env,'comment');
    assert.equal(metadata.format,1);
    const unsupported=await signValue({...metadata,format:99,body:'Needs a migration'},env,'comment');
    records.push({id:2,user:{login:'comment-bot[bot]'},body:'<!-- reporelay-comment:'+unsupported+' -->\n\n'});
    const result=await(await get()).json();
    assert.equal(result.comments.length,1);
    assert.equal(result.comments[0].body,'Keep this discussion');
    assert.equal(records.length,2,'An unsupported record is retained upstream');
  },(path,init,{env})=>{
    if(path.endsWith('/issues/42/comments')&&init.method==='POST'){
      const record={id:1,user:{login:'comment-bot[bot]'},body:JSON.parse(init.body).body};
      records.push(record);return Response.json(record,{status:201});
    }
    if(path.includes('/issues/42/comments?'))return Response.json(records);
    return null;
  });
});
