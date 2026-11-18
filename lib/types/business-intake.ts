import type { MirrorProject } from "./project"

/**
 * How the business entered Atai. Additive to `ProjectMode` (which describes the
 * technical initialization path and is branched on across creation, workspace
 * labels and the co-founder context) — never a replacement for it.
 */
export type BusinessStartingPoint = "from_scratch" | "existing_business"

/** Absent means pre-feature: every existing project started from an idea. */
export function businessStartingPointOf(
  project: Pick<MirrorProject, "startingPoint"> | null | undefined,
): BusinessStartingPoint {
  return project?.startingPoint === "existing_business" ? "existing_business" : "from_scratch"
}

/** The objective choices offered during existing-business intake. */
export type BusinessObjectiveId =
  | "acquire_customers"
  | "increase_revenue"
  | "improve_marketing"
  | "improve_website"
  | "understand_competitors"
  | "improve_retention"
  | "automate_operations"
  | "improve_finances"
  | "expand_markets"
  | "improve_performance"

export const BUSINESS_OBJECTIVE_IDS: readonly BusinessObjectiveId[] = [
  "acquire_customers",
  "increase_revenue",
  "improve_marketing",
  "improve_website",
  "understand_competitors",
  "improve_retention",
  "automate_operations",
  "improve_finances",
  "expand_markets",
  "improve_performance",
]

/**
 * Per-source outcome of an intake run. `partially_completed` means at least one
 * step succeeded and at least one failed — the successful evidence is kept.
 */
export type IntakeStageStatus =
  | "pending"
  | "processing"
  | "completed"
  | "partially_completed"
  | "failed"
  | "skipped"

export interface IntakeStage {
  status: IntakeStageStatus
  attemptedAt?: number
  completedAt?: number
  /** User-safe only. Never a stack trace, never an internal address. A stage
   * that later succeeded is cleared back to `null`, not left carrying an old
   * failure the founder has already overcome. */
  errorCode?: string | null
  errorMessage?: string | null
}

export interface IntakeWebsiteStage extends IntakeStage {
  url?: string
  pagesCrawled?: number
  /** True when the evidence came from the 7-day Firecrawl cache (no new spend). */
  fromCache?: boolean
}
export interface IntakeRepoStage extends IntakeStage {
  owner?: string
  repo?: string
  /** Recorded from a live `getRepo` call with the user's own token — never
   * inferred from the repository being publicly reachable. */
  accessVerified?: boolean
  private?: boolean
  filesListed?: number
  readmeChars?: number
  manifestsRead?: number
}

/**
 * What the founder told us, what we could read, and what the co-founder made of
 * it. Lives on the project document: it is business profile data, and it must
 * travel with the business it belongs to. Large crawl output is NOT stored here
 * — only references and counts.
 */
export interface BusinessIntake {
  collectedAt: number
  /** Single-writer guard for a background intake run. Claimed with one atomic
   * conditional update so a double-click or a restart cannot crawl and charge
   * twice. A `processing` stamp older than the stale-run window may be
   * reclaimed — that is a run that died without reporting. */
  run?: { status: "idle" | "processing" | "completed" | "failed"; at: number }
  /** Founder-confirmed business name (may differ from the project title). */
  displayName?: string
  description?: string
  targetCustomers?: string
  additionalContext?: string
  objectives: BusinessObjectiveId[]
  website?: IntakeWebsiteStage
  repo?: IntakeRepoStage
  assessment?: IntakeStage & { generatedAt?: number; result?: BusinessAssessment }
  /** Domain ownership verification summary, kept in sync with the domain
   * records (which are authoritative — this is a projection for display). */
  domain?: {
    hostname?: string
    verificationStatus?: BusinessDomainStatus
    method?: BusinessDomainMethod
    verifiedAt?: number
  }
}

export type BusinessDomainStatus =
  | "not_verified"
  | "pending"
  | "in_progress"
  | "verified"
  | "expired"
  | "failed"
  | "revoked"

export type BusinessDomainMethod = "meta_tag" | "html_file"

/** One labelled finding in the initial assessment. */
export interface AssessmentFinding {
  title: string
  detail: string
  /** `assumption` marks anything not directly observed in the evidence. */
  basis: "observed" | "inferred" | "owner_stated" | "assumption"
  /** Evidence reference, e.g. "homepage <title>", "package.json", "your answer". */
  evidence?: string
}

export interface AssessmentRecommendation {
  title: string
  explanation: string
  whyItMatters: string
  expectedOutcome: string
  priority: "immediate" | "short_term" | "later"
  /** Which existing Atai section carries this out. */
  ataiSection: string
  /** Route of that section, resolved server-side against routes that exist and
   * features the founder has actually switched on. Empty means "no Atai surface
   * for this yet" — and the UI must not invent one. */
  route: string
  executableNow: boolean
  needs?: string
}

export interface BusinessAssessment {
  generatedAt: number
  /** Honesty header: what was actually read to produce this. */
  evidence: {
    websiteAnalysed: boolean
    pagesCrawled: number
    repoAnalysed: boolean
    ownerDescription: boolean
    domainVerified: boolean
  }
  understanding: string
  currentPosition: string
  strengths: AssessmentFinding[]
  challenges: AssessmentFinding[]
  growthOpportunities: AssessmentFinding[]
  technicalOpportunities: AssessmentFinding[]
  marketingOpportunities: AssessmentFinding[]
  priorities: AssessmentRecommendation[]
  actionPlan: Array<{ horizon: "immediate" | "short_term" | "later"; items: string[] }>
  openQuestions: string[]
}

/** A stored domain ownership record. Authoritative for verification state. */
export interface BusinessDomainDoc {
  _id?: unknown
  id: string
  projectId: string
  userId: string
  /** Exact hostname being verified — the verification target, lowercased, no port. */
  hostname: string
  /** Registrable domain (eTLD+1) for display only. Never a verification target. */
  registrableDomain: string
  submittedUrl: string
  status: BusinessDomainStatus
  method?: BusinessDomainMethod
  /** SHA-256 of the challenge token. This is what a verification attempt is
   * compared against — the authoritative secret. */
  tokenHash?: string
  /** Owner-only display copy, kept so a founder can reload the page and still
   * see the tag/file to install. Served exclusively from the
   * session-authenticated, ownership-gated domain endpoint; never logged,
   * never serialized into any public or unauthenticated response. */
  token?: string
  /** Filename for the html_file method — unique per challenge. */
  fileName?: string
  /** Bumped on every regeneration so an old challenge can never validate. */
  tokenGeneration?: number
  tokenCreatedAt?: number
  tokenExpiresAt?: number
  attempts?: number
  lastAttemptAt?: number
  /** Last time a check actually ran (success or failure). */
  lastCheckedAt?: number
  lastFailure?: { code: string; message: string; at: number } | null
  /** Consecutive failed checks against an already-verified domain. Cleared on
   * a successful check; only past the grace limit does verified status drop. */
  failedChecks?: number
  /** Set when a verified domain's tag or file stopped being findable. */
  needsAttention?: boolean
  verifiedAt?: number
  verifiedMethod?: BusinessDomainMethod
  /** Bounded history of status transitions (newest first). */
  history?: Array<{ status: BusinessDomainStatus; at: number; detail?: string }>
  /** Set when the record stops claiming the hostname, freeing it for another business. */
  releasedAt?: number
  createdAt: number
  updatedAt: number
}
