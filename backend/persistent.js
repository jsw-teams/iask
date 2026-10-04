import {resolve} from 'node:path';
import {createPostgresNamespace} from './postgres.js';
import {fileAssets} from './assets.js';
import {fetchService} from './handler.js';
import {fetchPublicManifest} from './public-website-node.js';
export function createPersistentHandler(variables, options = {}) {
  let environment;
  function configured() {
    if (environment) return environment;
    const namespace = options.namespace || createPostgresNamespace(options.connectionString?.() || variables.COMMENTNEST_DATABASE_URL, {initializeSchema: options.initializeSchema !== false});
    environment = {...variables, COMMENTNEST_MAX_ATTACHMENT_BYTES:4_000_000, COMMENTNEST_FETCH_WEBSITE:fetchPublicManifest, COMMENTNEST_THREADS:namespace, COMMENTNEST_ASSETS:options.assets || fileAssets(resolve(process.cwd(),'dist'))};
    namespace.bindEnvironment(environment);
    return environment;
  }
  return async request => {
    try {return await fetchService(request,configured());}
    catch {return Response.json({error:'comments_backend_unavailable'},{status:503,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
  };
}
