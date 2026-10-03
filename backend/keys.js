import { dataScope } from './scope.js';
const caches = new WeakMap();
const CACHE_MS = 300000;

export async function signingEnvironment(env) {
  if (typeof env.REPORELAY_SESSION_SECRET === 'string' && env.REPORELAY_SESSION_SECRET.length >= 32 &&
      typeof env.REPORELAY_IDENTITY_SECRET === 'string' && env.REPORELAY_IDENTITY_SECRET.length >= 32) return env;
  if (!env.REPORELAY_THREADS || !env.REPORELAY_SITE_ORIGIN || !env.REPORELAY_REPOSITORY) return env;
  const scope = await dataScope(env);
  let entries=caches.get(env.REPORELAY_THREADS);
  if(!entries){entries=new Map();caches.set(env.REPORELAY_THREADS,entries);}
  let entry=entries.get(scope);
  if(!entry || entry.expires<=Date.now()) {
    const pending=(async()=>{
      const object=env.REPORELAY_THREADS.get(env.REPORELAY_THREADS.idFromName('signing:'+scope));
      // Binding-only capability. Public comment routing never forwards this path.
      const response=await object.fetch(new Request('https://reporelay.internal/__reporelay/keys'));
      if(!response.ok)throw new Error('Project signing keys unavailable');
      const keys=await response.json();
      if(![keys.session,keys.identity].every(value=>typeof value==='string'&&value.length>=32))throw new Error('Invalid stored signing keys');
      return keys;
    })();
    entry={pending,expires:Date.now()+CACHE_MS};
    if(entries.size>=128)entries.delete(entries.keys().next().value);
    entries.set(scope,entry);
    pending.catch(()=>{if(entries.get(scope)===entry)entries.delete(scope);});
  }
  const secrets=await entry.pending;
  return {...env, REPORELAY_SESSION_SECRET: env.REPORELAY_SESSION_SECRET || secrets.session,
    REPORELAY_IDENTITY_SECRET: env.REPORELAY_IDENTITY_SECRET || secrets.identity};
}

export async function storedSigningKeys(storage) {
  return storage.transaction(async transaction => {
    let keys = await transaction.get('signing-keys');
    if (!keys) {
      const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2,'0')).join('');
      keys = {session:random(), identity:random()};
      await transaction.put('signing-keys', keys);
    }
    return keys;
  });
}
