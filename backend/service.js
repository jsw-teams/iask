import {handleCommentRequest} from './comments.js';
import {commentEnvironment} from './environment.js';
import {signingEnvironment} from './keys.js';
import {commentSession,sessionToken} from './auth.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = value => JSON.stringify(value).replace(/</g,'\\u003c');
function origin(value) {
  try {const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password && url.pathname==='/' && !url.search && !url.hash ? url.origin : null;}catch{return null;}
}
export async function handleServiceRequest(request, suppliedEnv) {
  const env=commentEnvironment(suppliedEnv), url=new URL(request.url);
  if(url.pathname.startsWith('/api/comments')) return handleCommentRequest(request,env);
  if(!url.pathname.startsWith('/commentnest/'))return null;
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  const website=origin(env.COMMENTNEST_WEBSITE_ORIGIN || env.REPORELAY_SITE_ORIGIN);
  const service=origin(env.REPORELAY_SITE_ORIGIN);
  if(!website || service!==url.origin)return new Response('Comment service is not configured',{status:503});
  const nonce=crypto.randomUUID().replaceAll('-','');
  if(url.pathname==='/commentnest/auth-complete') {
    const channel=url.searchParams.get('channel');
    if(!/^[a-f0-9]{32}$/.test(channel || ''))return new Response('Invalid login channel',{status:400});
    const signedEnv=await signingEnvironment(env);
    const session=await commentSession(request,signedEnv);
    const token=session ? sessionToken(request) : null;
    const script=`if(window.opener){window.opener.postMessage(${json({type:'commentnest:login',channel,token})},location.origin);window.close();}`;
    return html('<!doctype html><meta charset="utf-8"><title>CommentNest</title><p>You can close this window.</p><script nonce="'+nonce+'">'+script+'</script>',"default-src 'none'; script-src 'nonce-"+nonce+"'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",request);
  }
  if(url.pathname==='/commentnest/embed') {
    const parent=origin(url.searchParams.get('parent'));
    const channel=url.searchParams.get('channel');
    const thread=url.searchParams.get('thread');
    if(parent!==website || !/^[a-f0-9]{32}$/.test(channel || '') || !thread || thread.length>240 || /[\x00-\x1f\x7f]/.test(thread))
      return new Response('Invalid widget context',{status:400});
    const language=url.searchParams.get('locale') || 'en';
    const locale=/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})?$/.test(language)?language:'en';
    const theme=['light','dark'].includes(url.searchParams.get('theme'))?url.searchParams.get('theme'):'auto';
    const context={thread,title:(url.searchParams.get('title') || '').slice(0,500),parent,channel,locale,theme};
    let manifest={};
    try {const response=await (env.COMMENTNEST_ASSETS||env.ASSETS)?.fetch(new Request(new URL('/commentnest/manifest.json',url)));if(response?.ok)manifest=await response.json();}catch{}
    const asset=name=>/^[a-z]+\.[a-f0-9]{16}\.(js|css)$/.test(manifest[name]||'')?manifest[name]:name;
    const body='<!doctype html><html lang="'+escape(locale)+'" data-theme="'+theme+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CommentNest · 评巢</title><link rel="stylesheet" href="/commentnest/'+asset('widget.css')+'"></head><body><main id="commentnest"><p role="status">Loading…</p></main><script nonce="'+nonce+'" type="application/json" id="commentnest-context">'+json(context)+'</script><script type="module" src="/commentnest/'+asset('embed.js')+'"></script></body></html>';
    return html(body,"default-src 'none'; script-src 'self' 'nonce-"+nonce+"'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors "+website+"; base-uri 'none'; form-action 'self'",request);
  }
  const assets=env.COMMENTNEST_ASSETS || env.ASSETS;
  if(!assets)return new Response('Not found',{status:404});
  const response=await assets.fetch(request);
  const headers=new Headers(response.headers);
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('Access-Control-Allow-Origin',website);
  headers.set('Vary','Origin');
  headers.set('Cross-Origin-Resource-Policy','cross-origin');
  if(response.ok)headers.set('Cache-Control',/\.[a-f0-9]{16}\.(js|css|json|png|jpe?g|gif|webp|avif)$/.test(url.pathname)?'public, max-age=31536000, immutable':url.pathname.endsWith('/widget.js')?'public, max-age=60, must-revalidate':'public, max-age=300, must-revalidate');
  return new Response(response.body,{status:response.status,headers});
}
function html(body,csp,request) {
  return new Response(request.method==='HEAD'?null:body,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':csp,'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
}
