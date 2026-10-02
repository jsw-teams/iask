import { dataScope } from '../src/scope.js';
const scope = await dataScope({REPORELAY_SITE_ORIGIN:'https://js.gripe',REPORELAY_REPOSITORY:'jsw-teams/web'});
import test from 'node:test';
import assert from 'node:assert/strict';
import { worker, appDefaults, mockInstallation, mockRepositoryInstallation } from './helpers.mjs';
import { signValue } from '../src/auth.js';

const env = { ...appDefaults, REPORELAY_REPOSITORY: 'jsw-teams/web',
  REPORELAY_GITHUB_APP_BOT_LOGIN: 'comment-bot[bot]',
  REPORELAY_SITE_ORIGIN: 'https://js.gripe', REPORELAY_GITHUB_APP_CLIENT_ID: 'test-app',
  REPORELAY_GITHUB_APP_CLIENT_SECRET: 'test-secret', REPORELAY_SESSION_SECRET: 'a'.repeat(48), REPORELAY_IDENTITY_SECRET: 'b'.repeat(48),
  ASSETS: {fetch: async () => Response.json([{thread: activeThread, title: 'Test article'}])}};
let activeThread = '';
const sessionCookie = '__Host-reporelay_session=' + await signValue({id: 17, login: 'VerifiedReader', csrf: 'test-csrf', exp: Date.now()+600000},env,'session');

function uniqueThread(prefix) {
  activeThread = prefix + '-' + crypto.randomUUID();
  return activeThread;
}

async function commentHash(thread) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(thread));
  return [...new Uint8Array(digest).slice(0, 12)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function withFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = (url, init) => String(url).endsWith('/installation') ? mockRepositoryInstallation(url,init) : String(url).includes('/app/installations/70001/') ? mockInstallation() : handler(url, init);
  try { return await run(); }
  finally { globalThis.fetch = original; }
}

test('comments GET returns an empty thread before its first comment', async () => {
  const thread = uniqueThread('empty');
  await withFetch(async (url) => {
    assert.match(String(url), /api\.github\.com\/search\/issues/);
    return Response.json({ items: [] });
  }, async () => {
    const response = await worker.fetch(new Request('https://js.gripe/api/comments?thread=' + encodeURIComponent(thread)), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { comments: [], closed: false });
  });
});

test('comments POST creates a GitHub issue and issue comment', async () => {
  const thread = uniqueThread('create');
  activeThread = thread;
  const requests = [];
  await withFetch(async (url, init = {}) => {
    const href = String(url);
    requests.push({ href, init });
    if (href.includes('/search/issues?')) return Response.json({ items: [] });
    if (href.includes('/labels/')) return Response.json({ name: decodeURIComponent(href.split('/').at(-1)) });
    if (href.endsWith('/repos/jsw-teams/web/issues/42') && (init.method || 'GET') === 'GET') {
      const hash = await commentHash(thread);
      return Response.json({ number:42, title:'💬 Test article', body:'<!-- reporelay-thread:' + scope + ':'+hash+' -->', labels:[{name:'comments'},{name:'reporelay'}], state:'open', locked:false });
    }
    if (href.endsWith('/repos/jsw-teams/web/issues')) {
      const payload = JSON.parse(init.body);
      assert.equal(payload.title, '💬 Test article');
      assert.deepEqual(payload.labels, ['comments', 'reporelay']);
      assert.match(payload.body, new RegExp('reporelay-thread:' + scope + ':[0-9a-f]{24}'));
      return Response.json({ number: 42, title: payload.title, body: payload.body, labels: payload.labels.map(name => ({name})), state: 'open', locked: false }, { status: 201 });
    }
    if (href.endsWith('/repos/jsw-teams/web/issues/42/comments')) {
      const payload = JSON.parse(init.body);
      assert.match(payload.body, /reporelay-comment:/);
      assert.match(payload.body, /Hello from the site/);
      return Response.json({
        id: 123,
        body: payload.body,
        created_at: '2026-10-02T12:00:00Z',
        user: { login: 'comment-bot[bot]' }
      }, { status: 201 });
    }
    throw new Error('Unexpected GitHub request: ' + href);
  }, async () => {
    const response = await worker.fetch(new Request('https://js.gripe/api/comments', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://js.gripe', cookie: sessionCookie, 'x-comments-csrf': 'test-csrf',
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({
        thread,
        title: 'Test article',
        name: 'Reader',
        body: 'Hello from the site',
        attachments: [],
        company: ''
      })
    }), env);
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(data.comment.author, 'VerifiedReader');
    assert.equal(data.comment.body, 'Hello from the site');
    assert.equal(data.comment.source, 'site');
    assert.equal(requests.filter(request => request.href.endsWith('/repos/jsw-teams/web/issues') && request.init.method === 'POST').length, 1);
    assert.equal(requests.filter(request => request.href.endsWith('/repos/jsw-teams/web/issues/42/comments') && request.init.method === 'POST').length, 1);
  });
});

