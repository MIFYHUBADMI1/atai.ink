"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, ArrowRight, Building2, Check, Globe, Loader2, ShieldCheck } from "lucide-react"
import { GitHubIcon } from "@/components/github-icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { jsonFetcher, postJson } from "@/lib/client/api"
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

const STEPS = ["Your business", "Your website", "Your code", "Goals & review"] as const

const DESCRIPTION_MAX = 4000
const CONTEXT_MAX = 4000
const CUSTOMERS_MAX = 2000

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

  const hasAnySource = description.trim().length > 0 || websiteUrl.trim().length > 0 || (githubOwner.trim().length > 0 && githubRepo.trim().length > 0)

  const reviewName = useMemo(() => {
    if (displayName.trim()) return displayName.trim()
    if (websiteUrl.trim()) {
      try {
        return new URL(websiteUrl.trim().startsWith("http") ? websiteUrl.trim() : `https://${websiteUrl.trim()}`).hostname
      } catch {
        return "My existing business"
      }
    }
    if (githubOwner.trim() && githubRepo.trim()) return `${githubOwner.trim()}/${githubRepo.trim()}`
    return "My existing business"
  }, [displayName, websiteUrl, githubOwner, githubRepo])

  function toggleObjective(id: string) {
    setChosen((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))
  }

  function next() {
    setError(null)
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  async function submit() {
    if (busy) return
    if (!hasAnySource) {
      setError("At least one source is needed: a description, a website, or a repository.")
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
          websiteUrl: websiteUrl.trim() || undefined,
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

  return (
    <div className="mx-auto w-full max-w-3xl">
      <ol aria-label="Progress" className="flex flex-wrap items-center gap-2">
        {STEPS.map((label, index) => (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={index === step ? "step" : undefined}
              className={cn(
                "flex size-7 items-center justify-center rounded-full border font-mono text-[11px] font-semibold",
                index < step && "border-primary/40 bg-primary/10 text-primary",
                index === step && "border-primary bg-primary text-primary-foreground",
                index > step && "border-border bg-card text-muted-foreground",
              )}
            >
              {index < step ? <Check className="size-3.5" /> : index + 1}
            </span>
            <span className={cn("text-xs", index === step ? "font-medium text-foreground" : "text-muted-foreground")}>
              {label}
            </span>
            {index < STEPS.length - 1 ? <span aria-hidden className="hidden h-px w-4 bg-border sm:block" /> : null}
          </li>
        ))}
      </ol>

      <div className="mt-6">
        {step === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="size-4 text-primary" />
                Tell us about the business you already run
              </CardTitle>
              <CardDescription>
                Your own words are a first-class source. Atai never invents facts about your business — anything not
                written here or read from your website/repository is labelled as an assumption.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="eb-name">Business name (optional)</Label>
                <Input
                  id="eb-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value.slice(0, 120))}
                  placeholder="e.g. Corner Bakery"
                  maxLength={120}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="eb-description">What does your business do?</Label>
                <Textarea
                  id="eb-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
                  placeholder="What you sell, who buys it, how it runs today, and what feels stuck."
                  rows={5}
                  maxLength={DESCRIPTION_MAX}
                />
                <p className="text-[11px] text-muted-foreground">
                  {description.length}/{DESCRIPTION_MAX} — a website or repository can stand in for this if you add one next.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="eb-customers">Who are your customers? (optional)</Label>
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
                <Label htmlFor="eb-context">Anything else Atai should know? (optional)</Label>
                <Textarea
                  id="eb-context"
                  value={additionalContext}
                  onChange={(e) => setAdditionalContext(e.target.value.slice(0, CONTEXT_MAX))}
                  rows={3}
                  maxLength={CONTEXT_MAX}
                  placeholder="Constraints, seasonality, what you have already tried…"
                />
              </div>
            </CardContent>
          </Card>
        ) : null}

        {step === 1 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Globe className="size-4 text-primary" />
                Your live website (optional)
              </CardTitle>
              <CardDescription>
                Atai reads a few pages of your public site as evidence — it does not copy, rebuild or edit it. Reading
                uses Atai credits, and a retry within 7 days reuses the cached read at no extra cost.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="eb-website">Website address</Label>
                <Input
                  id="eb-website"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value.slice(0, 500))}
                  placeholder="yourbusiness.com"
                  inputMode="url"
                  autoComplete="url"
                  maxLength={500}
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Leave this empty if you don&apos;t have a website — your business can still be brought to Atai. If the
                  site can&apos;t be read, the rest of the intake continues and the reason is shown honestly.
                </p>
              </div>
              <div className="rounded-xl border border-border/80 bg-secondary/40 p-3 text-xs leading-relaxed text-muted-foreground">
                <ShieldCheck className="mr-1.5 inline size-3.5 text-primary" />
                After intake, you can verify you own this domain with a small meta tag or file. Verification is optional
                and never blocks your business profile. It is an Atai ownership check — not Google Search Console
                verification.
              </div>
            </CardContent>
          </Card>
        ) : null}

        {step === 2 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <GitHubIcon className="size-4" />
                Your code repository (optional)
              </CardTitle>
              <CardDescription>
                Read-only evidence: Atai lists files and reads the README and manifests with your connected GitHub
                account. Nothing is cloned, pushed or executed, and no access token is ever asked for here.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
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
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                    <option value="">No repository — skip this</option>
                    {repos.map((repo) => (
                      <option key={repo.fullName} value={repo.fullName}>
                        {repo.fullName}
                        {repo.private ? " (private)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {reposError ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {reposError} You can connect GitHub in{" "}
                  <Link href="/settings/profile" className="underline underline-offset-2">
                    settings
                  </Link>{" "}
                  and come back, or type the repository details below.
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
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="eb-gh-branch">Branch (optional)</Label>
                <Input
                  id="eb-gh-branch"
                  value={githubBranch}
                  onChange={(e) => setGithubBranch(e.target.value.slice(0, 100))}
                  placeholder="main"
                  maxLength={100}
                />
              </div>
            </CardContent>
          </Card>
        ) : null}

        {step === 3 ? (
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">What do you want to work on?</CardTitle>
                <CardDescription>
                  Pick the goals that matter now. Every recommendation links only to screens that exist and are
                  switched on for you — nothing is promised that Atai cannot do.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {objectives.map((objective) => (
                    <li key={objective.id}>
                      <label
                        className={cn(
                          "flex h-full cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                          chosen.includes(objective.id)
                            ? "border-primary/50 bg-primary/5"
                            : "border-border/80 bg-card hover:border-primary/30",
                        )}
                      >
                        <Checkbox
                          checked={chosen.includes(objective.id)}
                          onCheckedChange={() => toggleObjective(objective.id)}
                          className="mt-0.5"
                          aria-label={objective.label}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{objective.label}</span>
                          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{objective.blurb}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Review</CardTitle>
                <CardDescription>Atai will read only what is listed here, then the co-founder writes the first assessment.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Business</dt>
                    <dd className="text-right font-medium">{reviewName}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Your description</dt>
                    <dd className="text-right">{description.trim() ? `${description.trim().length} characters` : "Not provided"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Website</dt>
                    <dd className="text-right">{websiteUrl.trim() || "Not provided"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Repository</dt>
                    <dd className="text-right">
                      {githubOwner.trim() && githubRepo.trim() ? `${githubOwner.trim()}/${githubRepo.trim()}` : "Not provided"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Goals</dt>
                    <dd className="text-right">{chosen.length ? `${chosen.length} selected` : "None selected"}</dd>
                  </div>
                </dl>
                {!hasAnySource ? (
                  <p role="alert" className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
                    Atai needs at least one real source: go back and add a description, a website, or a repository.
                  </p>
                ) : null}
                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                  The co-founder assessment uses Atai credits (the same cost as a plan analysis). If it cannot run, your
                  collected evidence is saved and any charge is refunded — nothing is invented.
                </p>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => (step === 0 ? router.push("/new") : setStep((s) => Math.max(0, s - 1)))}
          disabled={busy}
        >
          <ArrowLeft className="size-4" />
          {step === 0 ? "All starting points" : "Back"}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button type="button" onClick={next}>
            Continue
            <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button type="button" onClick={submit} disabled={busy || !hasAnySource}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" />}
            {busy ? "Bringing your business to Atai…" : "Analyze and bring my business to Atai"}
          </Button>
        )}
      </div>
    </div>
  )
}