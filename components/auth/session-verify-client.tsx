"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  humanizeAuthError,
  resendSessionVerificationCode,
  sanitizeNext,
  verifySessionCode,
} from "@/lib/auth/client-intent"
import { cn } from "@/lib/utils"

/**
 * Landing page for OAuth sign-ins (Google/GitHub) that hit the session cap.
 * The callback redirects here with `vid` (the pending verification id, used
 * only for resend) and `next` (post-login destination).
 */
export function SessionVerifyClient({
  searchParams,
}: {
  searchParams: Promise<{ vid?: string; next?: string }>
}) {
  const router = useRouter()
  const [params, setParams] = useState<{ vid?: string; next?: string } | null>(null)
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "error">("idle")
  const [resendCooldown, setResendCooldown] = useState(180)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setInterval(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => clearInterval(timer)
  }, [resendCooldown > 0])

  useEffect(() => {
    let cancelled = false
    void searchParams.then((p) => {
      if (!cancelled) setParams(p)
    })
    return () => {
      cancelled = true
    }
  }, [searchParams])

  const vid = params?.vid
  const destination = sanitizeNext(params?.next)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await verifySessionCode(code.trim())
      router.push(destination)
      router.refresh()
    } catch (err) {
      setError(humanizeAuthError(err))
      setSubmitting(false)
    }
  }

  async function onResend() {
    if (!vid || resendState === "sending") return
    setResendState("sending")
    try {
      const result = await resendSessionVerificationCode(vid)
      setResendState(result.sent ? "sent" : "error")
      if (result.sent) setResendCooldown(180)
    } catch {
      setResendState("error")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-6 text-muted-foreground">
        Your account already has 2 active sessions. Enter the 6-digit code we emailed you to confirm this sign-in — your oldest session will be signed out.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="session-code">Verification code</Label>
          <Input
            id="session-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            disabled={submitting}
            className="h-11 text-center font-mono text-lg tracking-[0.4em]"
          />
        </div>
        {error ? (
          <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {resendState === "sent" ? <p className="text-center text-sm text-muted-foreground">A new code is on its way.</p> : null}
        {resendState === "error" ? (
          <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Couldn&apos;t resend the code. Please try again.
          </p>
        ) : null}
        <button type="submit" className={cn(buttonVariants({ size: "lg" }), "h-11 w-full")} disabled={submitting || code.length !== 6}>
          {submitting ? "Verifying..." : "Verify and sign in"}
        </button>
        {vid ? (
          <button
            type="button"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 w-full")}
            disabled={resendState === "sending" || resendCooldown > 0}
            onClick={onResend}
          >
            {resendState === "sending"
              ? "Sending..."
              : resendCooldown > 0
                ? `Resend code (${Math.floor(resendCooldown / 60)}:${String(resendCooldown % 60).padStart(2, "0")})`
                : "Resend code"}
          </button>
        ) : null}
      </form>
    </div>
  )
}
