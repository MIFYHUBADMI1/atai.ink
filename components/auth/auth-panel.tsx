"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Mail } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { GoogleButton } from "@/components/auth/google-button"
import { GitHubButton } from "@/components/auth/github-button"
import { PasswordField } from "@/components/auth/password-field"
import { BrandMark } from "@/components/brand-logo"
import type { AuthView } from "@/lib/auth/client-intent"
import {
  getReferralCode,
  humanizeAuthError,
  loginWithPassword,
  persistReferralCode,
  registerWithPassword,
  requestPasswordReset,
  resendSessionVerificationCode,
  resendVerificationEmail,
  verifySessionCode,
} from "@/lib/auth/client-intent"
import { cn } from "@/lib/utils"

const COPY: Record<
  Extract<AuthView, "login" | "signup" | "forgot" | "forgot-sent" | "verify" | "session-verify">,
  { title: string; subtitle: string }
> = {
  login: {
    title: "Welcome back",
    subtitle: "Continue working on your business with Atai.",
  },
  signup: {
    title: "Create your Atai account",
    subtitle: "Start turning your ideas into real businesses.",
  },
  forgot: {
    title: "Reset your password",
    subtitle: "Enter your email and we'll send you a secure reset link.",
  },
  "forgot-sent": {
    title: "Check your email",
    subtitle: "We've sent password reset instructions if an account exists for that address.",
  },
  verify: {
    title: "Check your email",
    subtitle: "We've sent a verification link so you can confirm your account.",
  },
  "session-verify": {
    title: "Check your email",
    subtitle: "Your account is at its active-session limit. Enter the 6-digit code we sent to confirm this sign-in — your oldest session will be signed out.",
  },
}

