"use client"

import { useState, useCallback } from "react"
import Link from "next/link"
import useSWR from "swr"
import { SettingsShell } from "@/components/settings/settings-shell"
import { postJson, deleteJson, jsonFetcher, useSession } from "@/lib/client/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toast } from "sonner"
import { Shield, Key, Mail, Monitor, Smartphone, LogOut, AlertTriangle, Loader2, CheckCircle2, Eye, EyeOff, Trash2 } from "lucide-react"

interface SessionItem {
  id: string
  userAgent?: string
  createdAt: number
  lastSeenAt?: number
  expiresAt: number
  isCurrent: boolean
}

type ConfirmAction = { kind: "session"; session: SessionItem } | { kind: "all" } | null

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function parseUserAgent(ua?: string): { device: string; browser: string } {
  if (!ua) return { device: "Unknown device", browser: "Unknown browser" }
  let device = "Desktop"
  if (/mobile|android|iphone|ipad/i.test(ua)) device = "Mobile"
  else if (/tablet|ipad/i.test(ua)) device = "Tablet"

  let browser = "Unknown browser"
  if (/chrome/i.test(ua) && !/edge|opr/i.test(ua)) browser = "Chrome"
  else if (/firefox/i.test(ua)) browser = "Firefox"
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = "Safari"
  else if (/edge/i.test(ua)) browser = "Edge"

  return { device, browser }
}

