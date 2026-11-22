import { describe, expect, it } from "vitest"
import { decryptDomainToken, encryptDomainToken, isEncryptedDomainToken } from "./token-cipher"

describe("domain token encryption", () => {
  it("round-trips a token without leaving it readable", () => {
    const token = "Q2hhbGxlbmdlVG9rZW5XaXRoNDNCeXRlc09mRW50cm9weQ"

    const sealed = encryptDomainToken(token)

    expect(sealed.startsWith("v1:")).toBe(true)
    expect(sealed).not.toContain(token)
    expect(isEncryptedDomainToken(sealed)).toBe(true)
    expect(decryptDomainToken(sealed)).toBe(token)
  })

  it("uses a fresh IV, so the same token never produces the same ciphertext", () => {
    const token = "same-token"

    expect(encryptDomainToken(token)).not.toBe(encryptDomainToken(token))
  })

  it("rejects a tampered ciphertext instead of returning garbage", () => {
    const sealed = encryptDomainToken("token")
    const parts = sealed.slice(3).split(".")
    const flipped = Buffer.from(parts[2], "base64url")
    flipped[0] ^= 0xff
    const tampered = `v1:${parts[0]}.${parts[1]}.${flipped.toString("base64url")}`

    expect(() => decryptDomainToken(tampered)).toThrow()
  })

  it("still reads legacy plaintext rows", () => {
    expect(decryptDomainToken("plain-legacy-token")).toBe("plain-legacy-token")
    expect(isEncryptedDomainToken("plain-legacy-token")).toBe(false)
  })
})
