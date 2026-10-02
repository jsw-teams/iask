import { handleCommentRequest } from './index.js';
export { CommentCoordinator } from './index.js';
export default { async fetch(request, env) {
  return await handleCommentRequest(request, env) || env.ASSETS.fetch(request);
}};
