"use client"

import { useEffect, useState } from "react"
import { Check, Clock, Copy, Download, Globe, Loader2, RefreshCw, ShieldCheck, Trash2, TriangleAlert } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { patchJson, postJson } from "@/lib/client/api"
import { relativeDeadline, relativeTime } from "@/lib/client/format"
import { trackConnectVerified } from "@/lib/analytics/connect-funnel"
import type { DomainView } from "@/lib/domain/service"
import type { BusinessDomainMethod, BusinessDomainStatus } from "@/lib/types/business-intake"
import { cn } from "@/lib/utils"

const STATUS_LABEL: Record<BusinessDomainStatus, string> = {
  not_verified: "Not verified",
  pending: "Awaiting your tag or file",
  in_progress: "Checking…",
  verified: "Verified",
  expired: "Challenge expired",
  failed: "Check failed",
  revoked: "Released",
}

function statusTone(status: BusinessDomainStatus): string {
  if (status === "verified") return "bg-primary/10 text-primary"
  if (status === "failed" || status === "expired") return "bg-destructive/10 text-destructive"
  if (status === "revoked") return "bg-secondary text-secondary-foreground"
  return "bg-amber-500/15 text-amber-700 dark:text-amber-400"
}

function formatDate(at: number | null | undefined): string {
  if (!at) return "—"
  return new Date(at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
}

export function DomainVerification({
  projectId,
  initialDomains,
  defaultUrl,
  onChanged,
}: {
  projectId: string
  initialDomains: DomainView[]
  defaultUrl?: string
  onChanged?: () => void
}) {
  const [domains, setDomains] = useState<DomainView[]>(initialDomains)
  // The parent polls the authoritative view; adopt it whenever it changes.
  useEffect(() => setDomains(initialDomains), [initialDomains])
  const [url, setUrl] = useState(defaultUrl ?? "")
  const [method, setMethod] = useState<BusinessDomainMethod>("meta_tag")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [confirmRelease, setConfirmRelease] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState<string | null>(null)

  const base = `/api/projects/${projectId}/domains`

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  async function register() {
    if (!url.trim()) {
      setError("Enter the website address you own.")
      return
    }
    await run("register", async () => {
      const data = await postJson<{ domain: DomainView; created: boolean }>(base, { url: url.trim(), method })
      setDomains((current) => {
        const rest = current.filter((d) => d.id !== data.domain.id)
        return [data.domain, ...rest]
      })
      setNotice(
        data.created
          ? `Challenge created for ${data.domain.hostname}. Add the ${method === "meta_tag" ? "meta tag" : "file"} below, then check.`
          : `${data.domain.hostname} already has a challenge — here it is.`,
      )
      onChanged?.()
    })
  }

  async function setRecordMethod(domain: DomainView, next: BusinessDomainMethod) {
    await run(`method-${domain.id}`, async () => {
      const data = await patchJson<{ domain: DomainView }>(`${base}/${domain.id}`, { action: "set_method", method: next })
      setDomains((current) => current.map((d) => (d.id === domain.id ? data.domain : d)))
    })
  }

  async function verify(domain: DomainView) {
    await run(`verify-${domain.id}`, async () => {
      const data = await postJson<{ verified: boolean; domain: DomainView; failure?: { code: string; message: string } }>(
        `${base}/${domain.id}/verify`,
        { reverification: domain.status === "verified" },
      )
      setDomains((current) => current.map((d) => (d.id === domain.id ? data.domain : d)))
      if (data.verified) {
        setNotice(`${domain.hostname} is verified as yours in Atai.`)
        trackConnectVerified({ method: data.domain.method ?? "meta_tag", attempts: data.domain.attempts })
      } else if (data.failure) {
        setError(data.failure.message)
      }
      onChanged?.()
    })
  }

  async function regenerate(domain: DomainView) {
    await run(`regen-${domain.id}`, async () => {
      const data = await patchJson<{ domain: DomainView }>(`${base}/${domain.id}`, { action: "regenerate" })
      setDomains((current) => current.map((d) => (d.id === domain.id ? data.domain : d)))
      setNotice("A new challenge was generated. The previous tag or file no longer works — replace it with the new one below.")
      onChanged?.()
    })
  }

  async function release(domain: DomainView) {
    await run(`release-${domain.id}`, async () => {
      const data = await patchJson<{ domain: DomainView }>(`${base}/${domain.id}`, { action: "release" })
      setDomains((current) => current.map((d) => (d.id === domain.id ? data.domain : d)))
      setConfirmRelease(null)
      setNotice(
        `${domain.hostname} was released. The website is no longer claimed by this business, so another Atai account can connect it.`,
      )
      onChanged?.()
    })
  }

  async function copySnippet(domain: DomainView) {
    if (!domain.metaSnippet) return
    try {
      await navigator.clipboard.writeText(domain.metaSnippet)
      setCopiedId(domain.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      setError("Copying is not available in this browser — select the tag text and copy it manually.")
    }
  }

  const active = domains.filter((d) => d.status !== "revoked")
  const released = domains.filter((d) => d.status === "revoked")

  return (
    <div data-atai-tour="existing-business-domains" className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-secondary/30 p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">1 · Tell Atai which site</p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="dv-url">Website address</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="dv-url"
              value={url}
              onChange={(e) => setUrl(e.target.value.slice(0, 500))}
              placeholder="yourbusiness.com"
              inputMode="url"
              maxLength={500}
              className="sm:flex-1"
            />
            <Button type="button" onClick={register} disabled={busy === "register"}>
              {busy === "register" ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
              Start verification
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-muted-foreground">Method:</span>
          {(
            [
              ["meta_tag", "Meta tag in my homepage"],
              ["html_file", "HTML file at my site root"],
            ] as Array<[BusinessDomainMethod, string]>
          ).map(([value, label]) => (
            <label key={value} className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="dv-method"
                checked={method === value}
                onChange={() => setMethod(value)}
                className="size-3.5 accent-[var(--primary)]"
              />
              {label}
            </label>
          ))}
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Verifying <span className="font-medium">yourbusiness.com</span> verifies only that exact hostname — not
          <span className="font-medium"> shop.yourbusiness.com</span> or any other subdomain. Add each hostname you
          want verified separately.
        </p>
      </div>

      {notice ? (
        <p
          role="status"
          className="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-xs leading-relaxed text-success"
        >
          {notice}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive"
        >
          {error}
        </p>
      ) : null}

      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">2 · Add the tag, then check</p>

      {active.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-background/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          Nothing to check yet. Enter your address above and press Start verification — Atai will give you the exact
          tag or file to add.
        </p>
      ) : null}

      {active.map((domain) => {
        const expired = domain.status === "expired"
        const canCheck = !expired && domain.status !== "in_progress" && Boolean(domain.token)
        return (
          <div key={domain.id} className="rounded-xl border border-border/70 bg-background/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h4 className="truncate text-sm font-semibold">{domain.hostname}</h4>
                <p className="text-[11px] text-muted-foreground">
                  {domain.registrableDomain !== domain.hostname ? `Part of ${domain.registrableDomain} · ` : ""}
                  Added {formatDate(domain.createdAt)}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Clock className="size-3 shrink-0" />
                  {domain.lastCheckedAt ? `Last checked ${relativeTime(domain.lastCheckedAt)}` : "Not checked yet"}
                </p>
                {domain.claimExpiresAt && domain.status !== "verified" ? (
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    <TriangleAlert className="size-3 shrink-0" />
                    Reserved for your account {relativeDeadline(domain.claimExpiresAt)} — after that another account can
                    connect it
                  </p>
                ) : null}
              </div>
              <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", statusTone(domain.status))}>
                {STATUS_LABEL[domain.status]}
              </span>
            </div>

            {domain.needsAttention && domain.status === "verified" ? (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <div className="min-w-0">
                  <p>
                    The re-check {domain.lastFailure ? relativeTime(domain.lastFailure.at) : "just now"} could not find
                    your tag or file. Your domain stays verified for now — restore it and re-check. After repeated
                    failures the verification expires and you can generate a new challenge.
                  </p>
                  {domain.lastFailure ? <p className="mt-1 opacity-90">{domain.lastFailure.message}</p> : null}
                </div>
              </div>
            ) : null}

            {domain.lastFailure && domain.status !== "verified" ? (
              <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive">
                <p>{domain.lastFailure.message}</p>
                <p className="mt-1 opacity-80">Checked {relativeTime(domain.lastFailure.at)}.</p>
              </div>
            ) : null}

            {domain.status === "verified" ? (
              <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Check className="size-3.5 shrink-0 text-primary" />
                Verified {formatDate(domain.verifiedAt)} via{" "}
                {domain.verifiedMethod === "html_file" ? "HTML file" : "meta tag"}.
              </p>
            ) : null}

            {domain.token && !expired ? (
              <div className="mt-3 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Check with:</span>
                  {(
                    [
                      ["meta_tag", "Meta tag"],
                      ["html_file", "HTML file"],
                    ] as Array<[BusinessDomainMethod, string]>
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRecordMethod(domain, value)}
                      disabled={busy === `method-${domain.id}`}
                      className={cn(
                        "rounded-lg border px-2.5 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        (domain.method ?? "meta_tag") === value
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:border-primary/30",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {(domain.method ?? "meta_tag") === "meta_tag" ? (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-xs text-muted-foreground">
                      Paste this inside your homepage&apos;s <code className="rounded bg-secondary px-1">&lt;head&gt;</code>:
                    </p>
                    <div className="flex items-start gap-2">
                      <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-secondary/50 px-3 py-2 font-mono text-[11px] leading-relaxed">
                        {domain.metaSnippet}
                      </code>
                      <Button type="button" variant="outline" size="sm" onClick={() => copySnippet(domain)}>
                        {copiedId === domain.id ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                        {copiedId === domain.id ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-xs text-muted-foreground">
                      Upload this file to your website&apos;s root so it is served at{" "}
                      <code className="rounded bg-secondary px-1">https://{domain.hostname}/{domain.fileName}</code>:
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="min-w-0 select-all overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-secondary/50 px-3 py-2 font-mono text-[11px]">
                        {`atai-verification=${domain.token}`}
                      </code>
                      <a
                        href={`${base}/${domain.id}/file`}
                        download={domain.fileName ?? undefined}
                        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                      >
                        <Download className="size-3.5" />
                        Download {domain.fileName}
                      </a>
                    </div>
                  </div>
                )}

                <p className="text-[11px] text-muted-foreground">
                  Challenge expires {formatDate(domain.tokenExpiresAt)} · {domain.attempts} check(s) so far.
                </p>
              </div>
            ) : null}

            {expired ? (
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                This challenge expired. Generate a new one to continue — your previous tag or file will stop working.
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {canCheck ? (
                <Button type="button" size="sm" onClick={() => verify(domain)} disabled={busy === `verify-${domain.id}`}>
                  {busy === `verify-${domain.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
                  {domain.status === "verified" ? "Re-check ownership" : "Check my website"}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => regenerate(domain)}
                disabled={busy === `regen-${domain.id}`}
              >
                {busy === `regen-${domain.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                New challenge
              </Button>
              {confirmRelease === domain.id ? (
                <span className="inline-flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">
                    Release this claim? The website becomes connectable by any Atai account.
                  </span>
                  <Button type="button" size="sm" variant="destructive" onClick={() => release(domain)} disabled={busy === `release-${domain.id}`}>
                    Yes, release
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setConfirmRelease(null)}>
                    Keep it
                  </Button>
                </span>
              ) : (
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRelease(domain.id)}>
                  <Trash2 className="size-3.5" />
                  Release
                </Button>
              )}
              {domain.history?.length ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setShowHistory(showHistory === domain.id ? null : domain.id)}>
                  {showHistory === domain.id ? "Hide history" : "History"}
                </Button>
              ) : null}
            </div>

            {showHistory === domain.id ? (
              <ol className="mt-3 flex flex-col gap-1 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                {(domain.history ?? []).map((entry, index) => (
                  <li key={index} className="flex flex-wrap justify-between gap-2">
                    <span>
                      {STATUS_LABEL[entry.status]}
                      {entry.detail ? ` — ${entry.detail}` : ""}
                    </span>
                    <span className="font-mono">{formatDate(entry.at)}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        )
      })}

    {released.length ? (
      <div className="text-[11px] text-muted-foreground">
        <p className="font-medium">Released claims</p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {released.map((domain) => (
            <li key={domain.id}>
              {domain.hostname} — released {formatDate(domain.updatedAt)}
            </li>
          ))}
        </ul>
      </div>
    ) : null}
    </div>
  )
}
