import test from 'node:test';
import assert from 'node:assert/strict';
import { worker, appDefaults, mockInstallation } from './helpers.mjs';
import { signValue, verifyValue } from '../src/auth.js';

const origin = 'https://js.gripe';
const env = { ...appDefaults, REPORELAY_REPOSITORY: 'jsw-teams/web',
  REPORELAY_SITE_ORIGIN: origin, REPORELAY_GITHUB_APP_CLIENT_ID: 'test-app', REPORELAY_GITHUB_APP_CLIENT_SECRET: 'test-client-secret',
  REPORELAY_SESSION_SECRET: 'secret'.repeat(8), REPORELAY_IDENTITY_SECRET: 'identity'.repeat(8),
  ASSETS: {fetch: async () => Response.json([{thread: 'published-test', title: 'Real title'}])} };
const get = (path, cookie = '') => worker.fetch(new Request(origin + path, {headers: {cookie}}), env);
const session = async (extra = {}) => '__Host-reporelay_session_v2=' + await signValue({id: 17, login: 'RealReader', csrf: 'csrf', exp: Date.now()+600000, ...extra}, env, 'session');
const post = async (payload, cookie = '', csrf = 'csrf') => worker.fetch(new Request(origin + '/api/comments', {
  method: 'POST', headers: {origin, cookie, 'content-type':'application/json', 'x-comments-csrf':csrf}, body:JSON.stringify(payload)}),env);
const payload = { thread: 'published-test', title: 'Fake title', name: 'ImpersonatedMaintainer', body:'Hello', company:'' };
async function withFetch(handler, run) {
  const saved = globalThis.fetch;
  globalThis.fetch = (url, init) => String(url).includes('/app/installations/70001/') ? mockInstallation() : handler(url, init);
  try { await run(); } finally { globalThis.fetch = saved; }
}

test('session rejects forged, expired and wrong-purpose cookies; no credentials enter JSON', async () => {
  assert.equal((await (await get('/api/comments/session')).json()).user, null);
  const valid = await session();
  assert.equal((await (await get('/api/comments/session',valid)).json()).user.login,'RealReader');
  for (const cookie of [valid + 'x', await session({exp:Date.now()-1}), '__Host-reporelay_session_v2=' + await signValue({id:17,login:'Forged',exp:Date.now()+60000},env,'comment')])
    assert.equal((await (await get('/api/comments/session',cookie)).json()).user,null);
  const data = await (await get('/api/comments/session',valid)).text();
  assert.ok(!data.includes('test-client-secret') && !data.includes('test-bot'));
});

test('anonymous, forged sessions, missing CSRF and invalid JSON values never reach GitHub', async () => {
  await withFetch(() => {throw new Error('Must not call GitHub');}, async () => {
    assert.equal((await post(payload)).status,401);
    assert.equal((await post(payload,(await session())+'x')).status,401);
    assert.equal((await post(payload,await session(),'wrong')).status,403);
    assert.equal((await post(null,await session())).status,400);
    assert.equal((await post([],await session())).status,400);
    assert.equal((await post({...payload,thread:'unpublished'},await session())).status,404);
  });
});

