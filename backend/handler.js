import {handleServiceRequest} from './index.js';
import {notFound} from './not-found.js';
const endpoints=new Set(['/api','/frame','/auth','/api/comments','/api/comments/session','/api/comments/login','/api/comments/logout','/api/comments/callback','/api/comments/media/','/commentnest/embed','/commentnest/auth-complete']);
const resource=/^\/api\/comments\/(?:avatar\/[1-9]\d{0,15}|media\/[a-f0-9]{24}\/[a-f0-9]{24}\/[0-9a-f-]{36}\.(?:png|jpg|gif|webp|avif))$/;
const asset=/^\/commentnest\/[A-Za-z0-9_./-]+\.(?:js|css|json|png|jpg|gif|webp|avif)$/;
export async function fetchService(request, env) {
  const path=new URL(request.url).pathname;
  // Reject probes before initializing signing keys, storage or GitHub access.
  if(!endpoints.has(path) && !resource.test(path) && !asset.test(path))return notFound(request,env);
  try {
    const response=await handleServiceRequest(request,env);
    if (response && response.status!==404) return response;
    if(response?.headers.get('Content-Type')?.includes('application/json'))return response;
    return notFound(request,env);
  } catch {
    return Response.json({error:'comments_backend_unavailable'},{status:503,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
}
