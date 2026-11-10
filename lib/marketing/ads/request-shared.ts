/**
 * "Promote My Business with Atai" — shared vocabulary for the six-section
 * submission wizard and its API schema. Pure module: no server imports, so
 * the client wizard can use the same bounds, options and labels.
 */

import type {
  AdRequestStatus,
  AdRequestCreationMode,
  AdRequestAsset,
  AdRequestPriority,
  AdPaymentStatus,
  AdActivityStatus,
  AdPerformanceSource,
} from "@/lib/types/ads"

/** Field bounds (chars / list lengths) — enforced by the API and shown in the UI. */
export const AD_REQUEST_BOUNDS = {
  name: 120,
  liveUrl: 300,
  description: 1000,
  industry: 120,
  targetAudience: 500,
  mainProduct: 300,
  location: 200,
  contact: 200,
  socialLink: 300,
  socialLinks: 8,
  pricingInfo: 500,
  stage: 120,
  goal: 120,
  goals: 12,
  pitch: 1500,
  context: 2000,
  who: 500,
  ageRange: 80,
  countries: 300,
  regions: 300,
  interests: 500,
  customerType: 200,
  problems: 800,
  profile: 500,
  objective: 300,
  channel: 80,
  channels: 8,
  duration: 120,
  startDate: 40,
  frequency: 120,
  contentFormat: 200,
  brandVoice: 200,
  callToAction: 200,
  budgetNote: 300,
  instructions: 2000,
  assetLabel: 120,
  assetUrl: 500,
  assets: 12,
  vision: 2000,
} as const

/** Section 2 examples — the founder picks any and can add their own in the pitch. */
export const AD_REQUEST_GOAL_OPTIONS = [
  "Promote my entire application",
  "Get new users",
  "Generate paying customers",
  "Promote a product or service",
  "Increase website traffic",
  "Promote a new launch",
  "Get businesses to register",
  "Promote a specific feature",
  "Generate leads",
  "Increase subscriptions",
  "Promote an event",
  "Increase awareness",
] as const

/** Channel suggestions — preferences only; Atai's team confirms what is feasible. */
export const AD_REQUEST_CHANNEL_OPTIONS = [
  "Facebook",
  "Instagram",
  "TikTok",
  "X (Twitter)",
  "LinkedIn",
  "YouTube",
  "Email",
  "SEO / content",
  "Other",
] as const

export const AD_REQUEST_CREATION_MODE_LABELS: Record<AdRequestCreationMode, string> = {
  use_existing: "Use my existing advertising materials",
  use_atai_generated: "Use my generated Atai advertisements",
  create_new: "Create new advertising materials",
  atai_recommends: "Let Atai recommend the best approach",
  follow_concept: "Follow my supplied campaign concept",
  improve_concept: "Let Atai improve my campaign concept",
}

export const AD_REQUEST_ASSET_KIND_LABELS: Record<AdRequestAsset["kind"], string> = {
  logo: "Logo",
  screenshot: "Screenshot",
  promo_image: "Promotional image",
  product_image: "Product image",
  video: "Video",
  existing_ad: "Existing advertisement",
  brand_guidelines: "Brand guidelines",
  document: "Supporting document",
  other: "Other",
}

export const AD_REQUEST_STATUS_LABELS: Record<AdRequestStatus, string> = {
  submitted: "Submitted",
  under_review: "Under review",
  needs_info: "Needs more information",
  proposal_prepared: "Proposal prepared",
  awaiting_approval: "Awaiting your approval",
  awaiting_payment: "Awaiting payment",
  approved: "Approved",
  scheduled: "Scheduled",
  in_progress: "In progress",
  paused: "Paused",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
  refunded: "Refunded",
}

/** The six explicit confirmations of Section 6, in order. */
export const AD_REQUEST_CONFIRMATIONS: Array<{
  key: "urlCorrect" | "infoAccurate" | "assetsAuthorized" | "manualExecutionUnderstood" | "noGuarantees" | "noAutoApproval"
  label: string
}> = [
  { key: "urlCorrect", label: "The application URL is correct." },
  { key: "infoAccurate", label: "The submitted business information is accurate." },
  { key: "assetsAuthorized", label: "I have permission to use the supplied promotional assets." },
  { key: "manualExecutionUnderstood", label: "I understand campaign execution is currently handled manually by Atai's team." },
  { key: "noGuarantees", label: "I understand estimated reach and visibility are not guaranteed results." },
  { key: "noAutoApproval", label: "I understand submitting does not automatically mean approval or publication." },
]

/** The service description shown on the promote page (spec wording, no promises). */
export const PROMOTE_SERVICE_INTRO =
  "Let Atai help your business reach more people. Submit your application and advertising goals, and our team will review your business, recommend a promotional strategy, and provide a campaign proposal with transparent pricing and estimated visibility."

export const AD_REQUEST_PRIORITY_LABELS: Record<AdRequestPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
}

export const AD_PAYMENT_STATUS_LABELS: Record<AdPaymentStatus, string> = {
  unpaid: "Unpaid",
  paid: "Paid",
  refunded: "Refunded",
  failed: "Payment failed",
}

export const AD_ACTIVITY_STATUS_LABELS: Record<AdActivityStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  blocked: "Blocked",
}

export const AD_PERFORMANCE_SOURCE_LABELS: Record<AdPerformanceSource, string> = {
  manual: "Manually entered",
  platform: "Platform-reported",
  estimated: "Estimate (not actual)",
  tracking: "Integrated tracking",
}

export const AD_ESTIMATE_DISCLAIMER =
  "Estimated impressions and reach are planning ranges, not guaranteed delivery. They are not customers, sales, or revenue."

export function founderRequestPath(projectId: string, requestId: string): string {
  return `/project/${projectId}/ads?tab=promote&request=${encodeURIComponent(requestId)}`
}

export function adminRequestPath(requestId: string): string {
  return `/admin/ads/${encodeURIComponent(requestId)}`
}
