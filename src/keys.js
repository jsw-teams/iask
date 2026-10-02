import { dataScope } from './scope.js';

export async function signingEnvironment(env) {
  if (typeof env.REPORELAY_SESSION_SECRET === 'string' && env.REPORELAY_SESSION_SECRET.length >= 32 &&
      typeof env.REPORELAY_IDENTITY_SECRET === 'string' && env.REPORELAY_IDENTITY_SECRET.length >= 32) return env;
  if (!env.REPORELAY_THREADS || !env.REPORELAY_SITE_ORIGIN || !env.REPORELAY_REPOSITORY) return env;
  const scope = await dataScope(env);
  const object = env.REPORELAY_THREADS.get(env.REPORELAY_THREADS.idFromName('signing:' + scope));
  // Binding-only capability. Public comment routing never forwards this path.
  const response = await object.fetch(new Request('https://reporelay.internal/__reporelay/keys'));
  if (!response.ok) throw new Error('Project signing keys unavailable');
  const secrets = await response.json();
  if (![secrets.session, secrets.identity].every(value => typeof value === 'string' && value.length >= 32)) throw new Error('Invalid stored signing keys');
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
