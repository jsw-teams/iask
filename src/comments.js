import { githubRequest, installationToken } from './github.js';
import { GitHubCommentsError } from './errors.js';
import { authReady, commentSession, handleCommentAuth, sameOriginPost, signValue, verifyValue } from './auth.js';

const MAX_BACKEND_BODY_BYTES = 1_000_000;
const MAX_COMMENT_BODY_LENGTH = 5_000;
const COMMENT_MARKER = 'reporelay-comment:v2';
const COMMENT_BODY_MARKER = '<!-- reporelay-comment-body -->';
const ISSUE_THREAD_MARKER = 'reporelay-thread:v2';
const COMMENT_LABELS = [
  { name: 'comments', color: '0e8a16', description: 'Article comment threads' },
  { name: 'reporelay', color: '0969da', description: 'Managed through RepoRelay' }
];
const mediaBranch = settings => 'reporelay-media-' + settings.namespace;
const MAX_COMMENT_MEDIA_BYTES = 5_000_000;
const COMMENT_MEDIA_TYPES = new Map([
  ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/gif', 'gif'],
  ['image/webp', 'webp'], ['image/avif', 'avif']
]);
const issueCache = new Map();

function commentFailure(error) {
  if (error?.creationPending) return json({ error: 'comments_creation_pending' }, 503, { 'Retry-After': '60' });
  if (error instanceof GitHubCommentsError) {
    if (error.rateLimited) return json({ error: 'comments_rate_limited' }, 503, { 'Retry-After': String(error.retryAfter) });
    if (error.status === 401) return json({ error: 'comments_credentials_unavailable' }, 503);
    if (error.status === 403) return json({ error: 'comments_permission_denied' }, 503);
    if (error.status === 404 || error.status === 410) return json({ error: 'comments_unavailable' }, 503);
  }
  return json({ error: 'comments_backend_error' }, 502);
}
const missingIssue = error => error instanceof GitHubCommentsError && [404, 410].includes(error.status);
const issuePath = (settings, number) => '/repos/' + settings.owner + '/' + settings.repo + '/issues/' + number;

async function forgetDeletedIssue(settings, thread) {
  // GitHub can also hide resources after permissions are revoked. Verify repository
  // and Issues access before treating a 404 as deletion or creating a replacement.
  const repository = await githubRequest(settings, '/repos/' + settings.owner + '/' + settings.repo);
  if (repository.has_issues !== true) throw new GitHubCommentsError(new Response(null, { status: 403 }));
  await githubRequest(settings, '/repos/' + settings.owner + '/' + settings.repo + '/issues?state=all&per_page=1');
  const hash = await threadHash(thread);
  await settings.storage?.delete('issue');
  issueCache.set(settings.repository + ':' + settings.namespace + ':' + hash, { issue: null, expires: Date.now() + 30_000 });
}

const json = (data, status = 200, headers = {}) => Response.json(data, {
  status,
  headers: { 'Cache-Control': 'no-store', ...headers }
});