test('GitHub App user authorization uses state and PKCE, restricts redirects, and resolves identity from GitHub /user', async () => {
  const login = await get('/api/comments/login?return=' + encodeURIComponent('/opus-video/#comments'));
  assert.equal(login.status,303);
  const target = new URL(login.headers.get('location'));
  assert.equal(target.origin,'https://github.com');
  assert.equal(target.searchParams.get('code_challenge_method'),'S256');
  const stateCookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Lax/);
  assert.equal((await get('/api/comments/callback?code=x&state=bad',stateCookie)).status,403);
  const malicious = await get('/api/comments/login?return=' + encodeURIComponent('//evil.example/path'));
  const pending = await verifyValue(malicious.headers.get('set-cookie').split(';')[0].split('=')[1],env,'oauth');
  assert.equal(pending.returnTo,'/');
  let calls=0;
  await withFetch(async (url,init) => {
    calls++;
    assert.equal(init.redirect,'manual');
    if (String(url).includes('/access_token')) {
      const body=JSON.parse(init.body);
      assert.equal(body.redirect_uri,origin+'/api/comments/callback');
      const p = await verifyValue(stateCookie.split('=')[1],env,'oauth');
      assert.equal(body.code_verifier,p.verifier);
      const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.code_verifier))).toString('base64url');
      assert.equal(hash,target.searchParams.get('code_challenge'));
      return Response.json({access_token:'visitor-token'});
    }
    assert.equal(String(url),'https://api.github.com/user');
    assert.equal(init.headers.Authorization,'Bearer visitor-token');
    return Response.json({id:17,login:'RealReader'});
  },async () => {
    const callback=await get('/api/comments/callback?code=code&state='+target.searchParams.get('state'),stateCookie);
    assert.equal(callback.status,303);
    assert.equal(callback.headers.get('location'),'/opus-video/#comments');
    const cookies=callback.headers.getSetCookie();
    assert.equal(cookies.length,2);
    assert.ok(cookies.every(c=>!c.includes('visitor-token')));
    const cookie=cookies.find(c=>c.startsWith('__Host-reporelay_session_v2=')).split(';')[0];
    assert.equal((await (await get('/api/comments/session',cookie)).json()).user.login,'RealReader');
    assert.equal(calls,2);
  });
});

test('fresh issue state prevents commenting after moderation closes a cached thread', async () => {
  const thread='closed-'+crypto.randomUUID();
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(thread))).subarray(0,12).toString('hex');
  const closedEnv={...env,ASSETS:{fetch:async()=>Response.json([{thread,title:'Closed'}])}};
  await withFetch(async url=> {
    if(String(url).includes('/search/issues?'))return Response.json({items:[{number:8,body:'<!-- reporelay-thread:v2:test-v2:'+hash+' -->',title:'💬 Fixture',state:'open'}]});
    assert.match(String(url),/\/issues\/8$/);
    return Response.json({number:8,state:'closed'});
  },async()=> {
    const response=await worker.fetch(new Request(origin+'/api/comments',{method:'POST',headers:{origin,cookie:await session(),'content-type':'application/json','x-comments-csrf':'csrf'},body:JSON.stringify({...payload,thread})}),closedEnv);
    assert.equal(response.status,409);
  });
});

test('unconfigured login fails explicitly without starting OAuth', async () => {
  assert.equal((await worker.fetch(new Request(origin+'/api/comments/login'),{})).status,503);
});

test('maximum Chinese comments preserve signed identity and forged metadata cannot impersonate it', async () => {
  const value = {id:17,login:'RealReader',body:'中文评'.repeat(1666)};
  const signed=await signValue(value,env,'comment');
  assert.ok(signed.length>16000);
  assert.deepEqual(await verifyValue(signed,env,'comment'),value);
  assert.deepEqual(await verifyValue(signed,{...env,REPORELAY_SESSION_SECRET:'rotated'.repeat(8)},'comment'),value);
  assert.equal(await verifyValue(signed+'x',env,'comment'),null);
});

test('copied identity metadata cannot impersonate another user or cross article threads', async () => {
  const thread='replay-'+crypto.randomUUID();
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(thread))).subarray(0,12).toString('hex');
  const metadata=await signValue({id:17,login:'RealReader',body:'Original comment',namespace:'test-v2',thread},env,'comment');
  const otherThread=await signValue({id:17,login:'RealReader',body:'Original comment',namespace:'test-v2',thread:'another-thread'},env,'comment');
  await withFetch(async url=>String(url).includes('/search/issues?') ? Response.json({items:[{number:11,body:'<!-- reporelay-thread:v2:test-v2:'+hash+' -->',title:'💬 Fixture',state:'open'}]}) : Response.json([
    {id:1,user:{login:'OtherReader'},body:'<!-- reporelay-comment:v2:'+metadata+' -->\n\n'},
    {id:2,user:{login:'Writer[bot]'},body:'<!-- reporelay-comment:v2:'+otherThread+' -->\n\n'}]),async()=> {
    const response=await worker.fetch(new Request(origin+'/api/comments?thread='+thread),{...env,REPORELAY_GITHUB_APP_BOT_LOGIN:'Writer[bot]',ASSETS:{fetch:async()=>Response.json([{thread,title:'Replay'}])}});
    const data=await response.json();
    assert.deepEqual(data.comments, []);
  });
});