export function AuthPanel({
  view,
  onViewChange,
  next,
  onAuthenticated,
  onBusyChange,
  showBrand = true,
  showHeading = true,
  className,
  isOpen,
}: {
  view: AuthView
  onViewChange: (view: AuthView) => void
  next: string
  onAuthenticated: (destination: string) => void
  onBusyChange?: (busy: boolean) => void
  showBrand?: boolean
  showHeading?: boolean
  className?: string
  isOpen?: boolean
}) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [oauthProvider, setOauthProvider] = useState<"google" | "github" | null>(null)
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "error">("idle")
  const [emailOpen, setEmailOpen] = useState(false)
  const [sessionCode, setSessionCode] = useState("")
  const [sessionVerifyCtx, setSessionVerifyCtx] = useState<{ id?: string; email: string } | null>(null)
  const [sessionCooldown, setSessionCooldown] = useState(0)
  const [sessionResendError, setSessionResendError] = useState<string | null>(null)

  const busy = submitting || oauthProvider !== null

  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])

  useEffect(() => {
    setError(null)
    setOauthProvider(null)
    setResendState("idle")
    setSessionCode("")
    setSessionResendError(null)
    setSessionCooldown(0)
  }, [view])

  useEffect(() => {
    if (sessionCooldown <= 0) return
    const timer = setInterval(() => setSessionCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => clearInterval(timer)
  }, [sessionCooldown > 0])

  useEffect(() => {
    if (isOpen === false) setEmailOpen(false)
  }, [isOpen])

  function setBusy(nextBusy: boolean) {
    setSubmitting(nextBusy)
  }

  async function onLogin(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result = await loginWithPassword(email, password)
      if (result?.sessionVerificationRequired) {
        setSessionVerifyCtx({ id: result.verificationId, email: result.email || email })
        onViewChange("session-verify")
        setBusy(false)
        return
      }
      onAuthenticated(next)
    } catch (err) {
      setError(humanizeAuthError(err))
      setBusy(false)
    }
  }

  async function onVerifySessionCode(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await verifySessionCode(sessionCode.trim())
      onAuthenticated(next)
    } catch (err) {
      setError(humanizeAuthError(err))
      setBusy(false)
    }
  }

  async function onResendSessionCode() {
    if (!sessionVerifyCtx?.id || resendState === "sending") return
    setResendState("sending")
    setSessionResendError(null)
    try {
      const result = await resendSessionVerificationCode(sessionVerifyCtx.id, sessionVerifyCtx.email)
      if (result.sent) {
        setResendState("sent")
        setSessionCooldown(result.retryAfterSeconds ?? 180)
        if (result.verificationId) {
          setSessionVerifyCtx((prev) => (prev ? { ...prev, id: result.verificationId } : prev))
        }
      } else {
        setResendState("error")
        setSessionResendError(
          result.reason === "delivery_failed"
            ? "We couldn't send the code email. Please try again."
            : result.reason === "invalid"
              ? "This code request expired. Please sign in again."
              : "Email delivery isn't available right now.",
        )
      }
    } catch (err) {
      setResendState("error")
      setSessionResendError(humanizeAuthError(err))
    }
  }

  async function onSignup(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError("Password must be at least 8 characters.")
      return
    }
    setBusy(true)
    try {
      await registerWithPassword({
        name,
        email,
        password,
        ref: getReferralCode(),
      })
      onViewChange("verify")
      setBusy(false)
    } catch (err) {
      setError(humanizeAuthError(err))
      setBusy(false)
    }
  }

  async function onForgot(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await requestPasswordReset(email)
      onViewChange("forgot-sent")
    } catch (err) {
      setError(humanizeAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onResend() {
    if (resendState === "sending") return
    setResendState("sending")
    try {
      await resendVerificationEmail()
      setResendState("sent")
    } catch {
      setResendState("error")
    }
  }

  const copy = COPY[view] ?? COPY.login

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {showBrand ? (
        <div className="flex justify-center">
          <BrandMark size={36} />
        </div>
      ) : null}

      {showHeading ? (
        <div className="flex flex-col gap-1.5 text-center">
          <h2 className="text-xl font-semibold tracking-tight">{copy.title}</h2>
          <p className="text-sm leading-6 text-muted-foreground">{copy.subtitle}</p>
          {(view === "forgot-sent" || view === "verify" || view === "session-verify") && email ? (
            <p className="text-sm font-medium text-foreground">{email}</p>
          ) : null}
        </div>
      ) : null}

      {(view === "login" || view === "signup") && (
        <>
          <div className="flex flex-col gap-2">
            <GoogleButton
              next={next}
              referralCode={getReferralCode()}
              disabled={submitting}
              onStart={() => setOauthProvider("google")}
              label={oauthProvider === "google" ? "Connecting to Google..." : "Continue with Google"}
            />
            <GitHubButton
              next={next}
              referralCode={getReferralCode()}
              disabled={submitting}
              onStart={() => setOauthProvider("github")}
              label={oauthProvider === "github" ? "Connecting to GitHub..." : "Continue with GitHub"}
            />
          </div>

          {!emailOpen ? (
            <button
              type="button"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 w-full gap-2")}
              disabled={busy}
              onClick={() => setEmailOpen(true)}
            >
              <Mail className="size-4" />
              Continue with email
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Email</span>
              <Separator className="flex-1" />
            </div>
          )}
        </>
      )}

      {view === "login" && emailOpen && (
        <form onSubmit={onLogin} className="flex flex-col gap-4">
          <EmailField id="auth-email" value={email} onChange={setEmail} disabled={submitting} />
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="auth-password">Password</Label>
              <button
                type="button"
                className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => onViewChange("forgot")}
              >
                Forgot password?
              </button>
            </div>
            <PasswordField
              id="auth-password"
              label=""
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              disabled={submitting}
            />
          </div>
          {error ? <AuthError message={error} /> : null}
          <button type="submit" className={cn(buttonVariants({ size: "lg" }), "h-11 w-full")} disabled={submitting}>
            {submitting ? "Signing in..." : "Sign in"}
          </button>
          <AuthSwitch
            prompt="Don't have an account?"
            action="Create one"
            onClick={() => onViewChange("signup")}
          />
        </form>
      )}

      {view === "login" && !emailOpen ? (
        <AuthSwitch
          prompt="Don't have an account?"
          action="Create one"
          onClick={() => onViewChange("signup")}
        />
      ) : null}

      {view === "signup" && emailOpen && (
        <form onSubmit={onSignup} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="auth-name">Name</Label>
            <Input
              id="auth-name"
              type="text"
              autoComplete="name"
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={submitting}
              className="h-11"
            />
          </div>
          <EmailField id="auth-signup-email" value={email} onChange={setEmail} disabled={submitting} />
          <PasswordField
            id="auth-signup-password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            disabled={submitting}
            minLength={8}
            hint="At least 8 characters."
          />
          {error ? <AuthError message={error} /> : null}
          <button type="submit" className={cn(buttonVariants({ size: "lg" }), "h-11 w-full")} disabled={submitting}>
            {submitting ? "Creating account..." : "Create account"}
          </button>
          <AuthSwitch
            prompt="Already have an account?"
            action="Sign in"
            onClick={() => onViewChange("login")}
          />
        </form>
      )}

      {view === "signup" && !emailOpen ? (
        <AuthSwitch
          prompt="Already have an account?"
          action="Sign in"
          onClick={() => onViewChange("login")}
        />
      ) : null}

      {view === "forgot" && (
        <form onSubmit={onForgot} className="flex flex-col gap-4">
          <EmailField id="auth-reset-email" value={email} onChange={setEmail} disabled={submitting} />
          {error ? <AuthError message={error} /> : null}
          <button type="submit" className={cn(buttonVariants({ size: "lg" }), "h-11 w-full")} disabled={submitting}>
            {submitting ? "Sending..." : "Send reset link"}
          </button>
          <p className="text-center text-sm text-muted-foreground">
            Remember your password?{" "}
            <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => onViewChange("login")}>
              Back to sign in
            </button>
          </p>
        </form>
      )}

      {view === "forgot-sent" && (
        <div className="flex flex-col gap-4">
          <p className="text-center text-sm text-muted-foreground">
            We&apos;ve sent password reset instructions to {email || "your email"} if an account exists.
          </p>
          <button type="button" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 w-full")} onClick={() => onViewChange("login")}>
            Back to sign in
          </button>
        </div>
      )}

      {view === "session-verify" && (
        <form onSubmit={onVerifySessionCode} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="session-code">Verification code</Label>
            <Input
              id="session-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              pattern="\d{6}"
              placeholder="123456"
              value={sessionCode}
              onChange={(event) => setSessionCode(event.target.value.replace(/\D/g, ""))}
              disabled={submitting}
              className="h-11 text-center font-mono text-lg tracking-[0.4em]"
            />
          </div>
          {error ? <AuthError message={error} /> : null}
          {resendState === "sent" ? <p className="text-center text-sm text-muted-foreground">A new code is on its way.</p> : null}
          {resendState === "error" && sessionResendError ? <AuthError message={sessionResendError} /> : null}
          <button type="submit" className={cn(buttonVariants({ size: "lg" }), "h-11 w-full")} disabled={submitting || sessionCode.length !== 6}>
            {submitting ? "Verifying..." : "Verify and sign in"}
          </button>
          {sessionVerifyCtx?.id ? (
            <button
              type="button"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 w-full")}
              disabled={resendState === "sending" || sessionCooldown > 0}
              onClick={onResendSessionCode}
            >
              {resendState === "sending"
                ? "Sending..."
                : sessionCooldown > 0
                  ? `Resend code (${Math.floor(sessionCooldown / 60)}:${String(sessionCooldown % 60).padStart(2, "0")})`
                  : "Resend code"}
            </button>
          ) : null}
          <button type="button" className="text-center text-sm font-medium text-primary underline-offset-4 hover:underline" onClick={() => onViewChange("login")}>
            Back to sign in
          </button>
        </form>
      )}

      {view === "verify" && (
        <div className="flex flex-col gap-3">
          {resendState === "sent" ? <p className="text-center text-sm text-muted-foreground">Verification email sent.</p> : null}
          {resendState === "error" ? <AuthError message="Couldn't resend the email. Please try again." /> : null}
          <button type="button" className={cn(buttonVariants({ size: "lg" }), "h-11 w-full")} onClick={() => onAuthenticated(next)}>
            Continue
          </button>
          <button type="button" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 w-full")} disabled={resendState === "sending"} onClick={onResend}>
            {resendState === "sending" ? "Sending..." : "Resend email"}
          </button>
          <button type="button" className="text-center text-sm font-medium text-primary underline-offset-4 hover:underline" onClick={() => onViewChange("login")}>
            Back to sign in
          </button>
        </div>
      )}
    </div>
  )
}

function AuthSwitch({
  prompt,
  action,
  onClick,
}: {
  prompt: string
  action: string
  onClick: () => void
}) {
  return (
    <p className="text-center text-sm text-muted-foreground">
      {prompt}{" "}
      <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={onClick}>
        {action}
      </button>
    </p>
  )
}

function EmailField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Email</Label>
      <Input
        id={id}
        type="email"
        autoComplete="email"
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-11"
      />
    </div>
  )
}

function AuthError({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  )
}

export function AuthPageAdapter({
  initialView,
  next,
  initialError,
}: {
  initialView: AuthView
  next?: string
  initialError?: string
}) {
  const router = useRouter()
  const [view, setView] = useState<AuthView>(initialView)
  const destination = next || "/dashboard"

  useEffect(() => {
    persistReferralCode(new URLSearchParams(window.location.search).get("ref"))
  }, [])

  return (
    <div className="flex flex-col gap-5">
      {initialError && view === initialView ? <AuthError message={initialError} /> : null}
      <AuthPanel
        view={view}
        onViewChange={setView}
        next={destination}
        showBrand={false}
        showHeading={false}
        onAuthenticated={(href) => {
          router.push(href)
          router.refresh()
        }}
      />
    </div>
  )
}