async function readBoundedBody(body, limit) {
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function commentSettings(env) {
  const repository = typeof env.REPORELAY_REPOSITORY === 'string' ? env.REPORELAY_REPOSITORY.trim() : '';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return null;
  const [owner, repo] = repository.split('/');
  const namespace = String(env.REPORELAY_NAMESPACE || '').trim();
  const appId = String(env.REPORELAY_GITHUB_APP_ID || '').trim();
  const installationId = String(env.REPORELAY_GITHUB_APP_INSTALLATION_ID || '').trim();
  const privateKey = String(env.REPORELAY_GITHUB_APP_PRIVATE_KEY || '').trim();
  const botLogin = String(env.REPORELAY_GITHUB_APP_BOT_LOGIN || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(namespace) ||
      !/^\d+$/.test(appId) || !/^\d+$/.test(installationId) || !privateKey.includes('PRIVATE KEY') ||
      !/^[A-Za-z0-9-]+\[bot\]$/.test(botLogin) || !authReady(env)) return null;
  return { repository, owner, repo, namespace, appId, installationId, privateKey, storage: env.REPORELAY_STORAGE };
}

function validThread(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 240 &&
    !/[\u0000-\u001f\u007f?#\\]/.test(value) && !value.startsWith('/') &&
    value.split('/').every((part) => part && part !== '.' && part !== '..');
}

function escapeMarkdownInline(value) {
  return String(value).replaceAll(String.fromCharCode(96), '').replace(/([\\*_{}[\]()#+\-.!|>])/g, '\\$1');
}

async function storedCommentBody(session, body, attachments, env, thread) {
  const name = session.login;
  const metadata = await signValue({ id: session.id, login: name, body, attachments, thread, namespace: env.REPORELAY_NAMESPACE }, env, 'comment');
  const quotedBody = body.split(/\r?\n/).map((line) => '    ' + line).join('\n');
  const media = attachments.map((url, index) => '![' + escapeMarkdownInline('Attachment ' + (index + 1)) + '](' + url + ')').join('\n\n');
  return '<!-- ' + COMMENT_MARKER + ':' + metadata + ' -->\n\n' +
    '> Comment by **' + escapeMarkdownInline(name) + '** via RepoRelay\n\n' +
    COMMENT_BODY_MARKER + '\n' + quotedBody + (media ? '\n\n' + media : '');
}

async function parseStoredComment(comment, env, thread) {
  const body = typeof comment.body === 'string' ? comment.body : '';
  const marker = body.match(/^<!-- reporelay-comment:v2:([A-Za-z0-9_.-]+) -->\n\n/);
  if (/^<!-- (?:edgepress-comment:|reporelay-comment:v1:)/.test(body)) return null;
  let author = comment.user?.login || 'GitHub';
  let text = body;
  let source = 'github';
  const trustedWriter = String(env.REPORELAY_GITHUB_APP_BOT_LOGIN || '').trim();
  if (marker && comment.user?.login === trustedWriter) {
    const metadata = await verifyValue(marker[1], env, 'comment');
    if (metadata && metadata.thread === thread && metadata.namespace === env.REPORELAY_NAMESPACE && Number.isSafeInteger(metadata.id) && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(metadata.login) && typeof metadata.body === 'string') {
      author = metadata.login;
      text = metadata.body;
      source = 'site';
    }
  }
  if (marker && source !== 'site') return null;
  let attachments = [];
  if (marker && comment.user?.login === trustedWriter) {
    const metadata = await verifyValue(marker[1], env, 'comment');
    if (metadata && metadata.thread === thread && metadata.namespace === env.REPORELAY_NAMESPACE && Array.isArray(metadata.attachments)) {
      const prefix = env.REPORELAY_SITE_ORIGIN + '/api/comments/media/' + env.REPORELAY_NAMESPACE + '/' + await threadHash(thread) + '/';
      attachments = metadata.attachments.filter(value => typeof value === 'string' && value.startsWith(prefix) && /^[0-9a-f-]{36}\.(png|jpg|gif|webp|avif)$/.test(value.slice(prefix.length))).slice(0, 4);
    }
  }
  return {
    id: String(comment.id),
    author,
    profileUrl: /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(author) ? 'https://github.com/' + author : null,
    body: text,
    attachments,
    createdAt: comment.created_at,
    source
  };
}

async function threadHash(thread) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(thread));
  return [...new Uint8Array(digest).slice(0, 12)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function ensureCommentLabels(settings) {
  for (const label of COMMENT_LABELS) {
    const path = '/repos/' + encodeURIComponent(settings.owner) + '/' + encodeURIComponent(settings.repo) + '/labels/' + encodeURIComponent(label.name);
    try { await githubRequest(settings, path); }
    catch (error) {
      if (!(error instanceof GitHubCommentsError) || error.status !== 404) throw error;
      try {
        await githubRequest(settings, '/repos/' + encodeURIComponent(settings.owner) + '/' + encodeURIComponent(settings.repo) + '/labels', {
          method: 'POST',
          body: JSON.stringify(label)
        });
      } catch (createError) {
        if (!(createError instanceof GitHubCommentsError) || createError.status !== 422) throw createError;
      }
    }
  }
}

function issueMarker(settings, hash) {
  return '<!-- ' + ISSUE_THREAD_MARKER + ':' + settings.namespace + ':' + hash + ' -->';
}

async function findCommentIssue(settings, thread) {
  if (issueCache.size >= 256) issueCache.delete(issueCache.keys().next().value);
  const hash = await threadHash(thread);
  const cacheKey = settings.repository + ':' + settings.namespace + ':' + hash;
  const stored = await settings.storage?.get('issue');
  if (stored) return stored;
  const creating = await settings.storage?.get('creating');
  const cached = issueCache.get(cacheKey);
  if (!creating && cached && cached.expires > Date.now()) return cached.issue;
  const marker = issueMarker(settings, hash);
  const markerQuery = 'repo:' + settings.repository + ' is:issue in:body "' + ISSUE_THREAD_MARKER + ':' + settings.namespace + ':' + hash + '"';
  const result = await githubRequest(settings, '/search/issues?q=' + encodeURIComponent(markerQuery) + '&per_page=100');
  const issue = (result.items || []).filter(item => !item.pull_request && item.body?.includes(marker))
    .sort((a, b) => a.number - b.number)[0] || null;
  if (issue) await cacheCommentIssue(settings, thread, issue);
  if (!issue && creating) {
    const error = new Error('A previous Issue creation has an uncertain result');
    error.creationPending = true;
    throw error;
  }
  issueCache.set(cacheKey, { issue, expires: Date.now() + 30_000 });
  return issue;
}

async function cacheCommentIssue(settings, thread, issue) {
  await settings.storage?.put('issue', issue);
  await settings.storage?.delete('creating');
  const hash = await threadHash(thread);
  issueCache.set(settings.repository + ':' + settings.namespace + ':' + hash, { issue, expires: Date.now() + 30_000 });
}

async function normalizeCommentIssue(settings, issue, thread, title, requestUrl) {
  const hash = await threadHash(thread);
  const marker = issueMarker(settings, hash);
  const friendlyTitle = '💬 ' + title;
  const current = await githubRequest(settings, issuePath(settings, issue.number));
  const body = typeof current.body === 'string' ? current.body : '';
  const labels = new Set((current.labels || []).map(label => typeof label === 'string' ? label : label.name).filter(Boolean));
  for (const label of COMMENT_LABELS) labels.add(label.name);
  if (current.title === friendlyTitle && body.includes(marker) && COMMENT_LABELS.every(label => (current.labels || []).some(item => (item.name || item) === label.name))) return current;
  const siteUrl = new URL(requestUrl).origin;
  const nextBody = body.includes(marker) ? body : [
    marker,
    '',
    'Comment thread for [' + title + '](' + siteUrl + '/).',
    '',
    'Managed by JS.GRIPE comments. Delete an individual Issue Comment to moderate one post; close or lock this Issue to close the article comment section.'
  ].join('\n');
  return githubRequest(settings, issuePath(settings, issue.number), {
    method: 'PATCH',
    body: JSON.stringify({ title: friendlyTitle, body: nextBody, labels: [...labels] })
  });
}

async function createCommentIssue(settings, thread, title, requestUrl) {
  const hash = await threadHash(thread);
  const siteUrl = new URL(requestUrl).origin;
  await ensureCommentLabels(settings);
  await settings.storage?.put('creating', true);
  let issue;
  try {
  issue = await githubRequest(settings, '/repos/' + encodeURIComponent(settings.owner) + '/' +
    encodeURIComponent(settings.repo) + '/issues', {
    method: 'POST',
    body: JSON.stringify({
      title: '💬 ' + title,
      labels: COMMENT_LABELS.map(label => label.name),
      body: [
        issueMarker(settings, hash),
        '',
        'Comment thread for **' + title.replace(/[\r\n]/g, ' ') + '** on ' + siteUrl + '.',
        '',
        'This single Issue is the RepoRelay discussion thread for the article across its localized versions.',
        'Delete an individual Issue Comment to remove one inappropriate post. Close or lock this Issue to close the article comment section.',
        'If this Issue is deleted, the next authenticated website comment will create a replacement thread.'
      ].join('\n')
    })
  });
  } catch (error) {
    if (error instanceof GitHubCommentsError && error.status >= 400 && error.status < 500)
      await settings.storage?.delete('creating');
    throw error;
  }
  await cacheCommentIssue(settings, thread, issue);
  return issue;
}

function validMediaBytes(type, bytes) {
  if (!COMMENT_MEDIA_TYPES.has(type) || bytes.length < 12) return false;
  if (type === 'image/png') return [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value,index)=>bytes[index]===value);
  if (type === 'image/jpeg') return bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
  if (type === 'image/gif') return new TextDecoder().decode(bytes.slice(0,6)) === 'GIF87a' || new TextDecoder().decode(bytes.slice(0,6)) === 'GIF89a';
  if (type === 'image/webp') return new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP';
  if (type === 'image/avif') {
    const box = new TextDecoder().decode(bytes.slice(4,16));
    return box.includes('ftyp') && (box.includes('avif') || box.includes('avis'));
  }
  return false;
}

function bytesToBase64(bytes) {
  let binary = '';
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + size)));
  }
  return btoa(binary);
}

