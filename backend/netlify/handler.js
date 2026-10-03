import {getConnectionString} from '@netlify/database';
import {createPersistentHandler} from '../persistent.js';

// Neon transaction pooling cannot preserve session advisory locks. Its documented
// direct endpoint uses the same hostname without the -pooler suffix.
export function directConnection(value) {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database protocol');
  if (url.hostname.endsWith('.neon.tech')) url.hostname = url.hostname.replace(/-pooler\./, '.');
  if (url.hostname.includes('pooler')) throw new Error('A direct database connection is required');
  return url.href;
}
export function createNetlifyHandler(variables, options = {}) {
  return createPersistentHandler(variables, {...options, initializeSchema:false,
    connectionString:() => directConnection((options.getConnectionString || getConnectionString)())});
}
