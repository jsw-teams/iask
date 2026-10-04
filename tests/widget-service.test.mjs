import test from 'node:test';
import assert from 'node:assert/strict';
import {handleServiceRequest} from '../backend/service.js';
import {signValue} from '../backend/auth.js';
import {appDefaults} from './helpers.mjs';
const backend='https://comments.example.com',website='https://journal.example.com';
const env={...appDefaults,COMMENTNEST_SITE_ORIGIN:backend,COMMENTNEST_WEBSITE_ORIGIN:website,COMMENTNEST_REPOSITORY:'owner/comments',COMMENTNEST_GITHUB_APP_CLIENT_ID:'app',COMMENTNEST_GITHUB_APP_CLIENT_SECRET:'secret',COMMENTNEST_SESSION_SECRET:'a'.repeat(64),COMMENTNEST_IDENTITY_SECRET:'b'.repeat(64),COMMENTNEST_ASSETS:{fetch:async()=>new Response('export const widget=true',{headers:{'Content-Type':'text/javascript'}})}};
const normalized={...env,REPORELAY_SITE_ORIGIN:backend,REPORELAY_REPOSITORY:'owner/comments',REPORELAY_SESSION_SECRET:env.COMMENTNEST_SESSION_SECRET,REPORELAY_IDENTITY_SECRET:env.COMMENTNEST_IDENTITY_SECRET};
test('embed accepts public HTTPS websites, escapes metadata, and isolates host styles',async()=>{
 const params=new URLSearchParams({parent:website,thread:'article',channel:'a'.repeat(32),title:'</script><img src=x>',locale:'zh-TW'});
 const response=await handleServiceRequest(new Request(backend+'/commentnest/embed?'+params),env);
 assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/frame-ancestors https:/);
 const text=await response.text();assert.ok(!text.includes('</script><img'));assert.match(text,/lang="zh-TW"/);assert.equal(response.headers.get('cache-control'),'no-store');
 params.set('parent','https://another.example');assert.equal((await handleServiceRequest(new Request(backend+'/commentnest/embed?'+params),env)).status,200);
 params.set('parent','http://another.example');assert.equal((await handleServiceRequest(new Request(backend+'/commentnest/embed?'+params),env)).status,400);
 params.set('parent',website);params.set('channel','bad');assert.equal((await handleServiceRequest(new Request(backend+'/commentnest/embed?'+params),env)).status,400);
});
test('cross-origin module delivery is public and does not enable credentialed CORS',async()=>{
 const response=await handleServiceRequest(new Request(backend+'/commentnest/widget.js',{headers:{Origin:'https://attacker.example'}}),env);
 assert.equal(response.headers.get('access-control-allow-origin'),'*');assert.equal(response.headers.get('access-control-allow-credentials'),null);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.equal(await handleServiceRequest(new Request(backend+'/unrelated'),env),null);
});
test('popup transfers only a signed session to its own origin and cannot be framed',async()=>{
 const token=await signValue({id:17,login:'Reader',csrf:'csrf',exp:Date.now()+600000},normalized,'session');
 const response=await handleServiceRequest(new Request(backend+'/commentnest/auth-complete?channel='+'c'.repeat(32),{headers:{Cookie:'__Host-reporelay_session='+token}}),env);
 assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 const body=await response.text();assert.ok(body.includes(token));assert.ok(body.includes('location.origin'));assert.ok(!body.includes(env.COMMENTNEST_GITHUB_APP_CLIENT_SECRET+'"'));
 const read=await handleServiceRequest(new Request(backend+'/api/comments/session',{headers:{'X-Comments-Session':token}}),env);
 assert.equal((await read.json()).user.login,'Reader');
 const forged=await handleServiceRequest(new Request(backend+'/api/comments/session',{headers:{'X-Comments-Session':token+'x'}}),env);assert.equal((await forged.json()).user,null);
});
