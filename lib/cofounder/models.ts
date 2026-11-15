/**
 * AI co-founder model tiers — the 10 named "engines" a founder can pick in
 * /settings/ai. Each tier maps a catch name + plain-language strength to a
 * concrete OpenRouter model id and a flat per-message credit cost.
 *
 * This file is deliberately isomorphic: the settings page (client component)
 * imports it to render the picker, and the server resolver/agent import it to
 * route the model call. It must stay free of server-only imports and secrets —
 * model ids are not sensitive.
 *
 * Cost model: `creditsPerMessage` is charged once per co-founder turn via the
 * shared credit ledger (transactionType "ai_collaboration"). 0 = free tier,
 * never touches the ledger. Costs are flat per message regardless of how many
 * tool steps the turn takes — simple and predictable for the founder.
 *
 * The OpenRouter ids below are the operator-tunable catalog: if a provider
 * retires or renames a model, change the id here — no other file needs to know.
 */

export interface CofounderModelTier {
  /** Stable id persisted on the user doc and in the tiers collection. */
  id: string
  /** Catch name shown on the card — the "mode" the founder picks. */
  name: string
  /** One-line "what it's good at" shown under the name. */
  strength: string
  /** OpenRouter model identifier sent to the chat endpoint. Shown to the
   * founder for transparency, but never something they "select" — they pick
   * the named mode, not the raw model. */
  modelId: string
  /** Credits charged per co-founder message. 0 = free. */
  creditsPerMessage: number
}

/** Stored shape in `cofounder_model_tiers`. Admin-managed: the built-in
 * COFOUNDER_MODEL_TIERS below are only the seed/fallback catalog. */
export interface CofounderModelTierDoc extends CofounderModelTier {
  position: number
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export const COFOUNDER_MODEL_TIERS: readonly CofounderModelTier[] = [
  {
    id: "spark",
    name: "Spark",
    strength: "Fast and free — quick answers, light planning, everyday co-founder chat.",
    modelId: "nvidia/nemotron-3-ultra-550b-a55b:free",
    creditsPerMessage: 0,
  },
  {
    id: "breeze",
    name: "Breeze",
    strength: "The quickest free engine — short, snappy replies for simple questions.",
    modelId: "nvidia/nemotron-3.5-lightning:free",
    creditsPerMessage: 0,
  },
  {
    id: "current",
    name: "Current",
    strength: "A different free all-rounder — balanced reasoning without spending credits.",
    modelId: "poolside/laguna-s-2.1:free",
    creditsPerMessage: 0,
  },
  {
    id: "north",
    name: "North",
    strength: "Free and code-aware — strongest of the free tiers on technical, build-related questions.",
    modelId: "cohere/north-mini-code:free",
    creditsPerMessage: 0,
  },
  {
    id: "ember",
    name: "Ember",
    strength: "A step up — warmer, more thoughtful answers with reliable tool use. Low credit cost.",
    modelId: "meta-llama/llama-3.3-70b-instruct",
    creditsPerMessage: 2,
  },
  {
    id: "lumen",
    name: "Lumen",
    strength: "Bright and fast paid reasoning — sharp summaries and solid multi-step tool calls.",
    modelId: "google/gemini-2.5-flash",
    creditsPerMessage: 3,
  },
  {
    id: "sage",
    name: "Sage",
    strength: "Deep, careful reasoning — best value for complex strategy and plan critique.",
    modelId: "deepseek/deepseek-chat",
    creditsPerMessage: 5,
  },
  {
    id: "atlas",
    name: "Atlas",
    strength: "Carries the whole business context — excellent at connecting plan, build, and growth.",
    modelId: "anthropic/claude-sonnet-4.6",
    creditsPerMessage: 8,
  },
  {
    id: "oracle",
    name: "Oracle",
    strength: "Frontier-grade judgment — the most reliable co-founder for high-stakes decisions.",
    modelId: "openai/gpt-5.2",
    creditsPerMessage: 12,
  },
  {
    id: "apex",
    name: "Apex",
    strength: "The strongest engine available — maximum depth for the hardest calls. Premium price.",
    modelId: "anthropic/claude-opus-4.6",
    creditsPerMessage: 20,
  },
] as const

export type CofounderModelTierId = (typeof COFOUNDER_MODEL_TIERS)[number]["id"]

/** Tier used when the founder has never picked one (and for any stored value
 * that no longer resolves — catalog entries can be retired safely). */
export const DEFAULT_COFUNDER_MODEL_TIER: CofounderModelTier = COFOUNDER_MODEL_TIERS[0]

const BY_ID = new Map<string, CofounderModelTier>(COFOUNDER_MODEL_TIERS.map((t) => [t.id, t]))

export function getCofounderModelTier(id: string | undefined | null): CofounderModelTier {
  return (id && BY_ID.get(id)) || DEFAULT_COFUNDER_MODEL_TIER
}

export function isCofounderModelTierId(id: unknown): id is CofounderModelTierId {
  return typeof id === "string" && BY_ID.has(id)
}
