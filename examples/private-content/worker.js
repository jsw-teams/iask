import { createRepositoryClient } from '../../src/index.js';

// Application authorization and the file allowlist belong to the host application.
export default { async fetch(request, env) {
  const headers = {'Cache-Control':'no-store'};
  if (request.method !== 'GET' || new URL(request.url).pathname !== '/release-notes')
    return new Response(null,{status:404,headers});
  if (!env.PRIVATE_CONTENT_TOKEN || request.headers.get('authorization') !== 'Bearer ' + env.PRIVATE_CONTENT_TOKEN)
    return new Response(null,{status:401,headers});
  try {
    const file = await createRepositoryClient({...env, REPORELAY_GITHUB_PERMISSIONS: {contents:'read',metadata:'read'}})
      .readFile('published/release-notes.md','main');
    if (file.type !== 'file' || file.encoding !== 'base64') throw new Error('Unexpected GitHub content');
    const bytes = Uint8Array.from(atob(file.content.replace(/\s/g,'')), char => char.charCodeAt(0));
    return new Response(bytes,{headers:{...headers,'Content-Type':'text/plain; charset=utf-8','X-Content-Type-Options':'nosniff'}});
  } catch { return new Response(null,{status:502,headers}); }
}};
