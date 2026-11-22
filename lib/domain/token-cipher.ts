/**
 * Encryption at rest for the verification challenge token.
 *
 * The token is the proof of ownership a founder pastes into their site, and it
 * has to survive a page reload, so a hash alone is not enough — but a database
 * dump should not hand anyone a working proof. Values are AES-256-GCM with a
 * per-record IV; the key is derived from `AUTH_SECRET` (or an explicit
 * `DOMAIN_TOKEN_KEY`), so no new required secret is introduced.
 *
 * Legacy plaintext values stay readable: anything without the `v1:` prefix is
 * returned as-is, which lets old rows keep working until they expire or are
 * regenerated.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"
import { getAuthSecret } from "@/lib/env"

const PREFIX = "v1:"
const SALT = "atai.domain-token"
const INFO = "domain-token-v1"

function key(): Buffer {
  const explicit = process.env.DOMAIN_TOKEN_KEY?.trim()
  if (explicit) {
    const bytes = /^[0-9a-f]{64}$/i.test(explicit) ? Buffer.from(explicit, "hex") : Buffer.from(explicit, "base64")
    if (bytes.length !== 32) throw new Error("DOMAIN_TOKEN_KEY must be 32 bytes (64 hex chars or base64).")
    return bytes
  }
  return Buffer.from(hkdfSync("sha256", getAuthSecret(), SALT, INFO, 32))
}

export function encryptDomainToken(token: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()])
  return `${PREFIX}${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`
}

/** Returns the plaintext token, tolerating legacy unencrypted values. */
export function decryptDomainToken(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored
  const [ivPart, tagPart, dataPart] = stored.slice(PREFIX.length).split(".")
  if (!ivPart || !tagPart || !dataPart) throw new Error("Stored domain token is malformed.")
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivPart, "base64url"))
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]).toString("utf8")
}

export function isEncryptedDomainToken(stored: string): boolean {
  return stored.startsWith(PREFIX)
}
