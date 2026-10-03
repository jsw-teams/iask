import { dataScope } from './scope.js';
const SESSION = '__Host-reporelay_session';
const STATE = '__Host-reporelay_oauth';
const encoder = new TextEncoder();
const response = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const bytes64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const un64 = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4)), c => c.charCodeAt(0));
const random = () => bytes64(crypto.getRandomValues(new Uint8Array(32)));

function connectConfig(env) {
  const origin = String(env.REPORELAY_SITE_ORIGIN || '').trim();
  const clientId = String(env.REPORELAY_GITHUB_APP_CLIENT_ID || '').trim();
  const clientSecret = String(env.REPORELAY_GITHUB_APP_CLIENT_SECRET || '').trim();
  let normalizedOrigin = '';
  try {
    const url = new URL(origin);
    if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) {
      normalizedOrigin = url.origin;
    }
  } catch {}
  return { origin: normalizedOrigin, clientId, clientSecret };
}
export function authReady(env) {
  const connect = connectConfig(env);
  return typeof env.REPORELAY_SESSION_SECRET === 'string' && env.REPORELAY_SESSION_SECRET.length >= 32 &&
    typeof env.REPORELAY_IDENTITY_SECRET === 'string' && env.REPORELAY_IDENTITY_SECRET.length >= 32 &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.REPORELAY_REPOSITORY || '') && !!connect.origin && !!connect.clientId && !!connect.clientSecret;
}
async function key(env, purpose) {
  const secret = purpose === 'comment' ? env.REPORELAY_IDENTITY_SECRET : env.REPORELAY_SESSION_SECRET;
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signValue(value, env, purpose) {
  const payload = bytes64(encoder.encode(JSON.stringify(value)));
  const signature = bytes64(new Uint8Array(await crypto.subtle.sign('HMAC', await key(env, purpose), encoder.encode('reporelay:' + await dataScope(env) + ':' + purpose + ':' + payload))));
  return payload + '.' + signature;
}
export async function verifyValue(value, env, purpose) {
  try {
    const secret = purpose === 'comment' ? env.REPORELAY_IDENTITY_SECRET : env.REPORELAY_SESSION_SECRET;
    if (typeof value !== 'string' || value.length > (purpose === 'comment' ? 32000 : 2048) || typeof secret !== 'string' || secret.length < 32) return null;
    const parts = value.split('.');
    if (parts.length !== 2 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) return null;
    if (!await crypto.subtle.verify('HMAC', await key(env, purpose), un64(parts[1]), encoder.encode('reporelay:' + await dataScope(env) + ':' + purpose + ':' + parts[0]))) return null;
    return JSON.parse(new TextDecoder().decode(un64(parts[0])));
  } catch { return null; }
}
function cookie(request, name) {
  return request.headers.get('cookie')?.split(';').map(p => p.trim()).find(p => p.startsWith(name + '='))?.slice(name.length + 1);
}
export const sessionToken = request => cookie(request, SESSION);
function setCookie(name, value, seconds) {
  return name + '=' + value + '; Path=/; Max-Age=' + seconds + '; Secure; HttpOnly; SameSite=Lax';
}
export async function commentSession(request, env) {
  const connect = connectConfig(env);
  if (!authReady(env) || new URL(request.url).origin !== connect.origin) return null;
  const session = await verifyValue(request.headers.get('x-comments-session') || sessionToken(request), env, 'session');
  if (!session || !Number.isFinite(session.exp) || session.exp <= Date.now() || !Number.isSafeInteger(session.id) || session.id <= 0 ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(session.login) || typeof session.csrf !== 'string') return null;
  return session;
}
export function sameOriginPost(request, env) {
  const origin = connectConfig(env).origin;
  return !!origin && request.headers.get('origin') === origin &&
    new URL(request.url).origin === origin &&
    (!request.headers.get('sec-fetch-site') || request.headers.get('sec-fetch-site') === 'same-origin');
}
function safeReturn(value, origin) {
  try {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
    const url = new URL(value, origin);
    if (url.origin !== origin || url.pathname.startsWith('/api/')) return '/';
    return url.pathname + url.search + url.hash;
  } catch { return '/'; }
}
function redirect(location, cookies = []) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(null, { status: 303, headers });
}

export async function handleCommentAuth(request, env) {
  const url = new URL(request.url);
  const connect = connectConfig(env);
  if (!authReady(env) || url.origin !== connect.origin) return response({ error: 'login_unavailable' }, 503);
  const prefix = '/api/comments/';
  const action = url.pathname.slice(prefix.length);
  if (action === 'session') {
    if (request.method !== 'GET') return response({ error: 'method_not_allowed' }, 405);
    const session = await commentSession(request, env);
    return response({ user: session ? { id: session.id, login: session.login, avatarUrl: '/api/comments/avatar/' + session.id } : null, csrf: session?.csrf || null });
  }
  if (action === 'logout') {
    if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);
    const session = await commentSession(request, env);
    if (!sameOriginPost(request, env) || !session || request.headers.get('x-comments-csrf') !== session.csrf)
      return response({ error: 'invalid_session' }, 403);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store', 'Set-Cookie': setCookie(SESSION, '', 0) } });
  }
  if (request.method !== 'GET') return response({ error: 'method_not_allowed' }, 405);
  const callback = connect.origin + prefix + 'callback';
  if (action === 'login') {
    const state = random(), verifier = random();
    const pending = await signValue({ state, verifier, returnTo: safeReturn(url.searchParams.get('return'), connect.origin), exp: Date.now() + 600000 }, env, 'oauth');
    const target = new URL('https://github.com/login/oauth/authorize');
    target.search = new URLSearchParams({ client_id: connect.clientId, redirect_uri: callback,
      state, code_challenge_method: 'S256',
      code_challenge: bytes64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier)))) }).toString();
    return redirect(target.href, [setCookie(STATE, pending, 600)]);
  }
  if (action !== 'callback') return response({ error: 'not_found' }, 404);
  const pending = await verifyValue(cookie(request, STATE), env, 'oauth');
  if (!pending || !Number.isFinite(pending.exp) || pending.exp <= Date.now() || url.searchParams.get('state') !== pending.state)
    return response({ error: 'invalid_oauth_state' }, 403);
  const clear = setCookie(STATE, '', 0);
  if (url.searchParams.has('error')) return redirect(pending.returnTo, [clear]);
  const code = url.searchParams.get('code');
  if (!code || code.length > 256) return response({ error: 'invalid_oauth_code' }, 400);
  try {
    const exchange = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', redirect: 'manual',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: connect.clientId, client_secret: connect.clientSecret,
        redirect_uri: callback, code, code_verifier: pending.verifier }) });
    const token = await exchange.json();
    if (!exchange.ok || token.error || typeof token.access_token !== 'string') throw new Error('Token exchange failed');
    const profile = await fetch('https://api.github.com/user', { redirect: 'manual', headers: {
      Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token.access_token, 'User-Agent': 'CommentNest', 'X-GitHub-Api-Version': '2026-03-10' } });
    const user = await profile.json();
    if (!profile.ok || !Number.isSafeInteger(user.id) || user.id <= 0 || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(user.login)) throw new Error('Invalid GitHub identity');
    const session = await signValue({ id: user.id, login: user.login, csrf: random(), exp: Date.now() + 86400000 }, env, 'session');
    // The GitHub access token is never retained in a cookie or sent to the client.
    return redirect(pending.returnTo, [clear, setCookie(SESSION, session, 86400)]);
  } catch {
    return Response.json({ error: 'github_login_failed' }, { status: 502, headers: { 'Cache-Control': 'no-store', 'Set-Cookie': clear } });
  }
}
