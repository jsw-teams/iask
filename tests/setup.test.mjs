import test from 'node:test';
import assert from 'node:assert/strict';
import { CommentCoordinator, handleCommentRequest } from '../src/index.js';
import { signingEnvironment } from '../src/keys.js';
import { repositoryInstallation } from '../src/github.js';
import { signValue, verifyValue } from '../src/auth.js';
import { appDefaults } from './helpers.mjs';

function deployment() {
  const stores=new Map(), objects=new Map();
  const env={...appDefaults,REPORELAY_SITE_ORIGIN:'https://first.example',REPORELAY_REPOSITORY:'owner/comments',
    REPORELAY_GITHUB_APP_CLIENT_ID:'app',REPORELAY_GITHUB_APP_CLIENT_SECRET:'secret'};
  env.REPORELAY_THREADS={idFromName:name=>name,get:name=>{
    if (!stores.has(name)) {
      const values=new Map(); let pending=Promise.resolve();
      const storage={get:async key=>values.get(key),put:async(key,value)=>values.set(key,value)};
      storage.transaction=callback=>{const result=pending.then(()=>callback(storage));pending=result.catch(()=>{});return result;};
      stores.set(name,storage);
    }
    if(!objects.has(name))objects.set(name,new CommentCoordinator({storage:stores.get(name)},env));
    return objects.get(name);
  }};
  return {env,restart:()=>objects.clear()};
}

test('automatic signing keys are persistent, site-specific and independent of App credential rotation',async()=>{
  const {env,restart}=deployment();
  const results=await Promise.all(Array.from({length:20},()=>signingEnvironment(env)));
  assert.equal(new Set(results.map(result=>result.REPORELAY_IDENTITY_SECRET)).size,1);
  const ready=results[0];assert.notEqual(ready.REPORELAY_SESSION_SECRET,ready.REPORELAY_IDENTITY_SECRET);
  const signed=await signValue({body:'Keep my formal comment'},ready,'comment');
  restart();
  const rotated=await signingEnvironment({...env,REPORELAY_GITHUB_APP_PRIVATE_KEY:'rotated App key',REPORELAY_GITHUB_APP_CLIENT_SECRET:'rotated secret'});
  assert.deepEqual(await verifyValue(signed,rotated,'comment'),{body:'Keep my formal comment'});
  const other=await signingEnvironment({...env,REPORELAY_SITE_ORIGIN:'https://second.example'});
  assert.notEqual(other.REPORELAY_IDENTITY_SECRET,ready.REPORELAY_IDENTITY_SECRET);
  assert.equal(await verifyValue(signed,other,'comment'),null);
});

test('automatic keys work for login without manual signing Secrets and are never public routes',async()=>{
  const {env}=deployment();
  const response=await handleCommentRequest(new Request(env.REPORELAY_SITE_ORIGIN+'/api/comments/login?return=/article/'),env);
  assert.equal(response.status,303);
  assert.equal(new URL(response.headers.get('location')).searchParams.get('redirect_uri'),env.REPORELAY_SITE_ORIGIN+'/api/comments/callback');
  assert.equal(await handleCommentRequest(new Request(env.REPORELAY_SITE_ORIGIN+'/__reporelay/keys'),env),null);
  const publicAttempt=await handleCommentRequest(new Request(env.REPORELAY_SITE_ORIGIN+'/api/comments/__reporelay/keys'),env);
  assert.equal(publicAttempt.status,404);
  assert.deepEqual(await publicAttempt.json(),{error:'not_found'});
});

test('repository installation discovery coalesces calls, derives bot identity and rejects another App',async()=>{
  const saved=globalThis.fetch;let calls=0;
  const settings={appId:'60001',owner:'owner',repo:'discovery',repository:'owner/discovery',privateKey:appDefaults.REPORELAY_GITHUB_APP_PRIVATE_KEY};
  globalThis.fetch=async(url,init)=>{
    calls++;assert.equal(url,'https://api.github.com/repos/owner/discovery/installation');
    assert.equal(init.redirect,'manual');assert.match(init.headers.Authorization,/^Bearer eyJ/);
    return Response.json({id:70001,app_id:60001,app_slug:'derived-bot',suspended_at:null});
  };
  try{
    const results=await Promise.all(Array.from({length:10},()=>repositoryInstallation({...settings})));
    assert.equal(calls,1);assert.equal(results[0].installationId,'70001');assert.equal(results[0].botLogin,'derived-bot[bot]');
    globalThis.fetch=async()=>Response.json({id:70001,app_id:12345,app_slug:'wrong-app'});
    await assert.rejects(repositoryInstallation({...settings,repo:'wrong',repository:'owner/wrong'}),/Invalid repository App installation/);
  }finally{globalThis.fetch=saved;}
});
