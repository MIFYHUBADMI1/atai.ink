import {
  emailButton,
  emailCodeBlock,
  emailMetaTable,
  emailNote,
  emailParagraph,
  emailStrong,
  renderEmailShell,
} from "@/lib/email/layout"

export function verificationEmail(name: string, verifyUrl: string) {
  const bodyHtml = [
    emailParagraph(`Hey ${emailStrong(name)},`),
    emailParagraph("Welcome to Atai. Confirm your email to unlock your free credits and start planning the business you want to run."),
    emailButton(verifyUrl, "Verify email address"),
    emailNote("This link expires in <strong class=\"email-strong\" style=\"color:#18181b;\">24 hours</strong>. If you didn't create this account, you can ignore this email."),
    emailParagraph("<span class=\"email-faint\" style=\"font-size:12px;color:#71717a;\">Your next step: shape the offer, customers, and plan for a business of your own.</span>"),
  ].join("")

  return {
    subject: "Confirm your Atai account",
    html: renderEmailShell({
      title: "Confirm your email",
      preheader: "Confirm your Atai email to finish setting up your account.",
      eyebrow: "Account",
      heading: "Confirm your email",
      bodyHtml,
      footerNote: "This is a transactional email regarding your account.",
    }),
    text: `Hey ${name}, confirm your email: ${verifyUrl} (expires in 24 hours)`,
  }
}

export function passwordResetEmail(name: string, resetUrl: string) {
  const bodyHtml = [
    emailParagraph(`Hey ${emailStrong(name)},`),
    emailParagraph("No worries — it happens to the best of us. Click below to set a new password."),
    emailButton(resetUrl, "Reset password"),
    emailNote("This link expires in <strong class=\"email-strong\" style=\"color:#18181b;\">1 hour</strong>. If you didn't request this, you can safely ignore this email."),
    emailNote("<strong class=\"email-strong\" style=\"color:#18181b;\">Your data stays safe.</strong> Resetting your password won't affect your businesses, plans, credits, or published sites."),
  ].join("")

  return {
    subject: "Reset your Atai password",
    html: renderEmailShell({
      title: "Reset your password",
      preheader: "Reset your Atai password before this link expires.",
      eyebrow: "Security",
      heading: "Reset your password",
      bodyHtml,
      footerNote: "This is a transactional email regarding your account.",
    }),
    text: `Hey ${name}, reset your password: ${resetUrl} (expires in 1 hour)`,
  }
}

export function emailChangeEmail(name: string, newEmail: string, confirmUrl: string) {
  const bodyHtml = [
    emailParagraph(`Hey ${emailStrong(name)},`),
    emailParagraph("We received a request to update your email address."),
    emailCodeBlock(newEmail, "New email address"),
    emailButton(confirmUrl, "Confirm email change"),
    emailNote("This link expires in <strong class=\"email-strong\" style=\"color:#18181b;\">1 hour</strong>. If you didn't request this change, your current email stays the same."),
  ].join("")

  return {
    subject: "Confirm your new email address",
    html: renderEmailShell({
      title: "Confirm your new email",
      preheader: "Confirm the new email address for your Atai account.",
      eyebrow: "Security",
      heading: "Confirm your new email",
      bodyHtml,
      footerNote: "This is a transactional email regarding your account.",
    }),
    text: `Hey ${name}, confirm your email change to ${newEmail}: ${confirmUrl} (expires in 1 hour)`,
  }
}

export function sessionVerificationEmail(name: string, code: string) {
  const bodyHtml = [
    emailParagraph(`Hey ${emailStrong(name)},`),
    emailParagraph(`Your account already has ${emailStrong("2 active sessions")}. Enter this code to verify your new sign-in — your oldest session will be signed out to make room.`),
    emailCodeBlock(code),
    emailMetaTable([
      { label: "Expires in", value: "10 minutes" },
      { label: "Session limit", value: "2 active sessions" },
      { label: "On success", value: "Oldest session signs out" },
    ]),
    emailNote("Didn't request this? Someone may have your password. Change it immediately to secure your account."),
  ].join("")

  return {
    subject: "Your Atai sign-in code",
    html: renderEmailShell({
      title: "Confirm your sign-in",
      preheader: `Your Atai sign-in code is ${code}. Valid for 10 minutes.`,
      eyebrow: "Security",
      heading: "Confirm your sign-in",
      bodyHtml,
      footerNote: "This is a transactional email regarding your account.",
    }),
    text: `Hey ${name}, your Atai sign-in code is ${code} (expires in 10 minutes). If you didn't try to sign in, change your password immediately.`,
  }
}
