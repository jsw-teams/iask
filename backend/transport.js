import {websiteOrigin} from '../static/commentnest/website.js';
const paths={comments:'/api/comments',session:'/api/comments/session',logout:'/api/comments/logout',login:'/api/comments/login',upload:'/api/comments/media/'};
const failure=(error,status=400)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});
export function headerValue(request,name,limit=240) {
  const value=request.headers.get(name);
  if(value===null)return '';
  if(value.length>limit*12)throw new Error('invalid_service_header');
  const decoded=decodeURIComponent(value);
  if(decoded.length>limit || /[\x00-\x1f\x7f]/.test(decoded))throw new Error('invalid_service_header');
  return decoded;
}
export function transportRequest(request) {
  const url=new URL(request.url);
  if(url.pathname!=='/api')return request;
  if(url.search)return failure('unexpected_query');
  const action=request.headers.get('X-Service-Action');
  let path=paths[action];
  try {
    const website=headerValue(request,'X-Service-Website',300);
    if(website && !websiteOrigin(website))return failure('invalid_website');
    if(action==='avatar') {
      const id=headerValue(request,'X-Service-Resource',16);
      if(!/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id)))return failure('invalid_avatar');
      path='/api/comments/avatar/'+id;
    }
    if(action==='media') {
      const file=headerValue(request,'X-Service-Resource',180);
      if(!/^[a-f0-9]{24}\/[a-f0-9]{24}\/[0-9a-f-]{36}\.(png|jpg|gif|webp|avif)$/.test(file))return failure('invalid_media');
      path='/api/comments/media/'+file;
    }
    if(!path)return failure('not_found',404);
    const methods={comments:['GET','POST','DELETE'],session:['GET'],logout:['POST'],login:['GET'],upload:['POST'],avatar:['GET','HEAD'],media:['GET','HEAD']};
    if(!methods[action].includes(request.method))return failure('method_not_allowed',405);
    const headers=new Headers(request.headers);
    // Internal adapters share the existing authorization and signed-storage contracts.
    headers.delete('X-Comments-Thread');
    if(action==='comments' || action==='upload') {
      const thread=headerValue(request,'X-Service-Thread');
      if(!thread || /[?#\\]/.test(thread) || thread.startsWith('/') || thread.split('/').some(part=>!part || part==='.' || part==='..'))return failure('invalid_thread');
      headers.set('X-Comments-Thread',encodeURIComponent(thread));
      headers.set('X-Comments-Thread-Encoding','uri');
    }
    url.pathname=path;
    if(action==='login') {
      const channel=headerValue(request,'X-Service-Channel',32);
      if(!/^[a-f0-9]{32}$/.test(channel))return failure('invalid_login_channel');
      url.searchParams.set('return','/commentnest/auth-complete?channel='+channel);
    }
    return new Request(url,new Request(request,{headers}));
  }catch{return failure('invalid_service_header');}
}
export function requestThread(request) {
  const value=request.headers.get('X-Comments-Thread');
  if(value===null)return null;
  try{return request.headers.get('X-Comments-Thread-Encoding')==='uri'?decodeURIComponent(value):value;}catch{return '';}
}
