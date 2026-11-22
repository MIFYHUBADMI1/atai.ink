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

/** Why an AI stage failed, in terms the UI can act on. `format` means the
 * engine answered but not in a shape Atai could trust — still an engine
 * problem, and still worth switching engines over. */
export type AssessmentFailureReason =
  | "timeout"
  | "model_unavailable"
  | "rate_limited"
  | "provider_error"
  | "rejected"
  | "format"
  | "unknown"

/** Which co-founder engine (the /settings/ai pick) answered a stage. */
export interface IntakeEngineRef {
  tierId: string
  tierName: string
  modelId: string
}

export interface IntakeStage {
  status: IntakeStageStatus
  attemptedAt?: number
  completedAt?: number
  /** User-safe only. Never a stack trace, never an internal address. A stage
   * that later succeeded is cleared back to `null`, not left carrying an old
   * failure the founder has already overcome. */
  errorCode?: string | null
  errorMessage?: string | null
  /** The operator-facing reason behind `errorMessage`: a provider status, a
   * timeout, a truncated reply. Bounded and scrubbed of secrets. */
  errorDetail?: string | null
}

export interface IntakeWebsiteStage extends IntakeStage {
  url?: string
  pagesCrawled?: number
  /** True when the evidence came from the 7-day Firecrawl cache (no new spend). */
  fromCache?: boolean
  /** A bounded copy of what the read actually returned, kept so the founder can
   * check the reading instead of trusting it. Bounded on purpose: this is a
   * preview of the read, not an archive of their site. */
  reading?: IntakeWebsiteReading
}

export interface IntakeWebsiteReading {
  capturedAt: number
  /** Exactly the evidence block the co-founder's prompt contained. */
  digest: string
  /** The address the site actually served, after redirects. */
  finalUrl?: string
  /** The address the founder typed, when it redirected somewhere else. */
  redirectedFrom?: string
  pages: Array<{
    url: string
    title?: string
    headings: string[]
    /** Opening characters of the page text the crawl returned. */
    excerpt: string
    /** Characters the crawler returned for this page, before the excerpt cut. */
    chars: number
  }>
  pagesRead: number
  /** Characters of page text behind the excerpts — not the digest size. */
  charsRead: number
}
/**
 * How the customer's own application proved it is connected to Atai.
 *
 * Facts only. The founder-facing status is derived from these facts by
 * `lib/connected-business/status` and cached back onto `status` whenever a
 * write path changes them, so a stored status can never drift from the facts
 * it was derived from.
 */
export interface BusinessConnection {
  /** Derived cache — see `businessConnectionStatus`. */
  status?: BusinessConnectionStatus
  /** When the integration guide (with a connection key) was issued. */
  guideIssuedAt?: number
  guideVersion?: string
  /** Runtime key the guide was issued with. Metadata only, never the secret. */
  keyId?: string
  /** First authenticated call from the customer's application. This is the
   * only truthful proof that an app outside Atai is talking to Atai. */
  firstSeenAt?: number
  lastSeenAt?: number
  /** Bounded counter of authenticated calls recorded for display. */
  seenCalls?: number
  /** Set the first time a verified domain and a seen application coexist. */
  verifiedAt?: number
  revokedAt?: number
  revokedReason?: string
}

/**
 * `not_connected`  no guide, no app call
 * `guide_issued`   the founder downloaded the guide, nothing has called yet
 * `awaiting_app`   the domain is verified, no application call yet
 * `awaiting_domain`an application called, the domain is not verified
 * `verified`       verified domain + a recent authenticated call
 * `stale`          verified before, but the app has gone quiet
 * `revoked`        the founder disconnected the application
 */
export type BusinessConnectionStatus =
  | "not_connected"
  | "guide_issued"
  | "awaiting_app"
  | "awaiting_domain"
  | "verified"
  | "stale"
  | "revoked"

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
  run?: {
    status: "idle" | "processing" | "completed" | "failed" | "cancelled"
    at: number
    /** Set when the founder pressed Stop. The run reads it at its next stage
     * boundary: a stop never claims to have interrupted a call already in
     * flight, and releasing the claim lets the same business be read again. */
    cancelRequestedAt?: number
  }
  /** Founder-confirmed business name (may differ from the project title). */
  displayName?: string
  description?: string
  targetCustomers?: string
  additionalContext?: string
  objectives: BusinessObjectiveId[]
  website?: IntakeWebsiteStage
  assessment?: IntakeStage & {
    generatedAt?: number
    result?: BusinessAssessment
    /** The engine that ran this attempt, kept even on failure so the founder
     * can be told which one to change instead of being offered a blind retry. */
    engine?: IntakeEngineRef
    /** Machine-readable cause of `errorCode`, for the engine-failure panel. */
    errorReason?: AssessmentFailureReason | null
  }
  /** The business-claim outcome of the last run, persisted so a refusal
   * survives a reload instead of existing only as an activity event. */
  claim?: {
    hostname?: string
    state: "unclaimed" | "yours" | "held_by_other"
    at?: number
  }
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
  /** The business identity used for uniqueness only: the exact hostname with a
   * safe leading `www.` removed (`canonicalBusinessHost`). Optional because
   * records written before this field existed fall back to computing it. */
  canonicalHostname?: string
  /** Set on an additional exact-host record that belongs to the same project as
   * the primary claim — it lets the founder verify apex and `www` separately
   * without either one becoming a second business. */
  aliasOf?: string
  /** When an unverified claim stops blocking other accounts. Cleared once the
   * domain is verified: a verified business is held until it is released. */
  claimExpiresAt?: number
  /** Set when the founder was warned that an unverified claim is about to
   * expire, so a daily sweep sends one reminder, not one per run. */
  claimReminderSentAt?: number
  /** Set when the founder was told an unverified claim was released. */
  claimExpiryNoticeSentAt?: number
  /** True only when the release came from the expiry window (not from the
   * founder deleting the business or releasing the domain) — the notice sweep
   * keys on it so nobody is emailed about a release they performed. */
  expiredUnverified?: boolean
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
