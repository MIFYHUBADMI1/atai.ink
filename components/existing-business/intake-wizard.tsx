"use client"

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Globe,
  ListChecks,
  Loader2,
  Minus,
  PlugZap,
  ShieldCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { jsonFetcher, postJson } from "@/lib/client/api"
import { INTAKE_SOURCE_ERROR, parseIntakeWebsite } from "@/lib/existing-business/source-rule"
import { cn } from "@/lib/utils"
import { CreditsShortfallDialog, TOP_UP_HREF, type JourneyCost } from "./credits-shortfall-dialog"

export interface WizardObjective {
  id: string
  label: string
  blurb: string
}

type IconType = ComponentType<{ className?: string }>

const STEPS: Array<{ label: string; short: string; icon: IconType }> = [
  { label: "Your application", short: "Where it already runs", icon: Globe },
  { label: "Your business", short: "In your own words", icon: Building2 },
  { label: "Goals & review", short: "Confirm and connect", icon: ListChecks },
]

const DESCRIPTION_MAX = 4000
const CONTEXT_MAX = 4000
const CUSTOMERS_MAX = 2000

function Chip({ tone, children }: { tone: "ok" | "todo" | "warn"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
        tone === "ok" && "border-success/30 bg-success/10 text-success",
        tone === "todo" && "border-border bg-secondary/60 text-muted-foreground",
        tone === "warn" && "border-primary/30 bg-primary/10 text-primary",
      )}
    >
      {children}
    </span>
  )
}

function FieldLabel({
  htmlFor,
  children,
  chip,
}: {
  htmlFor: string
  children: ReactNode
  chip?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Label htmlFor={htmlFor}>{children}</Label>
      {chip}
    </div>
  )
}

