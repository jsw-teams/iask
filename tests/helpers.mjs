import { handleCommentRequest } from '../src/index.js';

const pair = await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5', modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]), hash:'SHA-256'}, true, ['sign','verify']);
export const appDefaults = {
  REPORELAY_NAMESPACE: 'test-v2',
  REPORELAY_GITHUB_APP_ID: '60001',
  REPORELAY_GITHUB_APP_INSTALLATION_ID: '70001',
  REPORELAY_GITHUB_APP_BOT_LOGIN: 'comment-bot[bot]',
  REPORELAY_GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\n' +
    Buffer.from(await crypto.subtle.exportKey('pkcs8',pair.privateKey)).toString('base64') + '\n-----END PRIVATE KEY-----'
};
export const mockInstallation = () => Response.json({token:'installation-token',
  expires_at:new Date(Date.now()+3600000).toISOString()});
export const worker = {fetch: (request, env) => handleCommentRequest(request,env,{coordinated:true})};
