import {handleServiceRequest} from './index.js';
const endpoints=new Set(['/api','/frame','/auth','/api/comments','/api/comments/session','/api/comments/login','/api/comments/logout','/api/comments/callback','/api/comments/media/','/commentnest/embed','/commentnest/auth-complete']);
const resource=/^\/api\/comments\/(?:avatar\/[1-9]\d{0,15}|media\/[a-f0-9]{24}\/[a-f0-9]{24}\/[0-9a-f-]{36}\.(?:png|jpg|gif|webp|avif))$/;
const asset=/^\/commentnest\/[A-Za-z0-9_./-]+\.(?:js|css|json|png|jpg|gif|webp|avif)$/;
const notFound=()=>new Response('Not found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function fetchService(request, env) {
  const path=new URL(request.url).pathname;
  // Reject probes before initializing signing keys, storage or GitHub access.
  if(!endpoints.has(path) && !resource.test(path) && !asset.test(path))return notFound();
  try {
    const response=await handleServiceRequest(request,env);
    if (response) return response;
    return notFound();
  } catch {
    return Response.json({error:'comments_backend_unavailable'},{status:503,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
}
