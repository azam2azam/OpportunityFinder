import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto'
import { promisify } from 'util'

/**
 * Password hashing, deliberately separate from auth.ts.
 *
 * auth.ts is marked `server-only`, which makes it unimportable from scripts run
 * outside Next (the seed generator, verification scripts). Hashing itself has no
 * request context, so it lives here and auth.ts re-exports it.
 *
 * scrypt rather than bcrypt: it ships with Node, so installing needs no native
 * toolchain.
 */
const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>

const KEY_LENGTH = 64

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, KEY_LENGTH)
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false
  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), KEY_LENGTH)
  const expected = Buffer.from(hashHex, 'hex')
  // timingSafeEqual throws on a length mismatch, so check first.
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}
