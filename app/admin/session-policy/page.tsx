"use client"

import { useState, useEffect, useCallback } from "react"
import useSWR from "swr"
import { Loader2, AlertTriangle, MonitorSmartphone, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { jsonFetcher, patchJson } from "@/lib/client/api"
import { toast } from "sonner"
import { AdminNav } from "@/components/admin-nav"

interface SessionPolicy {
  userMaxActiveSessions: number
  adminMaxActiveSessions: number | null
}

export default function AdminSessionPolicyPage() {
  const { data, error, isLoading, mutate } = useSWR<SessionPolicy>("/api/admin/session-policy", jsonFetcher)

  const [userCap, setUserCap] = useState("")
  const [adminUnlimited, setAdminUnlimited] = useState(true)
  const [adminCap, setAdminCap] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!data) return
    setUserCap(String(data.userMaxActiveSessions))
    setAdminUnlimited(data.adminMaxActiveSessions === null)
    setAdminCap(data.adminMaxActiveSessions === null ? "" : String(data.adminMaxActiveSessions))
  }, [data])

  const handleSave = useCallback(async () => {
    const userVal = parseInt(userCap, 10)
    if (isNaN(userVal) || userVal < 1 || userVal > 50) {
      toast.error("User session cap must be between 1 and 50")
      return
    }
    let adminVal: number | null = null
    if (!adminUnlimited) {
      adminVal = parseInt(adminCap, 10)
      if (isNaN(adminVal) || adminVal < 1 || adminVal > 50) {
        toast.error("Admin session cap must be between 1 and 50 — or choose Unlimited")
        return
      }
    }
    setBusy(true)
    try {
      const saved = await patchJson<SessionPolicy>("/api/admin/session-policy", {
        userMaxActiveSessions: userVal,
        adminMaxActiveSessions: adminVal,
      })
      toast.success("Session policy saved. It applies to the next sign-in.")
      mutate(saved)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save session policy")
    } finally {
      setBusy(false)
    }
  }, [userCap, adminUnlimited, adminCap, mutate])

  if (isLoading) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <AdminNav />
        <div className="mx-auto max-w-5xl px-6 py-10">
          <div className="mt-10 text-center">
            <AlertTriangle className="size-10 text-destructive mx-auto mb-4" />
            <h1 className="text-xl font-semibold">Access Denied</h1>
            <p className="mt-2 text-sm text-muted-foreground">You don&apos;t have permission to access this page.</p>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AdminNav />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Admin</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight flex items-center gap-2">
            <MonitorSmartphone className="size-6 text-primary" />
            Session Policy
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            How many devices can be signed in at once, and what happens when the cap is reached. Changes apply from the next sign-in.
          </p>
        </header>

        <Card className="mt-8">
          <CardContent className="py-6 flex flex-col gap-6">
            <div>
              <Label htmlFor="user-cap">User accounts — max active sessions</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                When a regular account is at this limit, the next sign-in must be confirmed with an emailed 6-digit code; confirming it signs out the oldest session.
              </p>
              <div className="mt-2 flex items-center gap-3">
                <Input
                  id="user-cap"
                  type="number"
                  min={1}
                  max={50}
                  value={userCap}
                  onChange={(e) => setUserCap(e.target.value)}
                  className="w-28"
                />
                <span className="text-sm text-muted-foreground">sessions per account</span>
              </div>
            </div>

            <div className="border-t border-border pt-5">
              <Label htmlFor="admin-cap">Admin accounts — max active sessions</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Admin sign-ins never ask for an emailed verification code. When unlimited (the default) admins can be signed in on any number of devices; when a cap is set, exceeding it silently signs out the oldest admin session.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={adminUnlimited}
                    onChange={(e) => setAdminUnlimited(e.target.checked)}
                    className="size-4 accent-primary"
                  />
                  Unlimited
                </label>
                {!adminUnlimited && (
                  <div className="flex items-center gap-3">
                    <Input
                      id="admin-cap"
                      type="number"
                      min={1}
                      max={50}
                      value={adminCap}
                      onChange={(e) => setAdminCap(e.target.value)}
                      className="w-28"
                    />
                    <span className="text-sm text-muted-foreground">sessions per admin account</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin mr-2" /> : <Save className="size-4 mr-2" />}
                Save policy
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="mt-4 text-xs text-muted-foreground">
          Stored in the app settings and applied server-side at every sign-in — no deploy needed.
        </p>
      </div>
    </main>
  )
}
