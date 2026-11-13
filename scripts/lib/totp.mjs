// RFC 6238 TOTP (SHA-1, 6 digits, 30-second steps) for test accounts' second factor (scripts/platform-e2e.mjs,
// qa/real-backend.spec.mjs). Test accounts only: an operator's own factor lives in their authenticator app.
import { createHmac } from 'node:crypto'

function base32(s) {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of String(s).replace(/=+$/, '').toUpperCase()) { const i = a.indexOf(c); if (i < 0) throw Error('not base32'); bits += i.toString(2).padStart(5, '0') }
  const out = []
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(out)
}
export function totp(secret, t = Date.now()) {
  if (!/^[A-Z2-7]{16,}=*$/i.test(String(secret || '').trim())) throw Error('totp: not a base32 secret')
  const c = Buffer.alloc(8)
  c.writeBigUInt64BE(BigInt(Math.floor(t / 30000)))
  const h = createHmac('sha1', base32(secret)).update(c).digest()
  const o = h[h.length - 1] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0')
}
