import { handleServiceRequest } from './index.js';
export { CommentCoordinator } from './index.js';
export default { async fetch(request, env) {
  return await handleServiceRequest(request, env) || new Response('CommentNest · 评巢',{headers:{'Content-Type':'text/plain; charset=utf-8'}});
}};
