/**
 * Founder-facing copy for business claims. Kept free of server imports so the
 * wizard can show the exact sentence the API returns.
 */

/** One message for every founder-facing "someone else has this business" case.
 * It never names the account, the project or the claim — only the ways out. */
export const BUSINESS_ALREADY_CONNECTED_MESSAGE =
  "This website is already connected to another Atai account. Only that account can disconnect it. If this is the business you own, contact support to recover it."

export const BUSINESS_ALREADY_CONNECTED_MESSAGE_SAME_ACCOUNT =
  "This website is already connected to another business in your account. Open that business from your dashboard to keep working on it."

/** The only route out of a claim the founder cannot release themselves. */
export const BUSINESS_CLAIM_SUPPORT_HREF = "mailto:support@atai.ink"

export type BusinessClaimState = "unclaimed" | "yours" | "held_by_other"
