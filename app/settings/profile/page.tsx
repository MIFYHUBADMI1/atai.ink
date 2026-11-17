"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { SettingsShell } from "@/components/settings/settings-shell"
import { ProfileAvatarUpload } from "@/components/profile-avatar-upload"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CheckCircle2, Shield, Link as LinkIcon, Loader2 } from "lucide-react"
import { useSession, jsonFetcher, patchJson } from "@/lib/client/api"
import useSWR from "swr"
import { toast } from "sonner"
import { GitHubIcon } from "@/components/github-icon"

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

function authLabel(provider: string): string {
  if (provider === "google") return "Google"
  if (provider === "github") return "GitHub"
  return "Email & password"
}

export default function ProfileSettingsPage() {
  const router = useRouter()
  const { session, isLoading, refresh } = useSession()
  const [name, setName] = useState("")
  const [savingName, setSavingName] = useState(false)
  const {
    data: credits,
    error: creditsError,
    isLoading: creditsLoading,
    mutate: retryCredits,
  } = useSWR<{ balance: number }>(session ? "/api/credits" : null, jsonFetcher)

  useEffect(() => {
    if (!isLoading && !session) router.replace("/login?next=%2Fsettings%2Fprofile")
  }, [session, isLoading, router])

  useEffect(() => {
    setName(session?.user?.name ?? "")
  }, [session?.user?.name])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const google = params.get("google")
    const error = params.get("error")
    if (google === "connected") toast.success("Google account connected")
    else if (error === "google_already_linked") toast.error("That Google account is already linked to another Atai account")
    else if (error === "google_email_unverified") toast.error("Google did not verify that email address")
    else if (error) toast.error("Google connection failed. Please try again.")
    if (google || error) window.history.replaceState(null, "", window.location.pathname)
  }, [])

  if (isLoading || !session) return null

  const user = session.user
  const nameChanged = name.trim() !== user.name.trim()
  const creditsValue = creditsLoading ? "…" : creditsError ? "Unavailable" : (credits?.balance ?? 0).toLocaleString()

  async function saveName() {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error("Name is required")
      return
    }
    if (trimmed.length > 80) {
      toast.error("Name must be 80 characters or fewer")
      return
    }
    setSavingName(true)
    try {
      await patchJson("/api/me/profile", { name: trimmed })
      toast.success("Profile updated")
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update profile")
    } finally {
      setSavingName(false)
    }
  }

  return (
    <SettingsShell title="Profile">
      <div className="flex flex-col gap-8">
        <header>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Account</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Profile</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage your display name, avatar, and connected services.
          </p>
        </header>

        <section className="border border-border bg-card p-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <ProfileAvatarUpload currentImageUrl={user.imageUrl} userName={user.name} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-semibold tracking-tight">{user.name}</h2>
                {user.emailVerified ? (
                  <Badge variant="secondary" className="gap-1 font-mono text-xs">
                    <CheckCircle2 className="size-3" /> Verified
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 font-mono text-xs text-muted-foreground">
                    Unverified
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
              <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Shield className="size-3" /> {authLabel(user.authProvider)} sign-in
                </span>
                <span className="font-mono">Member since {formatDate(user.createdAt)}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="border border-border bg-card p-6">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Personal information</p>
          <div className="mt-5 grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <Label htmlFor="display-name" className="text-sm">Display name</Label>
              <Input
                id="display-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                className="mt-1.5"
                placeholder="Your name"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">1–80 characters.</p>
            </div>
            <Button onClick={saveName} disabled={savingName || !nameChanged || !name.trim()}>
              {savingName ? <Loader2 className="size-4 animate-spin" /> : "Save name"}
            </Button>
          </div>
          <dl className="mt-6 grid gap-5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="mt-1 font-medium">{user.email}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Email status</dt>
              <dd className="mt-1 font-medium">{user.emailVerified ? "Verified" : "Not verified"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Sign-in method</dt>
              <dd className="mt-1 font-medium">{authLabel(user.authProvider)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Account created</dt>
              <dd className="mt-1 font-medium">{formatDate(user.createdAt)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Available credits</dt>
              <dd className="mt-1 font-medium font-mono">
                {creditsValue}
                {creditsError ? (
                  <button type="button" onClick={() => void retryCredits()} className="ml-3 text-xs text-primary hover:underline">
                    Retry
                  </button>
                ) : null}
              </dd>
              {creditsError ? (
                <p className="mt-1 text-xs text-destructive">Credit balance is temporarily unavailable.</p>
              ) : null}
            </div>
          </dl>
        </section>

        <section id="connected-accounts" className="border border-border bg-card p-6">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Connected accounts</p>
          <p className="mt-2 text-sm text-muted-foreground">
            External sign-in and integration status for this account.
          </p>
          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#24292e]">
                  <GitHubIcon className="size-5 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm">GitHub</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {user.githubConnected
                      ? `Connected as @${user.githubUsername || "GitHub user"}`
                      : "Repository integration and GitHub sign-in"}
                  </p>
                </div>
              </div>
              {user.githubConnected ? (
                <Badge variant="secondary" className="gap-1.5 font-mono text-xs">
                  <CheckCircle2 className="size-3" /> Connected
                </Badge>
              ) : (
                <a
                  href="/api/auth/github?next=/settings/profile"
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[#24292e] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#1a1e22]"
                >
                  <LinkIcon className="size-3.5" /> Connect
                </a>
              )}
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white">
                  <svg className="size-5" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm">Google</p>
                  <p className="text-xs text-muted-foreground">
                    {user.googleConnected
                      ? user.authProvider === "google"
                        ? "Primary sign-in method"
                        : "Connected — you can also sign in with Google"
                      : "Sign in faster with your Google account"}
                  </p>
                </div>
              </div>
              {user.googleConnected ? (
                <Badge variant="secondary" className="gap-1.5 font-mono text-xs">
                  <CheckCircle2 className="size-3" /> Connected
                </Badge>
              ) : (
                <a
                  href="/api/auth/google?connect=1&next=/settings/profile"
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-xs font-medium transition-colors hover:bg-accent"
                >
                  <LinkIcon className="size-3.5" /> Connect
                </a>
              )}
            </div>
          </div>
        </section>

        <section className="border border-border bg-card p-6">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Manage account</p>
          <div className="mt-5 flex flex-col gap-3">
            <Link href="/settings/security" className="flex items-center justify-between rounded-lg border border-border p-4 text-sm transition-colors hover:bg-accent">
              <span>
                <span className="block font-medium">Security</span>
                <span className="mt-1 block text-xs text-muted-foreground">Password, email, and sessions</span>
              </span>
              <span className="font-mono text-xs text-primary">→</span>
            </Link>
            <Link href="/settings/billing" className="flex items-center justify-between rounded-lg border border-border p-4 text-sm transition-colors hover:bg-accent">
              <span>
                <span className="block font-medium">Billing & credits</span>
                <span className="mt-1 block text-xs text-muted-foreground">Plan, balance, and history</span>
              </span>
              <span className="font-mono text-xs text-primary">→</span>
            </Link>
            <Link href="/settings/appearance" className="flex items-center justify-between rounded-lg border border-border p-4 text-sm transition-colors hover:bg-accent">
              <span>
                <span className="block font-medium">Appearance</span>
                <span className="mt-1 block text-xs text-muted-foreground">Theme and visual preferences</span>
              </span>
              <span className="font-mono text-xs text-primary">→</span>
            </Link>
          </div>
        </section>
      </div>
    </SettingsShell>
  )
}