export function ExistingBusinessWizard({ objectives }: { objectives: WizardObjective[] }) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One key per wizard visit: a retried submit reuses the same business.
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  const [displayName, setDisplayName] = useState("")
  const [description, setDescription] = useState("")
  const [targetCustomers, setTargetCustomers] = useState("")
  const [additionalContext, setAdditionalContext] = useState("")
  const [websiteUrl, setWebsiteUrl] = useState("")
  const [chosen, setChosen] = useState<string[]>([])
  // The price of the whole journey, fetched once so the review step can state
  // it before the founder presses Connect.
  const [journeyCost, setJourneyCost] = useState<JourneyCost | null>(null)
  const [shortfall, setShortfall] = useState<JourneyCost | null>(null)

  useEffect(() => {
    let cancelled = false
    jsonFetcher<JourneyCost>("/api/billing/business-connect")
      .then((cost) => {
        if (!cancelled) setJourneyCost(cost)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const website = useMemo(() => parseIntakeWebsite(websiteUrl), [websiteUrl])
  const websiteTypedButUnusable = websiteUrl.trim().length > 0 && !website
  const hasDescription = description.trim().length > 0
  /** The gate: a business only exists for Atai once its live application is known. */
  const hasRealSource = Boolean(website)

  const reviewName = useMemo(() => {
    if (displayName.trim()) return displayName.trim()
    if (website) return website.hostname
    return "My existing business"
  }, [displayName, website])

  function toggleObjective(id: string) {
    setChosen((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))
  }

  function goTo(index: number) {
    setError(null)
    setStep(Math.max(0, Math.min(index, STEPS.length - 1)))
  }

  function next() {
    setError(null)
    if (step === 0 && !hasRealSource) {
      setError(INTAKE_SOURCE_ERROR)
      return
    }
    goTo(step + 1)
  }

  async function submit() {
    if (busy) return
    if (!hasRealSource) {
      setError(INTAKE_SOURCE_ERROR)
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Ask before creating: a founder who cannot pay for the journey is told
      // the whole number here, not stage by stage after the fact.
      const cost = await jsonFetcher<JourneyCost>("/api/billing/business-connect").catch(() => null)
      if (cost) setJourneyCost(cost)
      if (cost && cost.shortfall > 0) {
        setShortfall(cost)
        setBusy(false)
        return
      }
      const { project } = await postJson<{ project: { id: string } }>("/api/projects", {
        mode: "scratch",
        startingPoint: "existing_business",
        name: reviewName,
        idempotencyKey,
        intake: {
          displayName: displayName.trim() || undefined,
          description: description.trim() || undefined,
          targetCustomers: targetCustomers.trim() || undefined,
          additionalContext: additionalContext.trim() || undefined,
          objectives: chosen,
          websiteUrl: website?.url,
        },
      })
      router.push(`/project/${project.id}/business`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect your business. Please try again.")
      setBusy(false)
    }
  }

  const current = STEPS[step]
  const CurrentIcon = current.icon

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
      <div className="min-w-0" data-atai-tour="existing-business-wizard">
        <section
          key={step}
          className="rounded-2xl border border-border/80 bg-card/90 p-5 sm:p-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-300 motion-reduce:animate-none"
        >
          <header className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-4">
              <CurrentIcon />
            </span>
            <div className="min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Step {step + 1} of {STEPS.length}
              </p>
              <h2 className="mt-1 text-xl font-medium tracking-tight sm:text-2xl">
                {step === 0 && "Where does your application already run?"}
                {step === 1 && "Tell Atai about the business behind it"}
                {step === 2 && "What should Atai work on first?"}
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                {step === 0 &&
                  "Atai connects to an application you already run — it does not build or replace one. This address is how it finds your business."}
                {step === 1 &&
                  "Your own words steer everything Atai advises. Anything not written here or read from your site is labelled as an assumption, never as a fact."}
                {step === 2 &&
                  "Pick the goals that matter now, then check what Atai will read and what it will not touch."}
              </p>
            </div>
          </header>

          <div className="mt-6">
            {step === 0 ? (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <FieldLabel
                    htmlFor="eb-website"
                    chip={
                      hasRealSource ? (
                        <Chip tone="ok">
                          <Check className="size-3" />
                          Address confirmed
                        </Chip>
                      ) : (
                        <Chip tone="warn">Required</Chip>
                      )
                    }
                  >
                    Live application address
                  </FieldLabel>
                  <Input
                    id="eb-website"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value.slice(0, 500))}
                    placeholder="app.yourbusiness.com"
                    inputMode="url"
                    autoComplete="url"
                    maxLength={500}
                    aria-invalid={websiteTypedButUnusable || undefined}
                    className={cn("h-10", website && "border-success/50")}
                  />
                  {website ? (
                    <p className="flex items-center gap-1.5 text-[11px] leading-relaxed text-success">
                      <CheckCircle2 className="size-3.5 shrink-0" />
                      Atai will read a few public pages of {website.hostname} — nothing else.
                    </p>
                  ) : websiteTypedButUnusable ? (
                    <p className="text-[11px] leading-relaxed text-destructive">
                      That is not a web address yet. Try the full hostname, like app.yourbusiness.com or
                      https://app.yourbusiness.com.
                    </p>
                  ) : (
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Reading uses Atai credits, and a retry within 7 days reuses the cached read at no extra cost.
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-border/80 bg-secondary/40 p-4">
                  <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    <PlugZap className="size-3.5 text-primary" />
                    Connecting is not building
                  </p>
                  <ul className="mt-2 flex flex-col gap-1.5 text-xs leading-relaxed text-muted-foreground">
                    <li>Your application keeps running exactly where it is. Nothing is copied, rebuilt or deployed.</li>
                    <li>Atai never edits your code, database or hosting from this screen.</li>
                    <li>If you would rather bring a repository into Atai to build from, that is a different starting point — not this one.</li>
                  </ul>
                </div>

                <div className="rounded-xl border border-border/80 bg-background/50 p-4">
                  <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    <ShieldCheck className="size-3.5 text-primary" />
                    Proving the site is the next step — about two minutes
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    After your first read, Atai asks for one small meta tag or file on your site. That proof is what
                    lets a connection count as verified, and it is an Atai ownership check — not Google Search Console
                    verification.
                  </p>
                </div>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="flex flex-col gap-5">
                <div className="grid gap-4 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                  <div className="flex flex-col gap-2">
                    <FieldLabel htmlFor="eb-name">Business name</FieldLabel>
                    <Input
                      id="eb-name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value.slice(0, 120))}
                      placeholder="e.g. Corner Bakery"
                      maxLength={120}
                      autoComplete="organization"
                    />
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Optional — leave it blank and Atai names the business from your application address.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <FieldLabel
                      htmlFor="eb-description"
                      chip={
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {description.length}/{DESCRIPTION_MAX}
                        </span>
                      }
                    >
                      What does your business do?
                    </FieldLabel>
                    <Textarea
                      id="eb-description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
                      placeholder="What you sell, who buys it, how it runs today, and what feels stuck."
                      rows={6}
                      maxLength={DESCRIPTION_MAX}
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-border/70 bg-secondary/30 p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    Useful detail (optional)
                  </p>
                  <div className="mt-3 flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="eb-customers">Who are your customers?</Label>
                      <Textarea
                        id="eb-customers"
                        value={targetCustomers}
                        onChange={(e) => setTargetCustomers(e.target.value.slice(0, CUSTOMERS_MAX))}
                        rows={2}
                        maxLength={CUSTOMERS_MAX}
                        placeholder="e.g. office managers in the city centre who order lunch weekly"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="eb-context">Anything else Atai should know?</Label>
                      <Textarea
                        id="eb-context"
                        value={additionalContext}
                        onChange={(e) => setAdditionalContext(e.target.value.slice(0, CONTEXT_MAX))}
                        rows={3}
                        maxLength={CONTEXT_MAX}
                        placeholder="Constraints, seasonality, what you have already tried…"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="flex flex-col gap-6">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      Goals — pick as many as apply
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {chosen.length}/{objectives.length} selected
                      </span>
                      {chosen.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => setChosen([])}
                          className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                    {objectives.map((objective) => {
                      const on = chosen.includes(objective.id)
                      return (
                        <li key={objective.id}>
                          <label
                            className={cn(
                              "flex h-full cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                              on
                                ? "border-primary/50 bg-primary/5"
                                : "border-border/80 bg-card hover:border-primary/30 hover:bg-accent/40",
                            )}
                          >
                            <Checkbox
                              checked={on}
                              onCheckedChange={() => toggleObjective(objective.id)}
                              className="mt-0.5"
                              aria-label={objective.label}
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium">{objective.label}</span>
                              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                                {objective.blurb}
                              </span>
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </div>

                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    What Atai will read
                  </p>
                  <ul className="mt-3 flex flex-col divide-y divide-border/70 overflow-hidden rounded-xl border border-border/80 bg-card">
                    <ReviewRow
                      label="Application"
                      value={website ? website.hostname : "Not provided"}
                      detail={website ? "A few public pages, read-only" : "Required to connect"}
                      tone={website ? "ok" : "muted"}
                      onEdit={() => goTo(0)}
                    />
                    <ReviewRow
                      label="Business"
                      value={reviewName}
                      detail={displayName.trim() ? "Named by you" : "Derived from your address"}
                      tone="ok"
                    />
                    <ReviewRow
                      label="Your description"
                      value={hasDescription ? `${description.trim().length} characters` : "Not provided"}
                      detail={hasDescription ? "Plus any optional detail you added" : "Your words still help"}
                      tone={hasDescription ? "ok" : "muted"}
                      onEdit={() => goTo(1)}
                    />
                    <ReviewRow
                      label="Goals"
                      value={chosen.length ? `${chosen.length} selected` : "None selected"}
                      detail={chosen.length ? "Priorities are drawn from these" : "Priorities will be inferred from the evidence"}
                      tone={chosen.length ? "ok" : "muted"}
                    />
                  </ul>
                </div>

                {!hasRealSource ? (
                  <div
                    role="alert"
                    className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <p className="flex min-w-0 items-start gap-2 text-xs leading-relaxed text-destructive">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      Nothing is connected yet. Atai will not assess a business it cannot see — add your live
                      application address.
                    </p>
                    <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => goTo(0)}>
                      Add address
                    </Button>
                  </div>
                ) : null}

                <p className="text-xs leading-relaxed text-muted-foreground">
                  {journeyCost
                    ? `Connecting costs ${journeyCost.required.toLocaleString()} credits — ${journeyCost.readCost.toLocaleString()} to read your live site and ${journeyCost.assessmentCost.toLocaleString()} for your co-founder's first read. A failed read is refunded in full, and a page Atai read in the last 7 days is never charged twice.`
                    : "Connecting uses Atai credits: one read of your live site, then your co-founder's first read. A failed read is refunded in full."}
                </p>

                {journeyCost && journeyCost.shortfall > 0 ? (
                  <div
                    role="alert"
                    className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-4 text-xs leading-relaxed sm:flex-row sm:items-center sm:justify-between"
                  >
                    <p className="text-foreground">
                      Your balance covers {journeyCost.available.toLocaleString()} of the{" "}
                      {journeyCost.required.toLocaleString()} credits. Add{" "}
                      {journeyCost.shortfall.toLocaleString()} to connect without stopping halfway.
                    </p>
                    <Button variant="outline" size="sm" className="shrink-0" render={<Link href={TOP_UP_HREF} />}>
                      Add credits
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        {error ? (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm leading-6 text-destructive motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200 motion-reduce:animate-none"
          >
            <AlertTriangle className="mt-1 size-4 shrink-0" />
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => (step === 0 ? router.push("/new") : goTo(step - 1))}
            disabled={busy}
            className="sm:w-auto"
          >
            <ArrowLeft className="size-4" />
            {step === 0 ? "All starting points" : "Back"}
          </Button>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <p className="text-right text-[11px] leading-5 text-muted-foreground">
              {step === STEPS.length - 1
                ? hasRealSource
                  ? "Connects the business and starts the reading."
                  : "Locked until your application address is added."
                : `Step ${step + 1} of ${STEPS.length}`}
            </p>
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={next} className="h-10">
                Continue
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button type="button" onClick={submit} disabled={busy || !hasRealSource} className="h-10">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                {busy ? "Connecting your business…" : "Connect my business"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-36">
        <nav aria-label="Progress" className="rounded-2xl border border-border/80 bg-card/90 p-5">
          <p className="pb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Where you are</p>
          <ol className="relative flex flex-col gap-4">
            <span aria-hidden className="absolute left-[15px] top-3 bottom-3 w-px bg-border" />
            {STEPS.map((item, index) => {
              const visited = index < step
              /** A step you walked past with nothing in it is not a completed step. */
              const filled =
                (index === 0 && Boolean(website)) ||
                (index === 1 && (hasDescription || displayName.trim().length > 0)) ||
                (index === 2 && chosen.length > 0)
              const done = visited && filled
              const now = index === step
              return (
                <li key={item.label} className="relative flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => visited && goTo(index)}
                    disabled={!visited}
                    aria-current={now ? "step" : undefined}
                    className={cn(
                      "relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full border font-mono text-xs transition-colors",
                      done && "cursor-pointer border-primary/40 bg-primary/10 text-primary hover:bg-primary/20",
                      now && "border-primary bg-primary text-primary-foreground",
                      !now && !done && "border-border bg-card text-muted-foreground",
                      visited && !done && "cursor-pointer hover:bg-accent",
                    )}
                  >
                    {done ? <Check className="size-3.5" /> : index + 1}
                  </button>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <item.icon className={cn("size-3.5", now ? "text-primary" : "text-muted-foreground/70")} />
                      <p className={cn("text-sm", now ? "font-semibold" : "font-medium text-muted-foreground")}>
                        {item.label}
                      </p>
                      {now ? (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-primary">
                          Now
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.short}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        </nav>

        <div className="rounded-2xl border border-border/80 bg-card/90 p-5">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Connected so far
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-xs">
            <SourceLine ok={Boolean(website)} label="Application" value={website?.hostname} />
            <li className="mt-1 border-t border-border/60 pt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              Supporting detail
            </li>
            <SourceLine ok={hasDescription} label="Your description" value={hasDescription ? `${description.trim().length} chars` : undefined} extra />
          </ul>
          <p
            className={cn(
              "mt-3 flex items-start gap-1.5 border-t border-border/70 pt-3 text-[11px] leading-5",
              hasRealSource ? "text-muted-foreground" : "text-destructive",
            )}
          >
            {hasRealSource ? (
              <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-success" />
            ) : (
              <Minus className="mt-0.5 size-3 shrink-0" />
            )}
            {hasRealSource
              ? "A live application is connected — Atai has something to read."
              : "Your live application address is required to finish."}
          </p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-card/90 p-5">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Connected, not rebuilt
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your application keeps running where it is. Atai collects evidence, writes an honest first assessment,
            and you decide what happens next. No build is started for a connected business.
          </p>
        </div>
      </aside>

      <CreditsShortfallDialog
        open={shortfall !== null}
        onOpenChange={(next) => {
          if (!next) setShortfall(null)
        }}
        cost={shortfall}
        businessName={reviewName}
        stepLabel={STEPS[STEPS.length - 1].label}
        stepHint="Nothing has been created yet — your answers stay on this page, and the read starts the moment the credits land."
      />
    </div>
  )
}

function ReviewRow({
  label,
  value,
  detail,
  tone,
  onEdit,
}: {
  label: string
  value: string
  detail: string
  tone: "ok" | "muted"
  onEdit?: () => void
}) {
  return (
    <li className="flex items-start justify-between gap-4 bg-card px-3.5 py-2.5">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              tone === "ok" ? "bg-success" : "bg-muted-foreground/40",
            )}
          />
          {label}
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        <p className={cn("max-w-[10rem] truncate text-right text-sm", tone === "ok" ? "text-foreground" : "text-muted-foreground")}>
          {value}
        </p>
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
          >
            Edit
          </button>
        ) : null}
      </div>
    </li>
  )
}

function SourceLine({ ok, label, value, extra }: { ok: boolean; label: string; value?: string; extra?: boolean }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        {ok ? (
          <CheckCircle2 className={cn("size-3.5 shrink-0", extra ? "text-primary" : "text-success")} />
        ) : (
          <span aria-hidden className="size-3.5 shrink-0 rounded-full border border-dashed border-border" />
        )}
        <span className="truncate">{label}</span>
      </span>
      <span
        className={cn(
          "shrink-0 font-mono text-[10px]",
          ok ? (extra ? "text-primary" : "text-success") : "text-muted-foreground",
        )}
      >
        {ok && value ? value : extra ? "supporting" : "—"}
      </span>
    </li>
  )
}
