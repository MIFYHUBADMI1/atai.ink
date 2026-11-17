"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle2, Loader2, MailCheck, XCircle } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { postJson } from "@/lib/client/api"
import { cn } from "@/lib/utils"

type Status = "verifying" | "success" | "error" | "missing"

export function VerifyEmailClient({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const [status, setStatus] = useState<Status>("verifying")
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    searchParams.then(async (params) => {
      const token = params.token
      if (!token) {
        if (!cancelled) setStatus("missing")
        return
      }
      try {
        await postJson("/api/auth/verify-email", { token })
        if (!cancelled) setStatus("success")
      } catch (err) {
        if (!cancelled) {
          setStatus("error")
          setMessage(err instanceof Error ? err.message : "This verification link is invalid.")
        }
      }
    })
    return () => {
      cancelled = true
    }
  }, [searchParams])

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {status === "verifying" && (
        <>
          <span className="grid size-12 place-items-center rounded-full border border-primary/20 bg-primary/10">
            <Loader2 className="size-5 animate-spin text-primary" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Confirming your email…</p>
            <p className="mt-1 text-sm text-muted-foreground">This only takes a moment.</p>
          </div>
        </>
      )}

      {status === "success" && (
        <>
          <span className="grid size-12 place-items-center rounded-full border border-emerald-500/25 bg-emerald-500/10">
            <CheckCircle2 className="size-6 text-emerald-500" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Email verified</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground text-pretty">
              Your email address has been confirmed. You&apos;re all set to keep building with Atai.
            </p>
          </div>
          <Link href="/dashboard?mission=1" className={cn(buttonVariants({ size: "lg" }), "mt-2 h-11 w-full")}>
            Continue onboarding
          </Link>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-primary underline-offset-4 transition-colors hover:underline"
          >
            Skip to dashboard
          </Link>
        </>
      )}

      {(status === "error" || status === "missing") && (
        <>
          <span className="grid size-12 place-items-center rounded-full border border-destructive/25 bg-destructive/10">
            <XCircle className="size-6 text-destructive" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Verification failed</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground text-pretty">
              {status === "missing"
                ? "This link is missing a verification token."
                : message ?? "This verification link is invalid or has expired."}
            </p>
          </div>
          <div className="mt-2 flex w-full flex-col gap-2">
            <Link href="/dashboard" className={cn(buttonVariants({ size: "lg" }), "h-11 w-full")}>
              Go to dashboard
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <MailCheck className="size-4" />
              Sign in to request a new link
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
