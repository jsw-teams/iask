// Shared by the frame and service so automatic namespaces never depend on titles.
export function websiteOrigin(value) {
  try {
    const url=new URL(value),host=url.hostname;
    if(url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash ||
      !host.includes('.') || !/^[a-z0-9.-]+$/.test(host) || /^\d+(?:\.\d+)*$/.test(host) ||
      host.endsWith('.') || /(?:^|\.)(?:localhost|local|internal|home|lan)$/.test(host))return null;
    return url.origin;
  }catch{return null;}
}
export async function automaticPrefix(origin) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(origin));
  return 'site-'+Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('')+':';
}
export async function embeddingWebsite(websites,value) {
  const origin=websiteOrigin(value);
  if(!origin)return null;
  const existing=websites.find(site=>site.origin===origin);
  if(existing)return existing;
  const prefix=await automaticPrefix(origin);
  if(websites.some(site=>site.prefix===prefix))return null;
  return {origin,prefix,dynamic:true};
}