export default function SecuritySettingsPage() {
  const { session } = useSession()
  const isPasswordUser = session?.user?.authProvider === "password"

  const [newEmail, setNewEmail] = useState("")
  const [emailSent, setEmailSent] = useState(false)
  const [changingEmail, setChangingEmail] = useState(false)

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [changingPassword, setChangingPassword] = useState(false)
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [revoking, setRevoking] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState("")
  const [deleteEmail, setDeleteEmail] = useState("")
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const { data: sessionsData, error: sessionsError, isLoading: sessionsLoading, mutate: refreshSessions } = useSWR<{ sessions: SessionItem[] }>(
    "/api/auth/sessions",
    jsonFetcher,
  )

  const handleChangePassword = useCallback(async () => {
    if (!currentPassword || !newPassword) {
      toast.error("Please fill in all fields")
      return
    }
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters")
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match")
      return
    }
    if (currentPassword === newPassword) {
      toast.error("New password must be different from your current password")
      return
    }

    setChangingPassword(true)
    try {
      await postJson("/api/auth/change-password", { currentPassword, newPassword })
      toast.success("Password changed successfully")
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to change password")
    } finally {
      setChangingPassword(false)
    }
  }, [currentPassword, newPassword, confirmPassword])

  const handleChangeEmail = useCallback(async () => {
    if (!newEmail) {
      toast.error("Please enter a new email address")
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      toast.error("Please enter a valid email address")
      return
    }
    if (session?.user?.email && newEmail.toLowerCase() === session.user.email.toLowerCase()) {
      toast.error("This is already your current email address")
      return
    }

    setChangingEmail(true)
    try {
      await postJson("/api/auth/change-email", { newEmail })
      setEmailSent(true)
      toast.success("Confirmation link sent! Check your new email inbox.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send confirmation")
    } finally {
      setChangingEmail(false)
    }
  }, [newEmail, session])

  const confirmRevoke = useCallback(async () => {
    if (!confirmAction) return
    setRevoking(true)
    try {
      if (confirmAction.kind === "all") {
        await deleteJson("/api/auth/sessions")
        toast.success("All other sessions revoked")
        await refreshSessions()
      } else {
        const target = confirmAction.session
        await deleteJson(`/api/auth/sessions?id=${encodeURIComponent(target.id)}`)
        if (target.isCurrent) {
          window.location.href = "/login"
          return
        }
        toast.success("Session revoked")
        await refreshSessions()
      }
      setConfirmAction(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke session")
    } finally {
      setRevoking(false)
    }
  }, [confirmAction, refreshSessions])

  const handleDeleteAccount = useCallback(async () => {
    setDeleteLoading(true)
    setDeleteError(null)
    try {
      await postJson("/api/me/delete-account", isPasswordUser
        ? { confirm: true, currentPassword: deletePassword }
        : { confirm: true, confirmEmail: deleteEmail })
      window.location.href = "/"
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete account")
      setDeleteLoading(false)
    }
  }, [deleteEmail, deletePassword, isPasswordUser])

  const sessions = sessionsData?.sessions ?? []
  const otherSessionCount = sessions.filter((s) => !s.isCurrent).length

  return (
    <SettingsShell title="Security">
      <div className="flex flex-col gap-8">
        <header>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Account</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Security</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage your password, email address, and active sessions.
          </p>
        </header>

        <section className="border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <Shield className="size-5 text-primary" />
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Sign-in security</p>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Your account uses {isPasswordUser ? "email and password authentication" : session?.user?.authProvider === "github" ? "GitHub authentication" : "Google authentication"}.
            Sessions are protected with server-side cookies and ownership checks.
          </p>
          {isPasswordUser && (
            <Link href="/forgot-password" className="mt-4 inline-block font-mono text-xs text-primary hover:underline">
              Forgot password? Reset it →
            </Link>
          )}
        </section>

        <section className="border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <Mail className="size-5 text-primary" />
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Email address</p>
          </div>
          <div className="mt-4">
            <p className="text-sm text-muted-foreground">
              Current email: <span className="font-medium text-foreground">{session?.user?.email ?? "—"}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your address changes only after you confirm the link sent to the new inbox.
            </p>
          </div>
          {emailSent ? (
            <div className="mt-4 rounded-lg border border-green-500/30 bg-green-500/5 p-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-green-500" />
                <p className="text-sm font-medium text-green-500">Confirmation sent</p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                We sent a confirmation link to <span className="font-medium">{newEmail}</span>. Click the link in the email to complete the change. The link expires in 1 hour.
              </p>
              <div className="mt-3">
                <Button variant="outline" size="sm" onClick={() => { setEmailSent(false); setNewEmail("") }}>
                  Change to a different email
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="new@email.com"
                className="sm:max-w-sm"
                aria-label="New email address"
              />
              <Button onClick={handleChangeEmail} disabled={changingEmail || !newEmail} variant="outline">
                {changingEmail ? <Loader2 className="size-4 animate-spin" /> : "Send confirmation"}
              </Button>
            </div>
          )}
        </section>

        {isPasswordUser && (
          <section className="border border-border bg-card p-6">
            <div className="flex items-center gap-3">
              <Key className="size-5 text-primary" />
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Change password</p>
            </div>
            <div className="mt-5 grid gap-4 sm:max-w-md">
              <div>
                <Label htmlFor="current-password" className="text-sm">Current password</Label>
                <div className="relative mt-1.5">
                  <Input
                    id="current-password"
                    type={showCurrent ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="pr-10"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                    aria-label={showCurrent ? "Hide current password" : "Show current password"}
                  >
                    {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label htmlFor="new-password" className="text-sm">New password</Label>
                <div className="relative mt-1.5">
                  <Input
                    id="new-password"
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="pr-10"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                    aria-label={showNew ? "Hide new password" : "Show new password"}
                  >
                    {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label htmlFor="confirm-password" className="text-sm">Confirm new password</Label>
                <div className="relative mt-1.5">
                  <Input
                    id="confirm-password"
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat new password"
                    className="pr-10"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                    aria-label={showConfirm ? "Hide password confirmation" : "Show password confirmation"}
                  >
                    {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Button
                  onClick={handleChangePassword}
                  disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
                >
                  {changingPassword ? (
                    <><Loader2 className="size-4 animate-spin" /> Changing...</>
                  ) : (
                    "Change password"
                  )}
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">Changing your password signs out all other sessions.</p>
              </div>
            </div>
          </section>
        )}

        {!isPasswordUser && (
          <section className="border border-border bg-card p-6">
            <div className="flex items-center gap-3">
              <Key className="size-5 text-primary" />
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Password</p>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              This account signs in with {session?.user?.authProvider === "github" ? "GitHub" : "Google"}, so there is no Atai password to change. Use your provider&apos;s account security settings to manage credentials.
            </p>
          </section>
        )}

        <section className="border border-border bg-card p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Monitor className="size-5 text-primary" />
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Active sessions</p>
            </div>
            {otherSessionCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmAction({ kind: "all" })}
                className="gap-1.5 text-destructive hover:text-destructive"
              >
                <LogOut className="size-3.5" />
                Revoke all others
              </Button>
            )}
          </div>

          {sessionsLoading ? (
            <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading sessions...
            </div>
          ) : sessionsError ? (
            <div className="mt-5 flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="size-4" />
              Could not load sessions
              <button type="button" onClick={() => void refreshSessions()} className="text-primary hover:underline">
                Retry
              </button>
            </div>
          ) : sessions.length > 0 ? (
            <div className="mt-5 space-y-3">
              {sessions.map((s) => {
                const { device, browser } = parseUserAgent(s.userAgent)
                const isMobile = device === "Mobile"
                const expiresAt = typeof s.expiresAt === "number" ? s.expiresAt : new Date(s.expiresAt).getTime()
                return (
                  <div key={s.id} className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      {isMobile ? (
                        <Smartphone className="size-5 shrink-0 text-muted-foreground" />
                      ) : (
                        <Monitor className="size-5 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {browser} on {device}
                          {s.isCurrent && (
                            <span className="ml-2 inline-flex items-center gap-1 text-xs text-primary">
                              <CheckCircle2 className="size-3" /> Current
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Signed in {formatDate(s.createdAt)}
                          {s.lastSeenAt ? ` · Last active ${formatDate(s.lastSeenAt)}` : ""}
                          {expiresAt ? ` · Expires ${formatDate(expiresAt)}` : ""}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmAction({ kind: "session", session: s })}
                      className="shrink-0 gap-1.5 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                      {s.isCurrent ? "Sign out" : "Revoke"}
                    </Button>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="mt-5 text-sm text-muted-foreground">No active sessions found.</p>
          )}
        </section>

        <section className="border border-destructive/30 bg-destructive/5 p-6">
          <p className="font-mono text-xs uppercase tracking-widest text-destructive">Danger zone</p>
          <p className="mt-3 text-sm text-muted-foreground">
            Signing out will end your current session. You can sign in again with your credentials.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Button
              variant="destructive"
              onClick={async () => {
                try {
                  await postJson("/api/auth/logout")
                } finally {
                  window.location.href = "/login"
                }
              }}
            >
              <LogOut className="size-4" /> Sign out
            </Button>
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => { setDeleteError(null); setDeleteOpen(true) }}
            >
              <Trash2 className="size-4" /> Delete account
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Deleting your account is permanent: everything below is lost. You can re-register later with the same email, but it starts as a brand-new account.
          </p>
        </section>
      </div>

      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => { if (!open) setConfirmAction(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.kind === "all" ? "Revoke other sessions?" : confirmAction?.kind === "session" && confirmAction.session.isCurrent ? "Sign out this session?" : "Revoke this session?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.kind === "all"
                ? "This keeps your current session active and signs out every other device."
                : confirmAction?.kind === "session" && confirmAction.session.isCurrent
                  ? "This will sign you out of Atai on this device."
                  : "That device will be signed out immediately. You can sign in again if needed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmRevoke()} disabled={revoking} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {revoking ? <Loader2 className="size-4 animate-spin" /> : confirmAction?.kind === "all" ? "Revoke others" : confirmAction?.kind === "session" && confirmAction.session.isCurrent ? "Sign out" : "Revoke session"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteOpen(false)
            setDeletePassword("")
            setDeleteEmail("")
            setDeleteError(null)
          }
        }}
      >
        <AlertDialogContent className="flex max-h-[min(90vh,52rem)] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 data-[size=default]:max-w-3xl data-[size=default]:sm:max-w-3xl">
          <div className="shrink-0 border-b border-border/60 px-6 pb-5 pt-6 sm:px-8 sm:pb-6 sm:pt-7">
            <div className="flex items-start gap-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-destructive/10 ring-1 ring-destructive/25">
                <AlertTriangle className="size-5 text-destructive" />
              </div>
              <div className="min-w-0 space-y-1.5">
                <AlertDialogTitle className="text-lg leading-7 sm:text-xl">Delete your Atai account?</AlertDialogTitle>
                <AlertDialogDescription className="block text-sm leading-6 text-muted-foreground sm:text-[0.95rem]">
                  Read everything below before continuing. Deletion is immediate and{" "}
                  <strong className="font-semibold text-foreground">cannot be undone</strong> — not by you, and not by an Atai admin.
                </AlertDialogDescription>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6 sm:px-8">
            <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 sm:p-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-destructive">What you lose</h3>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
                <li className="flex gap-3">
                  <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-destructive/70" />
                  <span>Access to your dashboard, projects, built apps and published sites — permanently.</span>
                </li>
                <li className="flex gap-3">
                  <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-destructive/70" />
                  <span>Every remaining credit balance, rewards and referral bonuses.</span>
                </li>
                <li className="flex gap-3">
                  <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-destructive/70" />
                  <span>Your chat history, plans, assets and uploaded files.</span>
                </li>
                <li className="flex gap-3">
                  <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-destructive/70" />
                  <span>Your API keys and any integrations built on them stop working.</span>
                </li>
                <li className="flex gap-3">
                  <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-destructive/70" />
                  <span>Your profile: name, email and sign-in credentials are removed and your identity is anonymized.</span>
                </li>
                <li className="flex gap-3">
                  <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-destructive/70" />
                  <span>You are signed out on every device immediately.</span>
                </li>
              </ul>
              <p className="mt-5 border-t border-destructive/20 pt-4 text-xs leading-5 text-muted-foreground">
                Some billing and business records are retained internally where the law requires, but they are detached from your identity and can never be restored to you. An active paid subscription must be cancelled first. You may sign up again later with the same email — it will be a brand-new, empty account.
              </p>
            </section>

            <section className="space-y-2">
              {isPasswordUser ? (
                <>
                  <Label htmlFor="delete-password" className="text-sm font-medium">Confirm with your current password</Label>
                  <p className="text-xs leading-5 text-muted-foreground">This proves the deletion request comes from you.</p>
                  <Input
                    id="delete-password"
                    type="password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    placeholder="Enter current password"
                    className="mt-1 h-11"
                    autoComplete="current-password"
                  />
                </>
              ) : (
                <>
                  <Label htmlFor="delete-email" className="text-sm font-medium">Type your account email to confirm</Label>
                  <p className="text-xs leading-5 text-muted-foreground">Enter {session?.user?.email ?? "your email address"} exactly as it appears on your account.</p>
                  <Input
                    id="delete-email"
                    type="email"
                    value={deleteEmail}
                    onChange={(e) => setDeleteEmail(e.target.value)}
                    placeholder={session?.user?.email ?? "you@example.com"}
                    className="mt-1 h-11"
                    autoComplete="email"
                  />
                </>
              )}
            </section>

            {deleteError ? <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm leading-6 text-destructive">{deleteError}</p> : null}
          </div>

          <AlertDialogFooter className="mx-0 mb-0 shrink-0 gap-2 rounded-none border-t p-6 sm:px-8 sm:py-6">
            <AlertDialogCancel disabled={deleteLoading} className="h-11 px-5">Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              className="h-11 px-5"
              onClick={() => void handleDeleteAccount()}
              disabled={deleteLoading || (isPasswordUser ? !deletePassword : deleteEmail.trim().toLowerCase() !== session?.user?.email?.toLowerCase())}
            >
              {deleteLoading ? <Loader2 className="size-4 animate-spin" /> : "Permanently delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsShell>
  )
}