async function ensureMediaBranch(settings) {
  const refPath = '/repos/' + encodeURIComponent(settings.owner) + '/' + encodeURIComponent(settings.repo) + '/git/ref/heads/' + mediaBranch(settings);
  try { return await githubRequest(settings, refPath); }
  catch (error) {
    if (!(error instanceof GitHubCommentsError) || error.status !== 404) throw error;
  }
  const repository = await githubRequest(settings, '/repos/' + encodeURIComponent(settings.owner) + '/' + encodeURIComponent(settings.repo));
  const base = await githubRequest(settings, '/repos/' + encodeURIComponent(settings.owner) + '/' + encodeURIComponent(settings.repo) +
    '/git/ref/heads/' + encodeURIComponent(repository.default_branch));
  try {
    return await githubRequest(settings, '/repos/' + encodeURIComponent(settings.owner) + '/' + encodeURIComponent(settings.repo) + '/git/refs', {
      method: 'POST',
      body: JSON.stringify({ ref: 'refs/heads/' + mediaBranch(settings), sha: base.object.sha })
    });
  } catch (error) {
    if (!(error instanceof GitHubCommentsError) || error.status !== 422) throw error;
    return await githubRequest(settings, refPath);
  }
}

function mediaUrlFor(requestUrl, settings, hash, filename) {
  return new URL('/api/comments/media/' + settings.namespace + '/' + hash + '/' + filename, requestUrl).href;
}

