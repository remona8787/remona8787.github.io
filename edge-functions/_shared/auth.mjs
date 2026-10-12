// A missing secret must never authorize a privileged operation.
export function authorizedSecret(pairs) {
  return pairs.some(([expected, supplied]) => typeof expected === 'string' && expected.length > 0 && typeof supplied === 'string' && supplied === expected);
}
