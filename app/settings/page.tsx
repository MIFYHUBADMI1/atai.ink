import Link from "next/link"
import { redirect } from "next/navigation"
import { SettingsShell } from "@/components/settings/settings-shell"
import { getCurrentUser, countActiveSessions } from "@/lib/auth/session"
import { getBalance } from "@/lib/credits/credits"
import { readCofounderModelTier } from "@/lib/cofounder/model"
import { getCofounderTier } from "@/lib/cofounder/model-catalog"
import { AdminSelfCredit } from "@/components/admin-self-credit"
import { CheckCircle2, CreditCard, Shield, Sparkles, UserRound } from "lucide-react"

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function authLabel(provider: string): string {
  if (provider === "google") return "Google"
  if (provider === "github") return "GitHub"
  return "Email & password"
}

export default async function SettingsPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login?next=%2Fsettings")

  const [balance, sessionCount, storedTier] = await Promise.all([
    getBalance(user.id),
    countActiveSessions(user.id),
    readCofounderModelTier(user.id),
  ])
  const tier = storedTier ? await getCofounderTier(storedTier) : undefined
  const prefs = user.featurePreferences ?? {}
  const enabledFeatures = Object.values(prefs).filter(Boolean).length

  return (
    <SettingsShell title="Settings">
      <div className="flex flex-col gap-8">
        <header>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Settings</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Account settings</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage your profile, security, AI co-founder, workspace preferences, and billing.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="border border-border bg-card p-6">
            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {initials(user.name)}
              </div>
              <div className="min-w-0">
                <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Account</p>
                <h2 className="mt-2 truncate text-xl font-medium">{user.name}</h2>
                <p className="mt-1 truncate text-sm text-muted-foreground">{user.email}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                    {user.emailVerified ? <CheckCircle2 className="size-3 text-success" /> : null}
                    {user.emailVerified ? "Verified" : "Unverified"}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                    <UserRound className="size-3" /> {authLabel(user.authProvider)}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-4 font-mono text-xs">
              <Link href="/settings/profile" className="text-primary hover:underline">Profile →</Link>
              <Link href="/settings/security" className="text-primary hover:underline">Security →</Link>
              <Link href="/settings/appearance" className="text-primary hover:underline">Appearance →</Link>
            </div>
          </div>

          <div className="border border-border bg-card p-6">
            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <CreditCard className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Credits</p>
                <p className="mt-2 text-3xl font-semibold tabular-nums">{balance.toLocaleString()}</p>
                <p className="mt-1 text-sm text-muted-foreground">Available build credits</p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-4 font-mono text-xs">
              <Link href="/settings/billing" className="text-primary hover:underline">Billing →</Link>
              <Link href="/settings/billing#history" className="text-primary hover:underline">History →</Link>
            </div>
          </div>

          <div className="border border-border bg-card p-6">
            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Shield className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Security</p>
                <h2 className="mt-2 text-lg font-medium">{sessionCount} active session{sessionCount === 1 ? "" : "s"}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {user.emailVerified ? "Email verified" : "Email not verified yet"}
                </p>
              </div>
            </div>
            <div className="mt-5">
              <Link href="/settings/security" className="font-mono text-xs text-primary hover:underline">Manage security →</Link>
            </div>
          </div>

          <div className="border border-border bg-card p-6">
            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">AI co-founder</p>
                <h2 className="mt-2 text-lg font-medium">{tier?.name ?? "Default engine"}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {tier ? `${tier.creditsPerMessage === 0 ? "Free" : `${tier.creditsPerMessage} credits/message`} · ${tier.modelId}` : "Catalog unavailable"}
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-4 font-mono text-xs">
              <Link href="/settings/ai" className="text-primary hover:underline">AI settings →</Link>
              <Link href="/settings/features" className="text-primary hover:underline">
                {enabledFeatures} feature{enabledFeatures === 1 ? "" : "s"} on
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <Link href="/settings/ai" className="group border border-border bg-card p-5 transition-colors hover:border-primary/30 hover:bg-accent/40">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Atai intelligence</p>
            <h2 className="mt-3 text-lg font-medium">AI co-founder & feature switches</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Choose the engine behind your co-founder and control optional Market & Grow capabilities.
            </p>
          </Link>
          <Link href="/settings/feedback" className="group border border-border bg-card p-5 transition-colors hover:border-primary/30 hover:bg-accent/40">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Support</p>
            <h2 className="mt-3 text-lg font-medium">Feedback & privacy</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Report issues and control exactly what diagnostic information is attached.
            </p>
          </Link>
        </section>

        {user.isAdmin ? (
          <section className="border border-border bg-card p-6">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Admin</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Link href="/admin" className="rounded-lg border border-border p-4 text-sm font-medium transition-colors hover:bg-accent">Admin dashboard →</Link>
              <Link href="/admin/users" className="rounded-lg border border-border p-4 text-sm font-medium transition-colors hover:bg-accent">User management →</Link>
              <Link href="/admin/billing" className="rounded-lg border border-border p-4 text-sm font-medium transition-colors hover:bg-accent">Billing admin →</Link>
              <Link href="/admin/transactions" className="rounded-lg border border-border p-4 text-sm font-medium transition-colors hover:bg-accent">Credit transactions →</Link>
            </div>
            <AdminSelfCredit />
          </section>
        ) : null}
      </div>
    </SettingsShell>
  )
}