async function handleCommentMedia(request, env) {
  const settings = commentSettings(env);
  if (!settings) return json({ error: 'comments_unavailable' }, 503);
  const url = new URL(request.url);
  const publicPath = url.pathname.slice('/api/comments/media/'.length);
  if (request.method === 'GET' && !publicPath.startsWith(settings.namespace + '/')) return json({ error: 'not_found' }, 404);
  const relative = publicPath.slice(settings.namespace.length + 1);

  if (request.method === 'GET') {
    if (!/^[0-9a-f]{24}\/[A-Za-z0-9._-]{1,120}$/.test(relative)) return json({ error: 'not_found' }, 404);
    try {
      const token = await installationToken(settings);
      const api = 'https://api.github.com/repos/' + encodeURIComponent(settings.owner) + '/' + encodeURIComponent(settings.repo) +
        '/contents/' + relative + '?ref=' + encodeURIComponent(mediaBranch(settings));
      const response = await fetch(api, {
        redirect: 'manual',
        headers: {
          Accept: 'application/vnd.github.raw+json',
          Authorization: 'Bearer ' + token,
          'User-Agent': 'RepoRelay/0.1',
          'X-GitHub-Api-Version': '2026-03-10'
        }
      });
      if (!response.ok) return response.status === 404 ? json({ error: 'not_found' }, 404) : commentFailure(new GitHubCommentsError(response));
      const extension = relative.split('.').at(-1);
      const type = [...COMMENT_MEDIA_TYPES].find(([, ext]) => ext === extension)?.[0];
      if (!type) return json({ error: 'not_found' }, 404);
      const bytes = response.body ? await readBoundedBody(response.body, MAX_COMMENT_MEDIA_BYTES) : null;
      if (!bytes || !validMediaBytes(type, bytes)) return json({ error: 'invalid_media' }, 502);
      return new Response(bytes, { headers: {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox"
      }});
    } catch (error) {
      return commentFailure(error);
    }
  }

  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, POST' });
  if (url.pathname !== '/api/comments/media/') return json({ error: 'not_found' }, 404);
  if (!sameOriginPost(request, env)) return json({ error: 'cross_origin_request' }, 403);
  const session = await commentSession(request, env);
  if (!session) return json({ error: 'login_required' }, 401);
  if (request.headers.get('x-comments-csrf') !== session.csrf) return json({ error: 'invalid_csrf' }, 403);

  const thread = request.headers.get('x-comments-thread')?.trim() || '';
  if (!validThread(thread)) return json({ error: 'invalid_thread' }, 400);
  const type = request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase() || '';
  if (!COMMENT_MEDIA_TYPES.has(type)) return json({ error: 'unsupported_media_type' }, 415);
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_COMMENT_MEDIA_BYTES) return json({ error: 'payload_too_large' }, 413);
  const bytes = request.body ? await readBoundedBody(request.body, MAX_COMMENT_MEDIA_BYTES) : null;
  if (!bytes || !validMediaBytes(type, bytes)) return json({ error: bytes ? 'invalid_media' : 'payload_too_large' }, bytes ? 400 : 413);

  try {
    const published = await publishedThread(request, env, thread);
    if (published instanceof Response) return published;
    const issue = await findCommentIssue(settings, thread);
    if (issue) {
      let current;
      try { current = await githubRequest(settings, issuePath(settings, issue.number)); }
      catch (error) {
        if (!missingIssue(error)) throw error;
        await forgetDeletedIssue(settings, thread);
      }
      if (current && (current.state !== 'open' || current.locked === true)) return json({ error: 'comments_closed' }, 409);
    }
    await ensureMediaBranch(settings);
    const hash = await threadHash(thread);
    const extension = COMMENT_MEDIA_TYPES.get(type);
    const filename = crypto.randomUUID() + '.' + extension;
    const mediaPath = hash + '/' + filename;
    await githubRequest(settings, '/repos/' + encodeURIComponent(settings.owner) + '/' + encodeURIComponent(settings.repo) +
      '/contents/' + mediaPath, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Store comment media for ' + thread,
        content: bytesToBase64(bytes),
        branch: mediaBranch(settings)
      })
    });
    const url = mediaUrlFor(request.url, settings, hash, filename);
    const receipt = await signValue({ url, thread, id: session.id, exp: Date.now() + 86400000 }, env, 'media');
    return json({ url, receipt, type, size: bytes.length }, 201);
  } catch (error) {
    console.error('Comment media upload failed:', error?.message || error);
    return commentFailure(error);
  }
}

