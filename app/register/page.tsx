import type { Metadata } from "next"
import { Suspense } from "react"
import { RegisterForm } from "@/components/auth/register-form"
import { AuthShell } from "@/components/auth/auth-shell"
import { RegisterMarketing } from "./register-marketing"
import { getPublicBillingConfig } from "@/lib/billing/public-config"

export const metadata: Metadata = {
  title: "Create account — Atai",
  description: "Create an Atai account.",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

export default async function RegisterPage() {
  const billing = await getPublicBillingConfig().catch(() => null)
  return (
    <AuthShell
      title="Create your account"
      subtitle="Start with an idea. Review a plan. Then build."
      footer={{ prompt: "Already have an account?", linkLabel: "Sign in", href: "/login" }}
      marketing={<RegisterMarketing welcomeBonus={billing?.rewards.welcomeBonus} />}
    >
      <Suspense>
        <RegisterForm />
      </Suspense>
    </AuthShell>
  )
}
