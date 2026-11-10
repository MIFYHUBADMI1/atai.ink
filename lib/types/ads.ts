import type { ObjectId } from "mongodb"

/**
 * Ads & Growth Center documents. These collections are additive to the
 * platform: nothing here replaces `content_items`, `campaigns`, or the credit
 * ledger — the ads center reads from those and adds its own advertising
 * request lifecycle on top.
 */

/**
 * The founder's advertising strategy for one project — their own stated
 * choices, editable any time. Not AI output: AI-generated recommendations are
 * content-library items (`kit: "ads"`, `kitSlot: "strategy-recommendations"`),
 * clearly labeled and never merged into this document.
 */
export interface AdStrategyDoc {
  _id: ObjectId
  id: string
  userId: string
  projectId: string
  /** How the founder wants the business positioned in ads. */
  positioning: string
  /** Who the ads are for (the founder's ideal customer description). */
  icp: string
  /** Markets / geographies the ads should target. */
  geographies: string
  /** What the ads should achieve (bounded list). */
  objectives: string[]
  /** Channels the founder wants to advertise on (bounded list). */
  channels: string[]
  /** The founder's budget note — intent only, never a spend record. */
  budgetNote: string
  /** Marketing priorities, founder-ordered (bounded list). */
  priorities: string[]
  /** Brand voice for ad copy (prefilled from the studio brand profile). */
  brandVoice: string
  /** Unique selling propositions to emphasize (bounded list). */
  usps: string
  createdAt: number
  updatedAt: number
}

/**
 * Advertising request lifecycle (spec section 5). Transitions are validated
 * server-side; Phase 3 only ever writes `submitted` — the admin workspace,
 * quotation flow and execution workspace own the later transitions.
 */
export type AdRequestStatus =
  | "submitted"
  | "under_review"
  | "needs_info"
  | "proposal_prepared"
  | "awaiting_approval"
  | "awaiting_payment"
  | "approved"
  | "scheduled"
  | "in_progress"
  | "paused"
  | "completed"
  | "rejected"
  | "cancelled"
  | "refunded"

export const AD_REQUEST_STATUSES: readonly AdRequestStatus[] = [
  "submitted",
  "under_review",
  "needs_info",
  "proposal_prepared",
  "awaiting_approval",
  "awaiting_payment",
  "approved",
  "scheduled",
  "in_progress",
  "paused",
  "completed",
  "rejected",
  "cancelled",
  "refunded",
]

export function isAdRequestStatus(value: unknown): value is AdRequestStatus {
  return AD_REQUEST_STATUSES.includes(value as AdRequestStatus)
}

/** Validated transitions — every later phase must go through these. */
export const AD_REQUEST_TRANSITIONS: Record<AdRequestStatus, readonly AdRequestStatus[]> = {
  submitted: ["under_review", "needs_info", "rejected", "cancelled"],
  under_review: ["needs_info", "proposal_prepared", "awaiting_approval", "rejected", "cancelled"],
  needs_info: ["under_review", "rejected", "cancelled"],
  proposal_prepared: ["awaiting_approval", "under_review", "rejected", "cancelled"],
  awaiting_approval: ["awaiting_payment", "under_review", "cancelled", "proposal_prepared"],
  awaiting_payment: ["approved", "cancelled", "under_review"],
  approved: ["scheduled", "in_progress", "cancelled", "refunded"],
  scheduled: ["in_progress", "paused", "cancelled"],
  in_progress: ["paused", "completed", "cancelled"],
  paused: ["in_progress", "completed", "cancelled"],
  completed: ["refunded"],
  rejected: [],
  cancelled: ["refunded"],
  refunded: [],
}

export function canTransitionAdRequest(from: AdRequestStatus, to: AdRequestStatus): boolean {
  return AD_REQUEST_TRANSITIONS[from]?.includes(to) ?? false
}

export const AD_REQUEST_PRIORITIES = ["low", "normal", "high", "urgent"] as const
export type AdRequestPriority = (typeof AD_REQUEST_PRIORITIES)[number]

export const AD_PAYMENT_STATUSES = ["unpaid", "paid", "refunded", "failed"] as const
export type AdPaymentStatus = (typeof AD_PAYMENT_STATUSES)[number]

export const AD_ACTIVITY_STATUSES = ["pending", "in_progress", "completed", "blocked"] as const
export type AdActivityStatus = (typeof AD_ACTIVITY_STATUSES)[number]

export const AD_PERFORMANCE_SOURCES = ["manual", "platform", "estimated", "tracking"] as const
export type AdPerformanceSource = (typeof AD_PERFORMANCE_SOURCES)[number]

export const AD_EXECUTION_MODES = ["manual", "platform_integrated", "automated"] as const
export type AdExecutionMode = (typeof AD_EXECUTION_MODES)[number]

/** One founder-supplied asset reference (uploaded through the existing secure
 * project-assets route; the request stores URLs, never raw files). */
export interface AdRequestAsset {
  url: string
  label: string
  kind: "logo" | "screenshot" | "promo_image" | "product_image" | "video" | "existing_ad" | "brand_guidelines" | "document" | "other"
}

/** Section 1 — business information (prefilled from the project, founder confirms/edits). */
export interface AdRequestBusiness {
  name: string
  /** Required for promotion: the live, accessible production URL. */
  liveUrl: string
  description: string
  industry: string
  targetAudience: string
  mainProduct: string
  location: string
  contact: string
  socialLinks: string[]
  pricingInfo: string
  stage: string
}

/** Section 2 — what Atai should promote. */
export interface AdRequestPromote {
  goals: string[]
  /** "Tell us what you want people to know about your business." */
  pitch: string
  /** USPs, offers, launch details, promotional messages, instructions. */
  context: string
}

