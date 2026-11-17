import type { Metadata } from "next"
import { SessionVerifyClient } from "@/components/auth/session-verify-client"
import { AuthShell } from "@/components/auth/auth-shell"

export const metadata: Metadata = {
  title: "Verify sign-in — Atai",
  description: "Confirm your Atai sign-in with an emailed code.",
  robots: { index: false, follow: false },
}

export default function VerifySessionPage({
  searchParams,
}: {
  searchParams: Promise<{ vid?: string; next?: string; email?: string }>
}) {
  return (
    <AuthShell
      title="One more step."
      subtitle="Confirm it's you to finish signing in."
      footer={{ prompt: "Changed your mind?", linkLabel: "Back to sign in", href: "/login" }}
    >
      <SessionVerifyClient searchParams={searchParams} />
    </AuthShell>
  )
}
