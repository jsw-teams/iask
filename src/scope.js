// Stable project isolation, independent of release numbering or operator-supplied labels.
export async function dataScope(env) {
  const origin = new URL(env.REPORELAY_SITE_ORIGIN).origin;
  const repository = String(env.REPORELAY_REPOSITORY).trim().toLowerCase();
  const bytes = new TextEncoder().encode(JSON.stringify([origin, repository]));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest.slice(0, 12), byte => byte.toString(16).padStart(2, '0')).join('');
}
