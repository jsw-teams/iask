import {createHash} from 'node:crypto';
import pg from 'pg';
const schema = `CREATE TABLE IF NOT EXISTS commentnest_state (
  namespace text NOT NULL, key text NOT NULL, value jsonb NOT NULL,
  PRIMARY KEY (namespace, key)
)`;
const lockId = name => createHash('sha256').update(name).digest().readBigInt64BE(0).toString();

// A session advisory lock spans the entire GitHub operation, but individual state writes
// commit immediately. The uncertain-creation marker survives a timeout or process exit.
// Database disconnects release the lock; no expiring lease can permit overlapping writes.
export function createPostgresNamespace(connectionString, {pool: suppliedPool, initializeSchema = true} = {}) {
  if (!suppliedPool && !connectionString) throw new Error('COMMENTNEST_DATABASE_URL is required');
  let connection;
  if (!suppliedPool) {
    const url = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database protocol');
    // Force verified TLS; do not allow a URL to disable certificate verification.
    for (const key of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
    connection = url.href;
  }
  const pool = suppliedPool || new pg.Pool({connectionString:connection, ssl:{rejectUnauthorized:true}, max:4, connectionTimeoutMillis:5000, idleTimeoutMillis:10000});
  pool.on?.('error', () => {});
  let initialized;
  let environment;
  const ready = () => initialized ||= (initializeSchema ? pool.query(schema) : Promise.resolve()).catch(error => {initialized = undefined; throw error;});
  return {
    idFromName: name => String(name),
    get(name) {
      return {async fetch(request) {
        await ready();
        const client = await pool.connect();
        let locked = false, broken = false;
        try {
          await client.query("SET statement_timeout = '5s'");
          await client.query('SELECT pg_advisory_lock($1::bigint)', [lockId(name)]);
          locked = true;
          const storage = {
            async get(key) {
              const result = await client.query('SELECT value FROM commentnest_state WHERE namespace=$1 AND key=$2', [name, key]);
              return result.rows[0]?.value;
            },
            async put(key, value) {
              await client.query('INSERT INTO commentnest_state(namespace,key,value) VALUES($1,$2,$3::jsonb) ON CONFLICT(namespace,key) DO UPDATE SET value=EXCLUDED.value', [name, key, JSON.stringify(value)]);
            },
            async delete(key) {
              await client.query('DELETE FROM commentnest_state WHERE namespace=$1 AND key=$2', [name, key]);
            },
            async transaction(callback) {
              await client.query('BEGIN');
              try {const result = await callback(storage); await client.query('COMMIT'); return result;}
              catch (error) {await client.query('ROLLBACK'); throw error;}
            }
          };
          // Dynamic import avoids coupling the shared API to Node.js or PostgreSQL.
          const {CommentCoordinator} = await import('./comments.js');
          return await new CommentCoordinator({storage}, thisEnvironment()).fetch(request);
        } catch (error) {
          broken = true;
          throw error;
        } finally {
          if (locked) {
            try {await client.query('SELECT pg_advisory_unlock($1::bigint)', [lockId(name)]);}
            catch {broken = true;}
          }
          client.release(broken);
        }
      }};
    },
    bindEnvironment(env) {environment = env;},
    close: () => pool.end()
  };
  function thisEnvironment() {return environment;}
}
