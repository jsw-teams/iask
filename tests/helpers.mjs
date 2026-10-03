import { handleCommentRequest } from '../backend/index.js';

const pair = await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5', modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]), hash:'SHA-256'}, true, ['sign','verify']);
export const appDefaults = {
  REPORELAY_GITHUB_APP_ID: '60001',
  REPORELAY_GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\n' +
    Buffer.from(await crypto.subtle.exportKey('pkcs8',pair.privateKey)).toString('base64') + '\n-----END PRIVATE KEY-----'
};
export const mockInstallation = () => Response.json({token:'installation-token',
  expires_at:new Date(Date.now()+3600000).toISOString()});
export const worker = {fetch: (request, env) => handleCommentRequest(request,env,{coordinated:true})};

export const mockRepositoryInstallation = (url, init) => {
  const appId = JSON.parse(Buffer.from(init.headers.Authorization.split('.')[1], 'base64url')).iss;
  return Response.json({id:appId==='123456'?654321:70001,app_id:Number(appId),app_slug:'comment-bot',suspended_at:null});
};