test('ordinary GitHub issue comments appear as maintainer replies', async () => {
  const thread = uniqueThread('reply');
  const hash = await commentHash(thread);
  await withFetch(async (url) => {
    const href = String(url);
    if (href.includes('/search/issues?')) {
      return Response.json({ items: [{ number: 9, body:'<!-- reporelay-thread:' + scope + ':'+hash+' -->',title:'💬 Fixture', state: 'open', locked: false }] });
    }
    if (href.endsWith('/issues/9')) return Response.json({number:9,state:'open'});
    if (href.includes('/issues/9/comments?')) {
      return Response.json([{
        id: 77,
        body: 'Thanks for reading.',
        created_at: '2026-10-02T12:30:00Z',
        user: { login: 'jsw-teams' }
      }]);
    }
    throw new Error('Unexpected GitHub request: ' + href);
  }, async () => {
    const response = await worker.fetch(new Request('https://js.gripe/api/comments?thread=' + encodeURIComponent(thread)), env);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.comments.length, 1);
    assert.deepEqual(data.comments[0], {
      id: '77',
      author: 'jsw-teams',
      authorId: null,
      avatarUrl: null,
      profileUrl: 'https://github.com/jsw-teams',
      body: 'Thanks for reading.',
      attachments: [],
      createdAt: '2026-10-02T12:30:00Z',
      source: 'github'
    });
  });
});

test('comments POST rejects cross-origin and oversized submissions before GitHub', async () => {
  let fetched = false;
  await withFetch(async () => {
    fetched = true;
    throw new Error('GitHub should not be called');
  }, async () => {
    const crossOrigin = await worker.fetch(new Request('https://js.gripe/api/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://example.com' },
      body: JSON.stringify({ thread: uniqueThread('bad-origin'), title: 'x', name: 'x', body: 'x', company: '' })
    }), env);
    assert.equal(crossOrigin.status, 403);

    const oversized = await worker.fetch(new Request('https://js.gripe/api/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://js.gripe', cookie: sessionCookie, 'x-comments-csrf': 'test-csrf' },
      body: JSON.stringify({ thread: uniqueThread('large'), title: 'x', name: 'x', body: 'x'.repeat(5001), company: '' })
    }), env);
    assert.equal(oversized.status, 400);
    assert.equal(fetched, false);
  });
});


test('GitHub App installation authentication exchanges a JWT for a scoped token', async () => {
  const thread = uniqueThread('app-auth');
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' },
    true, ['sign','verify']
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pem = '-----BEGIN PRIVATE KEY-----\n' +
    Buffer.from(pkcs8).toString('base64').match(/.{1,64}/g).join('\n') +
    '\n-----END PRIVATE KEY-----';
  const appEnv = {
    ...env,

    REPORELAY_GITHUB_APP_ID: '123456',
    REPORELAY_GITHUB_APP_INSTALLATION_ID: '654321',
    REPORELAY_GITHUB_APP_PRIVATE_KEY: pem
  };
  let exchanged = false;
  await withFetch(async (url, init = {}) => {
    const href = String(url);
    if (href.endsWith('/app/installations/654321/access_tokens')) {
      exchanged = true;
      assert.equal(init.method, 'POST');
      assert.match(init.headers.Authorization, /^Bearer eyJ/);
      const requested = JSON.parse(init.body);
      assert.deepEqual(requested.repositories, ['web']);
      assert.equal(requested.permissions.issues, 'write');
      assert.equal(requested.permissions.contents, 'write');
      return Response.json({ token: 'installation-token', expires_at: new Date(Date.now()+3600000).toISOString() }, { status: 201 });
    }
    if (href.includes('/search/issues?')) {
      assert.equal(init.headers.Authorization, 'Bearer installation-token');
      return Response.json({ items: [] });
    }
    throw new Error('Unexpected GitHub App request: ' + href);
  }, async () => {
    const response = await worker.fetch(new Request('https://js.gripe/api/comments?thread=' + encodeURIComponent(thread)), appEnv);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { comments: [], closed: false });
    assert.equal(exchanged, true);
  });
});
