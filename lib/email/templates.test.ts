import { describe, expect, it } from "vitest"

import { emailChangeEmail, passwordResetEmail, sessionVerificationEmail, verificationEmail } from "@/lib/email/templates"

const BANNED_EMAIL_CSS = ["@keyframes", "animation", "backdrop-filter", "position:absolute", "linear-gradient", "rgba("]

function expectEmailSafe(html: string) {
  expect(html).toContain("<!DOCTYPE html>")
  expect(html).toContain('role="presentation"')
  expect(html).toContain('bgcolor="#f4f4f5"')
  expect(html).toContain('name="color-scheme"')
  expect(html).toContain("prefers-color-scheme: dark")
  for (const banned of BANNED_EMAIL_CSS) {
    expect(html).not.toContain(banned)
  }
}

describe("transactional email templates", () => {
  it("builds a compatible verification email", () => {
    const verifyUrl = "https://atai.ink/verify-email?token=abc123"
    const email = verificationEmail("Ada", verifyUrl)

    expect(email.subject).toBe("Confirm your Atai account")
    expectEmailSafe(email.html)
    expect(email.html).toContain(verifyUrl)
    expect(email.text).toContain(verifyUrl)
    expect(email.text).toContain("confirm your email")
  })

  it("builds a compatible password reset email", () => {
    const resetUrl = "https://atai.ink/reset-password?token=reset123"
    const email = passwordResetEmail("Ada", resetUrl)

    expect(email.subject).toBe("Reset your Atai password")
    expectEmailSafe(email.html)
    expect(email.html).toContain(resetUrl)
    expect(email.text).toContain(resetUrl)
  })

  it("builds a compatible email change email", () => {
    const confirmUrl = "https://atai.ink/confirm-email-change?token=change123"
    const email = emailChangeEmail("Ada", "ada@example.com", confirmUrl)

    expect(email.subject).toBe("Confirm your new email address")
    expectEmailSafe(email.html)
    expect(email.html).toContain("ada@example.com")
    expect(email.html).toContain(confirmUrl)
    expect(email.text).toContain("ada@example.com")
  })

  it("builds a compatible session verification email", () => {
    const email = sessionVerificationEmail("Ada", "157074")

    expect(email.subject).toBe("Your Atai sign-in code")
    expectEmailSafe(email.html)
    expect(email.html).toContain("157074")
    expect(email.html).toContain("Oldest session signs out")
    expect(email.html).toContain("10 minutes")
    expect(email.text).toContain("157074")
  })

  it("escapes user-controlled names", () => {
    const email = verificationEmail('<img src=x onerror=alert(1)>', "https://atai.ink/verify-email?token=abc")

    expect(email.html).not.toContain("<img src=x")
    expect(email.html).toContain("&lt;img")
  })
})
