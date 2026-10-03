import {transportRequest} from './transport.js';
import {handleCommentRequest} from './comments.js';
import {commentEnvironment} from './environment.js';
import {signingEnvironment} from './keys.js';
import {commentSession,sessionToken} from './auth.js';
import {canonicalLocale,direction} from '../static/commentnest/i18n.js';
import {configuredWebsites} from './websites.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = value => JSON.stringify(value).replace(/</g,'\\u003c');
function origin(value) {
  try {const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password && url.pathname==='/' && !url.search && !url.hash ? url.origin : null;}catch{return null;}
}
export async function handleServiceRequest(request, suppliedEnv) {
  const fixedApi=new URL(request.url).pathname==='/api';
  const action=request.headers.get('X-Service-Action');
  request=transportRequest(request);
  if(request instanceof Response)return request;
  const env=commentEnvironment(suppliedEnv), url=new URL(request.url);
  if(url.pathname.startsWith('/api/comments')) {
    const response=await handleCommentRequest(request,env);
    if(fixedApi && action==='login' && response.status===303) {
      const headers=new Headers(response.headers);headers.delete('Location');headers.set('Content-Type','application/json');
      return new Response(JSON.stringify({url:response.headers.get('Location')}),{headers});
    }
    if(fixedApi){const headers=new Headers(response.headers);headers.set('Vary','X-Service-Action, X-Service-Resource');return new Response(response.body,{status:response.status,headers});}
    return response;
  }
  if(!url.pathname.startsWith('/commentnest/') && !['/frame','/auth'].includes(url.pathname))return null;
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  const websites=configuredWebsites(env),website=websites[0].origin;
  const service=origin(env.REPORELAY_SITE_ORIGIN);
  if(!website || service!==url.origin)return new Response('Comment service is not configured',{status:503});
  const nonce=crypto.randomUUID().replaceAll('-','');
  if(url.pathname==='/auth') {
    if(url.search)return new Response('Invalid authentication context',{status:400});
    const script=`let started=false;window.addEventListener('message',async event=>{const data=event.data;if(started||event.source!==opener||event.origin!==location.origin||data?.type!=='commentnest:login-start'||!/^[a-f0-9]{32}$/.test(data.channel||''))return;started=true;const status=document.getElementById('status');status.textContent=String(data.loading||'').slice(0,500);try{const response=await fetch('/api',{headers:{'X-Service-Action':'login','X-Service-Channel':data.channel},credentials:'same-origin',cache:'no-store',redirect:'error'});if(!response.ok)throw new Error();const result=await response.json(),target=new URL(result.url);if(target.origin!=='https://github.com'||target.pathname!=='/login/oauth/authorize')throw new Error();location.replace(target.href);}catch{status.textContent=String(data.error||'').slice(0,500);}});if(opener)opener.postMessage({type:'commentnest:login-ready'},location.origin);`;
    return html('<!doctype html><meta charset="utf-8"><title>iask</title><main id="status" role="status"></main><script nonce="'+nonce+'">'+script+'</script>',"default-src 'none'; script-src 'nonce-"+nonce+"'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",request);
  }
  if(url.pathname==='/commentnest/auth-complete') {
    const channel=url.searchParams.get('channel');
    if(!/^[a-f0-9]{32}$/.test(channel || ''))return new Response('Invalid login channel',{status:400});
    const signedEnv=await signingEnvironment(env);
    const session=await commentSession(request,signedEnv);
    const token=session ? sessionToken(request) : null;
    const script=`if(window.opener){window.addEventListener('message',event=>{if(event.source===opener&&event.origin===location.origin&&event.data?.type==='commentnest:login-ack'&&event.data.channel===${json(channel)})window.close();});window.opener.postMessage(${json({type:'commentnest:login',channel,token})},location.origin);}`;
    return html('<!doctype html><meta charset="utf-8"><title>iask</title><p>You can close this window.</p><script nonce="'+nonce+'">'+script+'</script>',"default-src 'none'; script-src 'nonce-"+nonce+"'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",request);
  }
  if(url.pathname==='/commentnest/embed' || url.pathname==='/frame') {
    if(url.pathname==='/frame' && url.search)return new Response('Invalid widget context',{status:400});
    const parent=origin(url.searchParams.get('parent'));
    const channel=url.searchParams.get('channel');
    const thread=url.searchParams.get('thread');
    const embedding=websites.find(site=>site.origin===parent);
    if(url.pathname!=='/frame' && (!embedding || !/^[a-f0-9]{32}$/.test(channel || '') || !thread || thread.length>240 || /[\x00-\x1f\x7f]/.test(thread)))
      return new Response('Invalid widget context',{status:400});
    const locale=canonicalLocale(url.searchParams.get('locale'));
    const theme=['light','dark'].includes(url.searchParams.get('theme'))?url.searchParams.get('theme'):'auto';
    const context=url.pathname==='/frame'?{parent:website,websites,maxAttachmentBytes:env.REPORELAY_MAX_ATTACHMENT_BYTES || 5_000_000}:{thread:(embedding?.prefix || '')+thread,title:(url.searchParams.get('title') || '').slice(0,500),parent,channel,locale,theme,maxAttachmentBytes:env.REPORELAY_MAX_ATTACHMENT_BYTES || 5_000_000};
    let manifest={};
    try {const response=await (env.COMMENTNEST_ASSETS||env.ASSETS)?.fetch(new Request(new URL('/commentnest/manifest.json',url)));if(response?.ok)manifest=await response.json();}catch{}
    context.localeFiles=manifest.localeFiles || {};
    const asset=name=>/^[a-z]+\.[a-f0-9]{16}\.(js|css)$/.test(manifest[name]||'')?manifest[name]:name;
    const name=new Intl.Locale(locale).language==='zh'?'我提问':'iask';
    const body='<!doctype html><html lang="'+escape(locale)+'" dir="'+direction(locale)+'" data-theme="'+theme+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+name+'</title><link rel="stylesheet" href="/commentnest/'+asset('widget.css')+'"></head><body><main id="commentnest"></main><script nonce="'+nonce+'" type="application/json" id="commentnest-context">'+json(context)+'</script><script type="module" src="/commentnest/'+asset('embed.js')+'"></script></body></html>';
    return html(body,"default-src 'none'; script-src 'self' 'nonce-"+nonce+"'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors "+websites.map(site=>site.origin).join(' ')+"; base-uri 'none'; form-action 'self'",request);
  }
  const assets=env.COMMENTNEST_ASSETS || env.ASSETS;
  if(!assets)return new Response('Not found',{status:404});
  const response=await assets.fetch(request);
  const headers=new Headers(response.headers);
  headers.set('X-Content-Type-Options','nosniff');
  const requesting=request.headers.get('Origin');
  headers.set('Access-Control-Allow-Origin',websites.some(site=>site.origin===requesting)?requesting:website);
  headers.set('Vary','Origin');
  headers.set('Cross-Origin-Resource-Policy','cross-origin');
  if(response.ok)headers.set('Cache-Control',/\.[a-f0-9]{16}\.(js|css|json|png|jpe?g|gif|webp|avif)$/.test(url.pathname)?'public, max-age=31536000, immutable':url.pathname.endsWith('/widget.js')?'public, max-age=60, must-revalidate':'public, max-age=300, must-revalidate');
  return new Response(response.body,{status:response.status,headers});
}
function html(body,csp,request) {
  return new Response(request.method==='HEAD'?null:body,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':csp,'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
}
