import {readFile, realpath} from 'node:fs/promises';
import {resolve, relative, isAbsolute, extname} from 'node:path';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.avif':'image/avif','.txt':'text/plain; charset=utf-8'};
export function fileAssets(directory) {
  return {async fetch(request) {
    try {
      const path = decodeURIComponent(new URL(request.url).pathname);
      if (path!=='/404.html' && !path.startsWith('/commentnest/') || path.includes('\\') || path.includes('\0')) return new Response('Not found',{status:404});
      const root = await realpath(directory), target = await realpath(resolve(root, '.' + path));
      const rel = relative(root,target);
      if (rel.startsWith('..') || isAbsolute(rel)) return new Response('Not found',{status:404});
      const bytes = await readFile(target);
      return new Response(request.method === 'HEAD' ? null : bytes, {headers:{'Content-Type':types[extname(target)] || 'application/octet-stream'}});
    } catch {return new Response('Not found',{status:404});}
  }};
}
