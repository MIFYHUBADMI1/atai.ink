"use client"

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ExternalLink,
  Globe,
  ListChecks,
  Loader2,
  Minus,
  ShieldCheck,
} from "lucide-react"
import { GitHubIcon } from "@/components/github-icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { jsonFetcher, postJson } from "@/lib/client/api"
import { INTAKE_SOURCE_ERROR, parseIntakeWebsite } from "@/lib/existing-business/source-rule"
import { cn } from "@/lib/utils"

export interface WizardObjective {
  id: string
  label: string
  blurb: string
}

interface RepoOption {
  fullName: string
  name: string
  owner: string
  defaultBranch: string
  private: boolean
}

type IconType = ComponentType<{ className?: string }>

const STEPS: Array<{ label: string; short: string; icon: IconType }> = [
  { label: "Your business", short: "Your words", icon: Building2 },
  { label: "Your website", short: "Where customers find you", icon: Globe },
  { label: "Your code", short: "The repository behind it", icon: GitHubIcon },
  { label: "Goals & review", short: "Confirm and hand over", icon: ListChecks },
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
  const [githubOwner, setGithubOwner] = useState("")
  const [githubRepo, setGithubRepo] = useState("")
  const [githubBranch, setGithubBranch] = useState("")
  const [chosen, setChosen] = useState<string[]>([])

  const [repos, setRepos] = useState<RepoOption[] | null>(null)
  const [reposError, setReposError] = useState<string | null>(null)
  const [reposLoading, setReposLoading] = useState(false)

  useEffect(() => {
    if (step !== 2 || repos !== null || reposLoading) return
    setReposLoading(true)
    jsonFetcher<{ repos: RepoOption[] }>("/api/github/repos")
      .then((data) => setRepos(data.repos))
      .catch((e) => {
        setRepos([])
        setReposError(e instanceof Error ? e.message : "Could not list your repositories.")
      })
      .finally(() => setReposLoading(false))
  }, [step, repos, reposLoading])

  const website = useMemo(() => parseIntakeWebsite(websiteUrl), [websiteUrl])
  const websiteTypedButUnusable = websiteUrl.trim().length > 0 && !website
  const hasRepo = githubOwner.trim().length > 0 && githubRepo.trim().length > 0
  const hasDescription = description.trim().length > 0
  /** The gate: a business only exists for Atai once a domain or a repository is in play. */
  const hasRealSource = Boolean(website) || hasRepo

  const reviewName = useMemo(() => {
    if (displayName.trim()) return displayName.trim()
    if (website) return website.hostname
    if (hasRepo) return `${githubOwner.trim()}/${githubRepo.trim()}`
    return "My existing business"
  }, [displayName, website, hasRepo, githubOwner, githubRepo])

  function toggleObjective(id: string) {
    setChosen((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))
  }

  function goTo(index: number) {
    setError(null)
    setStep(Math.max(0, Math.min(index, STEPS.length - 1)))
  }

  function next() {
    setError(null)
    if ((step === 1 || step === 2) && !hasRealSource) {
      setError(
        step === 1
          ? `${INTAKE_SOURCE_ERROR} Add your website above, or continue to your code and add a repository.`
          : `${INTAKE_SOURCE_ERROR} Pick or type a repository here, or go back and add your website.`,
      )
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
          websiteUrl: website?.url ?? (websiteUrl.trim() || undefined),
          githubOwner: githubOwner.trim() || undefined,
          githubRepo: githubRepo.trim() || undefined,
          githubBranch: githubBranch.trim() || undefined,
        },
      })
      router.push(`/project/${project.id}/business`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not bring your business to Atai. Please try again.")
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
                {step === 0 && "Tell us about the business you already run"}
                {step === 1 && "Where do customers find you online?"}
                {step === 2 && "Is there code behind the business?"}
                {step === 3 && "What should Atai work on first?"}
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                {step === 0 &&
                  "Your own words steer the assessment. Atai never invents facts about your business — anything not written here or read from your website or repository is labelled as an assumption."}
                {step === 1 &&
                  "Atai reads a few public pages as evidence. It does not copy, rebuild or edit your site — and this is one of the two sources it needs to see a real business."}
                {step === 2 &&
                  "Read-only evidence: Atai lists files and reads the README and manifests with your connected GitHub account. Nothing is cloned, pushed or executed, and no access token is ever asked for here."}
                {step === 3 &&
                  "Pick the goals that matter now, then check what Atai will read. Every recommendation links only to screens that exist and are switched on for you."}
              </p>
            </div>
          </header>

          <div className="mt-6">
            {step === 0 ? (
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
                    <p className="text-[11px] leading-relaxed text-muted-foreground">Optional — leave it blank and Atai names the business from your website or repository.</p>
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

                <p className="flex items-start gap-2 rounded-xl border border-border/70 bg-background/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  This step is description only — the source Atai needs comes next. A website address or a repository
                  proves there is a business to read, so keep going and add one of the two.
                </p>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <FieldLabel
                    htmlFor="eb-website"
                    chip={
                      hasRealSource ? (
                        <Chip tone="ok">
                          <Check className="size-3" />
                          Source covered
                        </Chip>
                      ) : (
                        <Chip tone="warn">Required — unless you add a repository</Chip>
                      )
                    }
                  >
                    Website address
                  </FieldLabel>
                  <Input
                    id="eb-website"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value.slice(0, 500))}
                    placeholder="yourbusiness.com"
                    inputMode="url"
                    autoComplete="url"
                    maxLength={500}
                    aria-invalid={websiteTypedButUnusable || undefined}
                    className={cn("h-10", website && "border-success/50")}
                  />
                  {website ? (
                    <p className="flex items-center gap-1.5 text-[11px] leading-relaxed text-success">
                      <CheckCircle2 className="size-3.5 shrink-0" />
                      Atai will read {website.hostname} — a few public pages, nothing else.
                    </p>
                  ) : websiteTypedButUnusable ? (
                    <p className="text-[11px] leading-relaxed text-destructive">
                      That is not a web address yet. Try the full hostname, like yourbusiness.com or
                      https://yourbusiness.com.
                    </p>
                  ) : (
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Include the domain only — no need for tracking parameters. Reading uses Atai credits, and a
                      retry within 7 days reuses the cached read at no extra cost.
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-border/80 bg-secondary/40 p-4">
                  <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    <ShieldCheck className="size-3.5 text-primary" />
                    Ownership comes later, and it is optional
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    After intake you can verify the domain with a small meta tag or file. Verification never blocks
                    your business profile. It is an Atai ownership check — not Google Search Console verification.
                  </p>
                </div>

                <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-background/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
                    No website at all? That is fine — a repository works instead. Atai still needs one of the two
                    before it will assess a business.
                  </p>
                  <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => goTo(2)}>
                    Go to your code
                    <ArrowRight className="size-3.5" />
                  </Button>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-center gap-2">
                  {hasRealSource ? (
                    <Chip tone="ok">
                      <Check className="size-3" />
                      Source requirement covered{website ? ` by ${website.hostname}` : ""}
                    </Chip>
                  ) : (
                    <Chip tone="warn">Required — this is your only remaining source</Chip>
                  )}
                  {website ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <ExternalLink className="size-3" />
                      Website already added: {website.hostname}
                    </span>
                  ) : null}
                </div>

                {reposLoading ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Loading your repositories…
                  </p>
                ) : null}

                {repos && repos.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="eb-repo-picker">Pick a repository</Label>
                    <select
                      id="eb-repo-picker"
                      className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
                      value={githubOwner && githubRepo ? `${githubOwner}/${githubRepo}` : ""}
                      onChange={(e) => {
                        const picked = repos.find((r) => r.fullName === e.target.value)
                        if (picked) {
                          setGithubOwner(picked.owner)
                          setGithubRepo(picked.name)
                          setGithubBranch(picked.defaultBranch)
                        } else {
                          setGithubOwner("")
                          setGithubRepo("")
                          setGithubBranch("")
                        }
                      }}
                    >
                      <option value="">Don&apos;t add a repository</option>
                      {repos.map((repo) => (
                        <option key={repo.fullName} value={repo.fullName}>
                          {repo.fullName}
                          {repo.private ? " (private)" : ""}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      A private repository is read the same way: metadata, the file list, the README and manifests —
                      with your own GitHub connection.
                    </p>
                  </div>
                ) : null}

                {reposError ? (
                  <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
                    {reposError} Connect GitHub in{" "}
                    <Link href="/settings/profile" className="underline underline-offset-2">
                      settings
                    </Link>{" "}
                    and come back, or type the repository details below.
                  </p>
                ) : null}

                {repos && repos.length === 0 && !reposError && !reposLoading ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    No repositories were found on the connected GitHub account. Type the details below if you know
                    them, or connect the right account in{" "}
                    <Link href="/settings/profile" className="underline underline-offset-2">
                      settings
                    </Link>
                    .
                  </p>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="eb-gh-owner">Owner</Label>
                    <Input
                      id="eb-gh-owner"
                      value={githubOwner}
                      onChange={(e) => setGithubOwner(e.target.value.slice(0, 100))}
                      placeholder="your-account"
                      maxLength={100}
                      className="h-10"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="eb-gh-repo">Repository</Label>
                    <Input
                      id="eb-gh-repo"
                      value={githubRepo}
                      onChange={(e) => setGithubRepo(e.target.value.slice(0, 100))}
                      placeholder="your-repo"
                      maxLength={100}
                      className="h-10"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <FieldLabel
                    htmlFor="eb-gh-branch"
                    chip={<span className="font-mono text-[10px] text-muted-foreground">optional</span>}
                  >
                    Branch
                  </FieldLabel>
                  <Input
                    id="eb-gh-branch"
                    value={githubBranch}
                    onChange={(e) => setGithubBranch(e.target.value.slice(0, 100))}
                    placeholder="main"
                    maxLength={100}
                  />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Leave blank and Atai reads the default branch it sees on the repository.
                  </p>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
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
                      label="Business"
                      value={reviewName}
                      detail={displayName.trim() ? "Named by you" : "Derived from your source"}
                      tone="ok"
                    />
                    <ReviewRow
                      label="Website"
                      value={website ? website.hostname : "Not provided"}
                      detail={website ? "Public pages, read-only" : "Add one if you have it"}
                      tone={website ? "ok" : "muted"}
                      onEdit={() => goTo(1)}
                    />
                    <ReviewRow
                      label="Repository"
                      value={hasRepo ? `${githubOwner.trim()}/${githubRepo.trim()}` : "Not provided"}
                      detail={hasRepo ? `${githubBranch.trim() || "default branch"}, files and README only` : "Optional"}
                      tone={hasRepo ? "ok" : "muted"}
                      onEdit={() => goTo(2)}
                    />
                    <ReviewRow
                      label="Your description"
                      value={hasDescription ? `${description.trim().length} characters` : "Not provided"}
                      detail={hasDescription ? "Plus any optional detail you added" : "Your words still help"}
                      tone={hasDescription ? "ok" : "muted"}
                      onEdit={() => goTo(0)}
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
                      Nothing real is connected yet. Atai will not assess a business it cannot see — add a website
                      address or a repository.
                    </p>
                    <div className="flex shrink-0 gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => goTo(1)}>
                        Add website
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => goTo(2)}>
                        Add repository
                      </Button>
                    </div>
                  </div>
                ) : null}

                <p className="text-xs leading-relaxed text-muted-foreground">
                  The co-founder assessment uses Atai credits (the same cost as a plan analysis). If it cannot run,
                  your collected evidence is saved and any charge is refunded — nothing is invented.
                </p>
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
              {step === 3
                ? hasRealSource
                  ? "Creates the business and starts the reading."
                  : "Locked until a website or repository is added."
                : `Step ${step + 1} of ${STEPS.length}`}
            </p>
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={next} className="h-10">
                Continue
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button type="button" onClick={submit} disabled={busy || !hasRealSource} className="h-10">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" />}
                {busy ? "Bringing your business to Atai…" : "Analyze and bring my business to Atai"}
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
                (index === 0 && (hasDescription || displayName.trim().length > 0)) ||
                (index === 1 && Boolean(website)) ||
                (index === 2 && hasRepo) ||
                (index === 3 && chosen.length > 0)
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
            Sources so far
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-xs">
            <SourceLine ok={Boolean(website)} label="Website" value={website?.hostname} />
            <SourceLine ok={hasRepo} label="Repository" value={hasRepo ? `${githubOwner.trim()}/${githubRepo.trim()}` : undefined} />
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
              ? "A real source is connected — Atai has something to read."
              : "A website or a repository is required to finish."}
          </p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-card/90 p-5">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Read, not rebuilt
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your site stays yours and your repository is never executed. Atai collects evidence, writes an honest
            first assessment, and you decide what happens next.
          </p>
        </div>
      </aside>
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
