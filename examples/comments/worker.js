import { handleCommentRequest } from '../../src/index.js';
export { CommentCoordinator } from '../../src/index.js';
export default {async fetch(request,env) {return await handleCommentRequest(request,env) || env.ASSETS.fetch(request);}};