/** Section 3 — target audience (no unnecessary sensitive personal data). */
export interface AdRequestAudience {
  who: string
  ageRange: string
  countries: string
  regions: string
  interests: string
  customerType: string
  problems: string
  profile: string
}

/** Section 4 — campaign preferences. */
export interface AdRequestPreferences {
  objective: string
  channels: string[]
  duration: string
  startDate: string
  frequency: string
  contentFormat: string
  brandVoice: string
  callToAction: string
  budgetNote: string
  instructions: string
}

/** Section 5 — what Atai should create or use. */
export const AD_REQUEST_CREATION_MODES = [
  "use_existing",
  "use_atai_generated",
  "create_new",
  "atai_recommends",
  "follow_concept",
  "improve_concept",
] as const

export type AdRequestCreationMode = (typeof AD_REQUEST_CREATION_MODES)[number]

export function isAdRequestCreationMode(value: unknown): value is AdRequestCreationMode {
  return AD_REQUEST_CREATION_MODES.includes(value as AdRequestCreationMode)
}

export interface AdRequestCreation {
  mode: AdRequestCreationMode
  /** The exact advertisement the founder envisions (free text). */
  vision: string
}

/** Section 6 — the six explicit confirmations required before submission. */
export interface AdRequestConfirmations {
  urlCorrect: boolean
  infoAccurate: boolean
  assetsAuthorized: boolean
  manualExecutionUnderstood: boolean
  noGuarantees: boolean
  noAutoApproval: boolean
}

/** The complete founder submission (what the wizard sends, pre-normalization). */
export interface AdRequestSubmission {
  business: AdRequestBusiness
  promote: AdRequestPromote
  audience: AdRequestAudience
  preferences: AdRequestPreferences
  assets: AdRequestAsset[]
  creation: AdRequestCreation
  confirmations: AdRequestConfirmations
}

/**
 * One advertising campaign request — the durable record of a founder asking
 * Atai's team to manually promote their business. Submission is FREE: no
 * credits are charged until a quotation is explicitly approved (Phase 5).
 */
export interface AdCampaignRequestDoc {
  _id: ObjectId
  /** Business id (`adreq_...`). */
  id: string
  userId: string
  projectId: string
  /** Client-generated; unique index makes network retries idempotent. */
  idempotencyKey: string
  status: AdRequestStatus
  business: AdRequestBusiness
  promote: AdRequestPromote
  audience: AdRequestAudience
  preferences: AdRequestPreferences
  assets: AdRequestAsset[]
  creation: AdRequestCreation
  confirmations: AdRequestConfirmations
  priority: AdRequestPriority
  assignedAdminId?: string
  assignedAdminEmail?: string
  /** Always "manual" in this release — future providers can change this. */
  executionMode: AdExecutionMode
  proposal?: AdCampaignProposal
  payment?: AdCampaignPayment
  createdAt: number
  updatedAt: number
  submittedAt: number
}

export interface AdCampaignProposalLine {
  label: string
  credits: number
}

/**
 * Snapshot of an issued quotation. Later admin package edits never mutate an
 * already-sent proposal; a new issue increments `version`.
 */
export interface AdCampaignProposal {
  version: number
  title: string
  description: string
  objectives: string[]
  audience: string
  platforms: string[]
  formats: string[]
  creativeScope: string
  duration: string
  frequency: string
  deliverables: string[]
  estimatedImpressionsMin?: number
  estimatedImpressionsMax?: number
  estimateNote: string
  startDate: string
  endDate: string
  creditsPrice: number
  breakdown: AdCampaignProposalLine[]
  conditions: string
  customerInstructions: string
  packageId?: string
  issuedAt: number
  expiresAt?: number
  issuedByAdminId: string
}

export interface AdCampaignPayment {
  status: AdPaymentStatus
  creditsCharged: number
  subscriptionConsumed: number
  permanentConsumed: number
  chargedAt?: number
  refundedAt?: number
  chargeIdempotencyKey?: string
  refundIdempotencyKey?: string
}

/**
 * Append-only timeline of a request: every status change, admin note, founder
 * reply, quotation and execution event adds a row. Never mutated or deleted.
 */
export interface AdRequestEventDoc {
  _id: ObjectId
  id: string
  requestId: string
  projectId: string
  userId: string
  actor: "founder" | "admin" | "system"
  /** Machine action (e.g. "submitted", "status_changed", "note_added"). */
  action: string
  /** Human-readable detail shown on the timeline. */
  detail?: string
  fromStatus?: AdRequestStatus
  toStatus?: AdRequestStatus
  /** Internal notes stay off the founder timeline. Default is founder-visible. */
  visibility?: "founder" | "internal"
  createdAt: number
}

export interface AdPricingPackageDoc {
  _id: ObjectId
  id: string
  name: string
  description: string
  durationDays: number
  creditsPrice: number
  estimatedImpressionsMin: number
  estimatedImpressionsMax: number
  channels: string[]
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface AdCampaignActivityDoc {
  _id: ObjectId
  id: string
  requestId: string
  projectId: string
  title: string
  notes: string
  status: AdActivityStatus
  channel: string
  publicationUrl: string
  account: string
  publishedAt?: number
  createdAt: number
  updatedAt: number
  completedAt?: number
}

export interface AdCampaignPerformanceDoc {
  _id: ObjectId
  id: string
  requestId: string
  projectId: string
  metric: string
  value: number
  source: AdPerformanceSource
  evidenceUrl: string
  note: string
  reportedAt: number
  reportedByAdminId: string
}
