function exactOrigin(value) {
  const url=new URL(value);
  if(url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash)throw new Error('Invalid website origin');
  return url.origin;
}
export function configuredWebsites(env) {
  const primary=exactOrigin(env.COMMENTNEST_WEBSITE_ORIGIN || env.REPORELAY_WEBSITE_ORIGIN || env.REPORELAY_SITE_ORIGIN);
  const additional=JSON.parse(env.COMMENTNEST_ADDITIONAL_WEBSITES || env.REPORELAY_ADDITIONAL_WEBSITES || '[]');
  if(!Array.isArray(additional) || additional.length>7)throw new Error('Invalid additional websites');
  const origins=new Set([primary]),prefixes=new Set();
  return [{origin:primary,prefix:''},...additional.map(site=>{
    const origin=exactOrigin(site.origin);
    if(!/^[a-z][a-z0-9-]{0,39}:$/.test(site.prefix || '') || site.prefix==='page:' || origins.has(origin) || prefixes.has(site.prefix))throw new Error('Website origins and prefixes must be unique');
    origins.add(origin);prefixes.add(site.prefix);
    return {origin,prefix:site.prefix};
  })];
}
