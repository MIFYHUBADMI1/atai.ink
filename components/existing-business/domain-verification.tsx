"use client"

import { useEffect, useState } from "react"
import {
  Check,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Globe,
  ListChecks,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { patchJson, postJson } from "@/lib/client/api"
import { relativeDeadline, relativeTime } from "@/lib/client/format"
import { trackConnectVerified } from "@/lib/analytics/connect-funnel"
import { hostnameOfUrl, isSameSiteHost } from "@/lib/domain/host"
import { unresolvedDomainClaims } from "@/lib/existing-business/steps"
import type { DomainView } from "@/lib/domain/service"
import type { BusinessDomainMethod, BusinessDomainStatus } from "@/lib/types/business-intake"
import { cn } from "@/lib/utils"
import { DomainReleaseDialog, UnresolvedDomainsDialog } from "./domain-claim-dialogs"
import { VerificationGuideDialog } from "./verification-guide-dialog"

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

/**
 * Which instructions to show for one challenge. The founder's click wins over
 * the stored value: both artifacts come from the same token, so the choice is a
 * view preference and must never wait for a server round-trip.
 */
export function methodFor(
  domain: Pick<DomainView, "id" | "method">,
  choice: Record<string, BusinessDomainMethod>,
): BusinessDomainMethod {
  return choice[domain.id] ?? domain.method ?? "meta_tag"
}

function formatDate(at: number | null | undefined): string {
  if (!at) return "—"
  return new Date(at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
}

export function DomainVerification({
  projectId,
  apiBase,
  initialDomains,
  defaultUrl,
  onChanged,
}: {
  projectId: string
  apiBase?: string
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
  // Removing a claim always goes through the warning dialog, so nothing is
  // released as a side effect of a mis-click.
  const [releaseTargets, setReleaseTargets] = useState<DomainView[]>([])
  const [promptUnresolved, setPromptUnresolved] = useState(false)
  const [showHistory, setShowHistory] = useState<string | null>(null)
  // The method is a view choice, not a server fact: both artifacts come from the
  // same token, so switching must be instant. It is sent with the check, which
  // persists it, and the override outlives a parent refresh until then.
  const [methodChoice, setMethodChoice] = useState<Record<string, BusinessDomainMethod>>({})
  const [guideFor, setGuideFor] = useState<string | null>(null)

  const base = `${apiBase ?? `/api/projects/${projectId}`}/domains`

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

  async function register(targetUrl?: string) {
    const address = (targetUrl ?? url).trim()
    if (!address) {
      setError("Enter the website address you own.")
      return
    }
    await run("register", async () => {
      const data = await postJson<{ domain: DomainView; created: boolean }>(base, { url: address, method })
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

  async function verify(domain: DomainView) {
    const method = methodFor(domain, methodChoice)
    await run(`verify-${domain.id}`, async () => {
      const data = await postJson<{
        verified: boolean
        domain: DomainView
        failure?: { code: string; message: string; hostname?: string }
      }>(
        `${base}/${domain.id}/verify`,
        { reverification: domain.status === "verified", method },
      )
      // The check persisted the choice, so the override has done its job.
      setMethodChoice((current) => {
        const next = { ...current }
        delete next[domain.id]
        return next
      })
      const next = domains.map((d) => (d.id === domain.id ? data.domain : d))
      setDomains(next)
      if (data.verified) {
        setNotice(`${domain.hostname} is verified as yours in Atai.`)
        trackConnectVerified({ method: data.domain.method ?? "meta_tag", attempts: data.domain.attempts })
        // One proof does not settle the addresses still waiting: ask now,
        // rather than letting the step look finished while they linger.
        if (unresolvedDomainClaims(next).length > 0) setPromptUnresolved(true)
      } else if (data.failure) {
        setError(data.failure.message)
      }
      onChanged?.()
    })
  }

  async function regenerate(domain: DomainView) {
    await run(`regen-${domain.id}`, async () => {
      const data = await patchJson<{ domain: DomainView }>(`${base}/${domain.id}`, {
        action: "regenerate",
        method: methodFor(domain, methodChoice),
      })
      setDomains((current) => current.map((d) => (d.id === domain.id ? data.domain : d)))
      setNotice("A new challenge was generated. The previous tag or file no longer works — replace it with the new one below.")
      onChanged?.()
    })
  }

  async function release(targets: DomainView[]) {
    if (targets.length === 0) return
    const key = targets.length === 1 ? `release-${targets[0].id}` : "release-many"
    await run(key, async () => {
      for (const target of targets) {
        const data = await patchJson<{ domain: DomainView }>(`${base}/${target.id}`, { action: "release" })
        setDomains((current) => current.map((d) => (d.id === target.id ? data.domain : d)))
        // Drop each one as it lands, so a failure halfway leaves the dialog
        // showing only what is still claimed.
        setReleaseTargets((current) => current.filter((d) => d.id !== target.id))
      }
      setNotice(
        targets.length === 1
          ? `${targets[0].hostname} was removed. This business no longer claims it, so another Atai account can connect it.`
          : `${targets.length} addresses were removed. This business no longer claims them, so another Atai account can connect them.`,
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
  const guideDomain = active.find((d) => d.id === guideFor) ?? null
  // The address Atai read is the site this step is about. A claim on any other
  // site is still a real proof of ownership, but it is not the business the
  // co-founder described — so it is labelled rather than silently accepted.
  const readHostname = hostnameOfUrl(defaultUrl)
  const matchesRead = (domain: DomainView): boolean | null =>
    readHostname ? isSameSiteHost(domain.hostname, readHostname) : domain.matchesRead ?? null
  // Proved and still-waiting at the same time: the founder has to settle the
  // rest before this step can close.
  const proved = active.filter((d) => d.status === "verified")
  const unresolved = unresolvedDomainClaims(active)

  return (
    <div data-atai-tour="existing-business-domains" className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-secondary/30 p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {readHostname ? "1 · The site your co-founder read" : "1 · Tell Atai which site"}
        </p>

        {readHostname ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 break-all font-mono text-sm">{readHostname}</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                <Check className="size-3 shrink-0" /> Read by your co-founder
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground break-words">
              Verifying this address proves the business Atai already read is yours. Your assessment and your connection
              describe this site — nothing else on it changes.
            </p>
            <div>
              <Button type="button" onClick={() => register(defaultUrl)} disabled={busy === "register"}>
                {busy === "register" ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
                Verify this address
              </Button>
            </div>
            <details className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                A different address?
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                <p className="text-xs leading-relaxed text-muted-foreground break-words">
                  Atai read <span className="font-mono break-all">{readHostname}</span>. Another address is verified on
                  its own: it proves you own that address, but your co-founder&apos;s first read does not describe it.
                  You can ask for a new read afterwards.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="dv-url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value.slice(0, 500))}
                    placeholder="another-site-you-own.com"
                    inputMode="url"
                    maxLength={500}
                    aria-label="A different website address to verify"
                    className="sm:flex-1"
                  />
                  <Button type="button" variant="outline" onClick={() => register()} disabled={busy === "register"}>
                    Verify this address instead
                  </Button>
                </div>
              </div>
            </details>
          </div>
        ) : (
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
              <Button type="button" onClick={() => register()} disabled={busy === "register"}>
                {busy === "register" ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
                Start verification
              </Button>
            </div>
          </div>
        )}
        {/* Once a challenge exists, each card carries its own instant toggle;
            two controls for one choice is what made switching feel broken. */}
        {active.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-muted-foreground">How do you want to verify?</span>
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
        ) : null}
        <p className="text-[11px] leading-relaxed text-muted-foreground break-words">
          Verification is per hostname: proving{" "}
          <span className="font-mono break-all">{readHostname ?? "yourbusiness.com"}</span> does not prove a
          subdomain of it or any other address. Add each hostname you want verified separately.
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

      {proved.length > 0 && unresolved.length > 0 ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-800 dark:text-amber-300"
        >
          <p className="flex items-center gap-1.5 text-xs font-semibold">
            <TriangleAlert className="size-3.5 shrink-0" />
            {proved.length === 1 ? "One address is proved" : `${proved.length} addresses are proved`} —{" "}
            {unresolved.length === 1 ? "one is still waiting" : `${unresolved.length} are still waiting`}
          </p>
          <p className="text-xs leading-relaxed break-words">
            This step stays open until every address you added is proved or removed. A waiting address keeps that site
            reserved for your business, so nobody else can connect it.
          </p>
          <ul className="flex flex-col gap-2">
            {unresolved.map((domain) => {
              const stale = !domain.token || domain.status === "expired"
              return (
                <li
                  key={domain.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 py-2"
                >
                  <span className="min-w-0 break-all font-mono text-xs text-foreground">{domain.hostname}</span>
                  <span className="text-[11px] text-muted-foreground">{STATUS_LABEL[domain.status]}</span>
                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    {stale ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => regenerate(domain)}
                        disabled={busy === `regen-${domain.id}`}
                      >
                        {busy === `regen-${domain.id}` ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="size-3.5" />
                        )}
                        New challenge
                      </Button>
                    ) : (
                      <Button type="button" size="sm" variant="outline" onClick={() => setGuideFor(domain.id)}>
                        <ListChecks className="size-3.5" />
                        Prove this one
                      </Button>
                    )}
                    <Button type="button" size="sm" variant="ghost" onClick={() => setReleaseTargets([domain])}>
                      <Trash2 className="size-3.5" />
                      Remove
                    </Button>
                  </span>
                </li>
              )
            })}
          </ul>
          {unresolved.length > 1 ? (
            <div>
              <Button type="button" size="sm" variant="ghost" onClick={() => setReleaseTargets(unresolved)}>
                <Trash2 className="size-3.5" />
                Remove all {unresolved.length}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">2 · Add the tag, then check</p>

      {active.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-background/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          Nothing to check yet. Start verification above and Atai will give you the exact tag or file to add.
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

            {matchesRead(domain) === false ? (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <div className="min-w-0 break-words">
                  <p className="font-medium">Not the address Atai read</p>
                  <p className="mt-1">
                    {readHostname ? (
                      <>
                        Your co-founder&apos;s first read was{" "}
                        <span className="font-mono break-all">{readHostname}</span>.{" "}
                      </>
                    ) : (
                      <>Your co-founder read a different site. </>
                    )}
                    Verifying this address proves you own it, but nothing Atai wrote describes this site yet — ask your
                    co-founder to read it when you are ready.
                  </p>
                </div>
              </div>
            ) : null}

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
                <p className="break-words">{domain.lastFailure.message}</p>
                <p className="mt-1 opacity-80">Checked {relativeTime(domain.lastFailure.at)}.</p>
                {/* A redirect that leaves the site is not a dead end: the address
                    that answered is the one worth proving. */}
                {domain.lastFailure.hostname ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 h-auto max-w-full whitespace-normal text-left"
                    onClick={() => register(`https://${domain.lastFailure?.hostname}`)}
                    disabled={busy === "register"}
                  >
                    <Globe className="size-3.5 shrink-0" />
                    <span className="min-w-0 break-all">Verify {domain.lastFailure.hostname} instead</span>
                  </Button>
                ) : null}
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
                <div
                  className="flex min-w-0 flex-wrap items-center gap-2 text-xs"
                  role="group"
                  aria-label="Verification method"
                >
                  <span className="text-muted-foreground">Check with:</span>
                  {(
                    [
                      ["meta_tag", "Meta tag"],
                      ["html_file", "HTML file"],
                    ] as Array<[BusinessDomainMethod, string]>
                  ).map(([value, label]) => {
                    const selected = methodFor(domain, methodChoice) === value
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setMethodChoice((current) => ({ ...current, [domain.id]: value }))}
                        className={cn(
                          "rounded-lg border px-2.5 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          selected
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border bg-card text-muted-foreground hover:border-primary/30",
                        )}
                      >
                        {label}
                      </button>
                    )
                  })}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto gap-1.5"
                    onClick={() => setGuideFor(domain.id)}
                  >
                    <ListChecks className="size-3.5" />
                    Steps to follow
                  </Button>
                </div>

                {methodFor(domain, methodChoice) === "meta_tag" ? (
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
                    <p className="text-xs text-muted-foreground break-words">
                      Put this file where your site is published from, so it is served at{" "}
                      {/* Inline, not inline-flex: a flex container cannot wrap the
                          unbreakable file name and widens the card instead. */}
                      <a
                        href={`https://${domain.hostname}/${domain.fileName}`}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-primary hover:underline"
                      >
                        https://{domain.hostname}/{domain.fileName}
                      </a>
                      <ExternalLink className="ml-1 inline size-3 align-baseline" />:
                    </p>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <code className="min-w-0 select-all overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-secondary/50 px-3 py-2 font-mono text-[11px]">
                        {`atai-verification=${domain.token}`}
                      </code>
                      <a
                        href={`${base}/${domain.id}/file`}
                        download={domain.fileName ?? undefined}
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                          "h-auto max-w-full whitespace-normal text-left",
                        )}
                      >
                        <Download className="size-3.5 shrink-0" />
                        <span className="min-w-0 break-all">Download {domain.fileName}</span>
                      </a>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      On Vercel or Next.js the file goes in <code className="rounded bg-secondary px-1">public/</code>,
                      not the repository root — the root is not published.
                    </p>
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
              <Button type="button" size="sm" variant="ghost" onClick={() => setReleaseTargets([domain])}>
                <Trash2 className="size-3.5" />
                Remove
              </Button>
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

    {guideDomain ? (
      <VerificationGuideDialog
        open
        onOpenChange={(next) => {
          if (!next) setGuideFor(null)
        }}
        hostname={guideDomain.hostname}
        method={methodFor(guideDomain, methodChoice)}
        metaSnippet={guideDomain.metaSnippet}
        fileName={guideDomain.fileName}
        downloadHref={`${base}/${guideDomain.id}/file`}
        fileHref={`https://${guideDomain.hostname}/${guideDomain.fileName ?? ""}`}
        checking={busy === `verify-${guideDomain.id}`}
        onCheck={() => {
          const target = guideDomain
          setGuideFor(null)
          void verify(target)
        }}
      />
    ) : null}

    <UnresolvedDomainsDialog
      domains={unresolved}
      open={promptUnresolved && unresolved.length > 0}
      onOpenChange={setPromptUnresolved}
      onRemove={() => {
        setPromptUnresolved(false)
        setReleaseTargets(unresolved)
      }}
    />

    <DomainReleaseDialog
      domains={releaseTargets}
      open={releaseTargets.length > 0}
      busy={busy === "release-many" || releaseTargets.some((d) => busy === `release-${d.id}`)}
      onCancel={() => setReleaseTargets([])}
      onConfirm={() => void release(releaseTargets)}
    />

    {released.length ? (
      <div className="text-[11px] text-muted-foreground">
        <p className="font-medium">Removed claims</p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {released.map((domain) => (
            <li key={domain.id}>
              {domain.hostname} — removed {formatDate(domain.updatedAt)}
            </li>
          ))}
        </ul>
      </div>
    ) : null}
    </div>
  )
}
