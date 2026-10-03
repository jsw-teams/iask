// Deployment names may evolve; persisted signatures and storage scopes must not.
export function commentEnvironment(env) {
  const result = {...env};
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith('COMMENTNEST_')) result['REPORELAY_' + name.slice(12)] = value;
  }
  return result;
}
