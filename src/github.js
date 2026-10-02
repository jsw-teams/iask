import { GitHubCommentsError } from './errors.js';
const installationTokenCache = new Map();
const pendingTokens = new Map();
const installations = new Map();
const pendingInstallations = new Map();

export async function repositoryInstallation(settings) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(settings.privateKey)));
  const fingerprint = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  const cacheKey = settings.appId + ':' + settings.repository.toLowerCase() + ':' + fingerprint;
  settings.discoveryKey = cacheKey;
  const cached = installations.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached;
  if (pendingInstallations.has(cacheKey)) return pendingInstallations.get(cacheKey);
  const pending = (async () => {
    const response = await fetch('https://api.github.com/repos/' + settings.owner + '/' + settings.repo + '/installation', {
      redirect: 'manual', headers: {Accept:'application/vnd.github+json', Authorization:'Bearer ' + await githubAppJwt(settings),
        'User-Agent':'RepoRelay', 'X-GitHub-Api-Version':'2026-03-10'}
    });
    if (!response.ok) throw new GitHubCommentsError(response);
    const data = await response.json();
    if (!Number.isSafeInteger(data.id) || data.id <= 0 || String(data.app_id) !== settings.appId ||
        !/^[A-Za-z0-9-]+$/.test(data.app_slug) || data.suspended_at) throw new Error('Invalid repository App installation');
    const result = {installationId:String(data.id), botLogin:data.app_slug + '[bot]', expires:Date.now()+300000};
    if (installations.size >= 128) installations.delete(installations.keys().next().value);
    installations.set(cacheKey, result);
    return result;
  })();
  pendingInstallations.set(cacheKey, pending);
  try {return await pending;} finally {pendingInstallations.delete(cacheKey);}
}


function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function derLength(length) {
  if (length < 128) return Uint8Array.of(length);
  const bytes = [];
  for (let value = length; value; value >>= 8) bytes.unshift(value & 255);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function derWrap(tag, bytes) {
  const length = derLength(bytes.length);
  const out = new Uint8Array(1 + length.length + bytes.length);
  out[0] = tag;
  out.set(length, 1);
  out.set(bytes, 1 + length.length);
  return out;
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function privateKeyDer(pem) {
  const pkcs1 = pem.includes('BEGIN RSA PRIVATE KEY');
  const encoded = pem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s+/g, '');
  const raw = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  if (!pkcs1) return raw;
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const algorithm = Uint8Array.of(
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00
  );
  return derWrap(0x30, concatBytes(version, algorithm, derWrap(0x04, raw)));
}

async function githubAppJwt(settings) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: settings.appId })));
  const input = header + '.' + payload;
  const key = await crypto.subtle.importKey('pkcs8', privateKeyDer(settings.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input)));
  return input + '.' + base64Url(signature);
}

async function exchangeInstallationToken(settings) {
  const cacheKey = settings.appId + ':' + settings.installationId + ':' + settings.repository + ':' + JSON.stringify(settings.permissions || {});
  const cached = installationTokenCache.get(cacheKey);
  if (cached && cached.expires > Date.now() + 120000) return cached.token;
  const jwt = await githubAppJwt(settings);
  const response = await fetch('https://api.github.com/app/installations/' + settings.installationId + '/access_tokens', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + jwt,
      'Content-Type': 'application/json',
      'User-Agent': 'RepoRelay',
      'X-GitHub-Api-Version': '2026-03-10'
    },
    body: JSON.stringify({
      repositories: [settings.repo],
      permissions: settings.permissions || { issues: 'write', contents: 'write', metadata: 'read' }
    })
  });
  if (!response.ok) throw new GitHubCommentsError(response);
  const data = await response.json();
  if (typeof data.token !== 'string' || !data.token) throw new Error('GitHub App installation token missing');
  const expires = Date.parse(data.expires_at);
  if (!Number.isFinite(expires) || expires <= Date.now() + 120000) throw new Error('Invalid installation token expiry');
  if (installationTokenCache.size >= 128) installationTokenCache.delete(installationTokenCache.keys().next().value);
  installationTokenCache.set(cacheKey, { token: data.token, expires });
  return data.token;
}


export function repositorySettings(env) {
  const repository = String(env.REPORELAY_REPOSITORY || '').trim();
  const appId = String(env.REPORELAY_GITHUB_APP_ID || '').trim();
  const privateKey = String(env.REPORELAY_GITHUB_APP_PRIVATE_KEY || '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      !/^\d+$/.test(appId) || !privateKey.includes('PRIVATE KEY')) return null;
  const [owner, repo] = repository.split('/');
  const permissions = env.REPORELAY_GITHUB_PERMISSIONS || { contents:'read', metadata:'read' };
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions) || Object.entries(permissions).some(([name,level]) => !['contents','issues','metadata'].includes(name) || !['read','write'].includes(level))) return null;
  return { repository, owner, repo, appId, privateKey, permissions };
}

// For trusted server-side code only. No arbitrary URL or repository is accepted.
export function createRepositoryClient(env) {
  const settings = repositorySettings(env);
  if (!settings) throw new Error('RepoRelay GitHub App configuration is incomplete');
  return {
    async readFile(path, ref = 'main') {
      if (typeof path !== 'string' || !path || path.startsWith('/') || path.length > 512 ||
          path.split('/').some(part => !part || part === '.' || part === '..') || /[\\\x00-\x1f\x7f]/.test(path)) throw new Error('Invalid repository path');
      if (typeof ref !== 'string' || !ref || ref.length > 240) throw new Error('Invalid ref');
      return githubRequest(settings, '/repos/' + settings.owner + '/' + settings.repo + '/contents/' +
        path.split('/').map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(ref));
    }
  };
}

export async function githubRequest(settings, path, init = {}) {
  const token = await installationToken(settings);
  const response = await fetch('https://api.github.com' + path, {
    ...init,
    redirect: 'manual',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'User-Agent': 'RepoRelay',
      'X-GitHub-Api-Version': '2026-03-10',
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    if (response.status === 401) {
      installationTokenCache.delete(settings.appId + ':' + settings.installationId + ':' + settings.repository + ':' + JSON.stringify(settings.permissions || {}));
      installations.delete(settings.discoveryKey);
    }
    throw new GitHubCommentsError(response);
  }
  if (response.status === 204) return null;
  return response.json();
}


export async function installationToken(settings) {
  const installation = await repositoryInstallation(settings);
  settings.installationId = installation.installationId;
  const cacheKey = settings.appId + ':' + settings.installationId + ':' + settings.repository + ':' + JSON.stringify(settings.permissions || {});
  if (pendingTokens.has(cacheKey)) return pendingTokens.get(cacheKey);
  const pending = exchangeInstallationToken(settings);
  pendingTokens.set(cacheKey, pending);
  try { return await pending; } finally { pendingTokens.delete(cacheKey); }
}
