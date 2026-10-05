import {notFoundPage,notFoundStyles} from '../static/not-found-page.js';

let fallbackStyleHash;
function styleHash() {
  return fallbackStyleHash ||= crypto.subtle.digest('SHA-256',new TextEncoder().encode(notFoundStyles))
    .then(hash=>btoa(String.fromCharCode(...new Uint8Array(hash))));
}

export async function notFound(request,env) {
  let page;
  try {
    const assets=env.COMMENTNEST_ASSETS || env.ASSETS;
    if(assets)page=await assets.fetch(new Request(new URL('/404.html',request.url)));
  }catch{}
  const hasPage=page?.headers.get('Content-Type')?.includes('text/html');
  const body=hasPage?page.body:notFoundPage();
  const stylePolicy=hasPage?"'self'":"'self' 'sha256-"+await styleHash()+"'";
  return new Response(request.method==='HEAD'?null:body,{status:404,headers:{
    'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'none'; style-src "+stylePolicy+"; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  }});
}
