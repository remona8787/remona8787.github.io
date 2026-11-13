// The test accounts' TOTP (scripts/lib/totp.mjs) against the RFC 6238 SHA-1 test vectors (secret "12345678901234567890").
import test from 'node:test'
import assert from 'node:assert/strict'
import { totp } from '../scripts/lib/totp.mjs'
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
test('RFC 6238 SHA-1 vectors (last 6 digits)', () => {
  for (const [t, code] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037']]) assert.equal(totp(SECRET, t * 1000), code, String(t))
})
