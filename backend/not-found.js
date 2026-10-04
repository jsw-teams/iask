export async function notFound(request,env) {
  let page;
  try {
    const assets=env.COMMENTNEST_ASSETS || env.ASSETS;
    if(assets)page=await assets.fetch(new Request(new URL('/404.html',request.url)));
  }catch{}
  const body=page?.headers.get('Content-Type')?.includes('text/html')?page.body:'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="robots" content="noindex"><title>404 | 我提问</title><main><h1>访问路径不对</h1><p>这里没有你想找的东西，请检查链接或回到原文章。</p></main></html>';
  return new Response(request.method==='HEAD'?null:body,{status:404,headers:{
    'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'none'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  }});
}
