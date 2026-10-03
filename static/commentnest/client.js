export function serviceFetch(action,{thread,resource,channel,...options}={}) {
  const headers=new Headers(options.headers);
  headers.set('X-Service-Action',action);
  for(const [name,value] of [['Thread',thread],['Resource',resource],['Channel',channel]])if(value!==undefined)headers.set('X-Service-'+name,encodeURIComponent(value));
  return fetch('/api',{credentials:'same-origin',cache:'no-store',redirect:'error',...options,headers});
}
const objectUrls=new Set();
const avatars=new Map();
export function imageResource(resource,action='media') {
  if(action!=='avatar')return loadImage(resource,action);
  if(avatars.has(resource))return avatars.get(resource);
  if(avatars.size>=128)avatars.delete(avatars.keys().next().value);
  const pending=loadImage(resource,action).catch(error=>{avatars.delete(resource);throw error;});
  avatars.set(resource,pending);return pending;
}
async function loadImage(resource,action) {
  const response=await serviceFetch(action,{resource});
  if(!response.ok || !/^image\/(png|jpeg|gif|webp|avif)(?:;|$)/.test(response.headers.get('Content-Type') || ''))throw new Error('image_unavailable');
  const url=URL.createObjectURL(await response.blob());objectUrls.add(url);return url;
}
window.addEventListener('pagehide',()=>{for(const url of objectUrls)URL.revokeObjectURL(url);objectUrls.clear();avatars.clear();},{once:true});