async function readIssueComments(settings, issueNumber, env, thread) {
  const comments = [];
  for (let page = 1; page <= 5; page += 1) {
    const batch = await githubRequest(settings, '/repos/' + encodeURIComponent(settings.owner) + '/' +
      encodeURIComponent(settings.repo) + '/issues/' + issueNumber + '/comments?per_page=100&page=' + page);
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  return (await Promise.all(comments.map(comment => parseStoredComment(comment, env, thread)))).filter(Boolean);
}

async function readApiBody(request) {
  if (!request.body) return new Uint8Array();
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) return { error: 'invalid_content_length', status: 400 };
    if (length > MAX_BACKEND_BODY_BYTES) return { error: 'payload_too_large', status: 413 };
  }
  const body = await readBoundedBody(request.body, MAX_BACKEND_BODY_BYTES);
  return body === null ? { error: 'payload_too_large', status: 413 } : body;
}

async function handleComments(request, env) {
  if (!['GET', 'POST'].includes(request.method)) {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, POST' });
  }
  const settings = commentSettings(env);
  if (!settings) return json({ error: 'comments_unavailable' }, 503);

  const url = new URL(request.url);
  if (request.method === 'GET') {
    const thread = url.searchParams.get('thread');
    if (!validThread(thread)) return json({ error: 'invalid_thread' }, 400);
    try {
      const published = await publishedThread(request, env, thread);
      if (published instanceof Response) return published;
      let issue = await findCommentIssue(settings, thread);
      if (!issue) return json({ comments: [], closed: false });
      let comments;
      try {
        issue = await githubRequest(settings, issuePath(settings, issue.number));
        comments = await readIssueComments(settings, issue.number, env, thread);
        await cacheCommentIssue(settings, thread, issue);
      }
      catch (error) {
        if (!missingIssue(error)) throw error;
        await forgetDeletedIssue(settings, thread);
        return json({ comments: [], closed: false, threadReset: true });
      }
      return json({ comments, closed: issue.state !== 'open' || issue.locked === true });
    } catch (error) {
      console.error('Comment read failed:', error?.message || error);
      return commentFailure(error);
    }
  }

  if (!sameOriginPost(request, env)) return json({ error: 'cross_origin_request' }, 403);
  const session = await commentSession(request, env);
  if (!session) return json({ error: 'login_required' }, 401);
  if (request.headers.get('x-comments-csrf') !== session.csrf) return json({ error: 'invalid_csrf' }, 403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json({ error: 'unsupported_media_type' }, 415);
  }
  const bodyBytes = await readApiBody(request);
  if (bodyBytes?.error) return json({ error: bodyBytes.error }, bodyBytes.status);
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(bodyBytes)); }
  catch { return json({ error: 'invalid_json' }, 400); }

  if (!payload || Array.isArray(payload) || typeof payload !== 'object') return json({ error: 'invalid_comment' }, 400);
  const thread = typeof payload.thread === 'string' ? payload.thread.trim() : '';
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  const media = payload.attachments === undefined ? [] : payload.attachments;
  if (!Array.isArray(media) || media.length > 4 || media.some(item => !item || typeof item.url !== 'string' || typeof item.receipt !== 'string')) return json({ error: 'invalid_comment' }, 400);
  const attachments = media.map(item => item.url);
  for (const item of media) {
    const receipt = await verifyValue(item.receipt, env, 'media');
    if (!receipt || receipt.url !== item.url || receipt.thread !== thread || receipt.id !== session.id || !Number.isFinite(receipt.exp) || receipt.exp <= Date.now()) return json({ error: 'invalid_attachment' }, 400);
  }
  const honeypot = typeof payload.company === 'string' ? payload.company.trim() : '';
  if (honeypot) return json({ error: 'invalid_submission' }, 400);
  const hash = validThread(thread) ? await threadHash(thread) : '';
  const attachmentPrefix = new URL('/api/comments/media/' + settings.namespace + '/' + hash + '/', request.url).href;
  if (!validThread(thread) || (!body && attachments.length === 0) || body.length > MAX_COMMENT_BODY_LENGTH || /\u0000/.test(body) ||
      attachments.length > 4 || attachments.some(value => !value.startsWith(attachmentPrefix) || !/^[0-9a-f-]{36}\.(png|jpg|gif|webp|avif)$/.test(value.slice(attachmentPrefix.length)))) {
    return json({ error: 'invalid_comment' }, 400);
  }

  try {
    const published = await publishedThread(request, env, thread);
    if (published instanceof Response) return published;
    let issue = await findCommentIssue(settings, thread);
    let replaced = false;
    if (!issue) issue = await createCommentIssue(settings, thread, published.title, request.url);
    else {
      try { issue = await githubRequest(settings, issuePath(settings, issue.number)); }
      catch (error) {
        if (!missingIssue(error)) throw error;
        await forgetDeletedIssue(settings, thread);
        issue = await createCommentIssue(settings, thread, published.title, request.url);
        replaced = true;
      }
    }
    if (issue.state !== 'open' || issue.locked === true) return json({ error: 'comments_closed' }, 409);
    issue = await normalizeCommentIssue(settings, issue, thread, published.title, request.url);
    const submission = { method: 'POST', body: JSON.stringify({ body: await storedCommentBody(session, body, attachments, env, thread) }) };
    let created;
    try { created = await githubRequest(settings, issuePath(settings, issue.number) + '/comments', submission); }
    catch (error) {
      // Retry only a definite missing issue; never retry a timeout/5xx write that
      // may already have succeeded and would duplicate the visitor's comment.
      if (!missingIssue(error) || replaced) throw error;
      await forgetDeletedIssue(settings, thread);
      issue = await createCommentIssue(settings, thread, published.title, request.url);
      created = await githubRequest(settings, issuePath(settings, issue.number) + '/comments', submission);
    }
    return json({ comment: await parseStoredComment(created, env, thread) }, 201);
  } catch (error) {
    console.error('Comment write failed:', error?.message || error);
    return commentFailure(error);
  }
}


