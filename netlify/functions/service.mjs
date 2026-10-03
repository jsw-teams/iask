import {createNetlifyHandler} from '../../backend/netlify/handler.js';
export default createNetlifyHandler(process.env);
export const config = {
  path: ['/api', '/frame', '/auth', '/api/comments', '/api/comments/session',
    '/api/comments/login', '/api/comments/logout', '/api/comments/callback',
    '/api/comments/media/', '/api/comments/media/:scope/:thread/:file',
    '/api/comments/avatar/:id', '/commentnest/embed', '/commentnest/auth-complete']
};
