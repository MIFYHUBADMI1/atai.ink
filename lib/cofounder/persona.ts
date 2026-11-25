/**
 * The co-founder's founder-defined identity and tone.
 *
 * Isomorphic on purpose: the settings rail is a client component and the agent
 * is server-side, so the archetype catalog, the bounds and the prompt lines
 * must live where both can import them without pulling in `server-only`.
 *
 * Tone never overrides rules. Everything here shapes *how* the co-founder
 * speaks; the immutable behaviour rules stay in `COFOUNDER_AGENT_SYSTEM`.
 */

export interface CofounderArchetype {
  id: string
  name: string
  description: string
  /** One sentence of guidance injected into the system prompt. */
  guidance: string
}

export const COFOUNDER_ARCHETYPES: readonly CofounderArchetype[] = [
  {
    id: "strategic",
    name: "Strategic",
    description: "Sees the whole business and picks the highest-leverage move.",
    guidance:
      "Think across the whole business. Name the single highest-leverage move, say why it beats the alternatives, and connect it to what the founder is already doing.",
  },
  {
    id: "operator",
    name: "Operator",
    description: "Turns ideas into concrete next actions and owners.",
    guidance:
      "Be execution-first. Turn discussion into concrete next actions with an owner and a first step. Prefer a checklist the founder can start today over a theory.",
  },
  {
    id: "coach",
    name: "Coach",
    description: "Asks the questions that sharpen the founder's thinking.",
    guidance:
      "Ask one sharp question at a time before advising. Help the founder reach their own conclusion, then offer a concrete suggestion to test it.",
  },
  {
    id: "analyst",
    name: "Analyst",
    description: "Numbers-first: evidence, trade-offs and explicit assumptions.",
    guidance:
      "Ground claims in evidence and numbers. State assumptions explicitly, compare options on the criteria that matter, and say what would change your recommendation.",
  },
  {
    id: "challenger",
    name: "Challenger",
    description: "Pressure-tests the plan and names the weak assumption.",
    guidance:
      "Pressure-test the founder's thinking. Name the weakest assumption, the failure mode it hides, and the cheapest test that would settle it. Be direct, never dismissive.",
  },
  {
    id: "creative",
    name: "Creative",
    description: "Generates options the founder has not considered.",
    guidance:
      "Generate distinct options before converging. Offer two or three genuinely different directions, then recommend one and say what makes it worth trying.",
  },
] as const

export const DEFAULT_COFOUNDER_ARCHETYPE_ID = "strategic"
export const DEFAULT_COFOUNDER_NAME = "Co-founder"
export const MAX_COFOUNDER_NAME_LENGTH = 40
export const MAX_COFOUNDER_INSTRUCTIONS_LENGTH = 1200
export const MAX_COFOUNDER_NOTES_LENGTH = 2000
export const COFOUNDER_HISTORY_DEPTHS = [0, 6, 12, 24] as const
export const DEFAULT_COFOUNDER_HISTORY_DEPTH = 12

const ARCHETYPE_BY_ID = new Map(COFOUNDER_ARCHETYPES.map((a) => [a.id, a]))

export function isCofounderArchetypeId(id: unknown): id is string {
  return typeof id === "string" && ARCHETYPE_BY_ID.has(id)
}

export function resolveArchetype(id: string | undefined | null): CofounderArchetype {
  return (id && ARCHETYPE_BY_ID.get(id)) || ARCHETYPE_BY_ID.get(DEFAULT_COFOUNDER_ARCHETYPE_ID)!
}

function clampLevel(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") return fallback
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(5, Math.max(1, Math.round(n)))
}

export function clampDetail(value: unknown): number {
  return clampLevel(value, 3)
}

export function clampDirectness(value: unknown): number {
  return clampLevel(value, 3)
}

const DETAIL_LABELS = ["Very concise", "Concise", "Balanced", "Detailed", "Very detailed"] as const
const DIRECTNESS_LABELS = ["Gentle", "Considerate", "Direct", "Blunt", "Unfiltered"] as const

export function detailLabel(value: number): string {
  return DETAIL_LABELS[clampDetail(value) - 1]
}

export function directnessLabel(value: number): string {
  return DIRECTNESS_LABELS[clampDirectness(value) - 1]
}

/** Strip control characters, collapse whitespace, bound, and fall back to the
 * default when nothing usable is left. */
export function normaliseCofounderName(name: unknown): string {
  if (typeof name !== "string") return DEFAULT_COFOUNDER_NAME
  // Keep printable text only; newlines/tabs collapse to a single space.
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_COFOUNDER_NAME_LENGTH)
    .trim()
  return cleaned || DEFAULT_COFOUNDER_NAME
}

export interface CofounderPersonaInput {
  name?: string
  archetype?: string
  detail?: number
  directness?: number
  instructions?: string
}

/** The style block appended to the immutable rules. Tone only. */
export function personaStyleLines(persona: CofounderPersonaInput = {}): string[] {
  const archetype = resolveArchetype(persona.archetype)
  const name = normaliseCofounderName(persona.name)
  const detail = clampDetail(persona.detail)
  const directness = clampDirectness(persona.directness)
  return [
    "FOUNDER-DEFINED STYLE (tone only — the rules above always win):",
    `- Your name: ${name}`,
    `- Archetype (${archetype.name}): ${archetype.guidance}`,
    `- Detail level: ${detail}/5 — ${detailLabel(detail)}.`,
    `- Directness level: ${directness}/5 — ${directnessLabel(directness)}.`,
  ]
}

/** Founder-authored working notes, trimmed and bounded. Empty means absent. */
export function personaInstructions(persona: CofounderPersonaInput = {}): string {
  if (typeof persona.instructions !== "string") return ""
  return persona.instructions.trim().slice(0, MAX_COFOUNDER_INSTRUCTIONS_LENGTH).trim()
}
