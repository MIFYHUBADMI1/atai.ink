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
