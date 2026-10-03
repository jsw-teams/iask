import {handleServiceRequest} from './index.js';
export async function fetchService(request, env) {
  try {
    const response=await handleServiceRequest(request,env);
    if (response) return response;
    return new Response(new URL(request.url).pathname==='/' ? 'iask' : 'Not found', {status:new URL(request.url).pathname==='/'?200:404,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
  } catch {
    return Response.json({error:'comments_backend_unavailable'},{status:503,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
}