async function publishedThread(request, env, thread) {
  try {
    const response = await env.ASSETS.fetch(new Request(new URL('/edgepress/comment-threads.json', request.url)));
    if (!response.ok) return json({ error: 'comments_unavailable' }, 503);
    const manifest = await response.json();
    if (!Array.isArray(manifest)) return json({ error: 'comments_unavailable' }, 503);
    return manifest.find(item => item.thread === thread) || json({ error: 'unknown_thread' }, 404);
  } catch { return json({ error: 'comments_unavailable' }, 503); }
}

// A single object per repository/namespace/article serializes GitHub operations.
// Persisting the Issue number avoids depending on GitHub search indexing after writes.
export class CommentCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.pending = Promise.resolve();
  }
  async fetch(request) {
    const task = this.pending.then(() => handleCommentRequest(request,
      { ...this.env, REPORELAY_STORAGE: this.state.storage }, { coordinated: true }));
    this.pending = task.catch(() => {});
    return task;
  }
}

export async function handleCommentRequest(request, env, { coordinated = false } = {}) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/comments' && !url.pathname.startsWith('/api/comments/')) return null;
  if (!coordinated && (url.pathname === '/api/comments' ||
      (url.pathname === '/api/comments/media/' && request.method === 'POST'))) {
    if (!['GET','POST'].includes(request.method)) return json({ error:'method_not_allowed' },405,{Allow:'GET, POST'});
    const settings = commentSettings(env);
    if (!settings) return json({ error: 'comments_unavailable' }, 503);
    if (request.method === 'POST') {
      if (!sameOriginPost(request,env)) return json({error:'cross_origin_request'},403);
      const session = await commentSession(request,env);
      if (!session) return json({error:'login_required'},401);
      if (request.headers.get('x-comments-csrf') !== session.csrf) return json({error:'invalid_csrf'},403);
    }
    let thread;
    if (request.method === 'POST' && url.pathname === '/api/comments') {
      const bytes = await readApiBody(request.clone());
      if (bytes?.error) return json({ error: bytes.error }, bytes.status);
      try { thread = JSON.parse(new TextDecoder().decode(bytes))?.thread?.trim(); }
      catch { return json({ error: 'invalid_json' }, 400); }
    } else thread = request.method === 'GET' ? url.searchParams.get('thread') : request.headers.get('x-comments-thread');
    if (!validThread(thread)) return json({ error: 'invalid_thread' }, 400);
    if (!env.REPORELAY_THREADS) return json({ error: 'comments_coordinator_unavailable' }, 503);
    const id = env.REPORELAY_THREADS.idFromName(settings.repository + ':' + settings.namespace + ':' + thread);
    return env.REPORELAY_THREADS.get(id).fetch(request);
  }
  if (url.pathname.startsWith('/api/comments/media/')) return handleCommentMedia(request, env);
  if (url.pathname === '/api/comments') return handleComments(request, env);
  return handleCommentAuth(request, env);
}
