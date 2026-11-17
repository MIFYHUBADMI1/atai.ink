import type { Metadata } from "next"
import { Suspense } from "react"
import { VerifyEmailClient } from "@/components/auth/verify-email-client"
import { AuthShell } from "@/components/auth/auth-shell"
import { AuthVisual } from "@/components/auth/auth-visual"

export const metadata: Metadata = {
  title: "Verify email — Atai",
  description: "Verify your Atai email address.",
  robots: { index: false, follow: false },
}

export default function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  return (
    <AuthShell
      title="Verify your email"
      subtitle="Confirm your email address to secure your Atai account."
      footer={{ prompt: "Link expired or didn't work?", linkLabel: "Sign in", href: "/login" }}
      marketing={
        <AuthVisual
          eyebrow="Account"
          heading="One click to unlock your workspace."
          body="We sent a secure verification link to your inbox. Once confirmed, your businesses, plans, and credits are ready whenever you are."
          primary={{
            src: "/landing-images/atai-workspace.png",
            alt: "Atai workspace you'll return to after verifying your email",
          }}
          secondary={{
            src: "/landing-images/atai-product.png",
            alt: "Atai product view of a business in progress",
          }}
        />
      }
    >
      <Suspense>
        <VerifyEmailClient searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  )
}
