import { track } from "@vercel/analytics"

/**
 * Client-side funnel for the connected-business journey:
 * wizard → read → ownership verified → connection live.
 *
 * The build/import funnel has had instrumentation since launch
 * (`start-funnel.ts`); the connect path had none, so nobody could tell whether
 * the one-business-one-account gate was stopping squatters or turning away real
 * owners. Events land in Vercel Web Analytics.
 *
 * Nothing identifying is sent: no hostname, URL, project id, business name or
 * email. A random flow id joins the steps, exactly like the start funnel.
 */

type AnalyticsValue = string | number | boolean | null | undefined

const FLOW_STORAGE_KEY = "atai:connect-flow:v1"
const FLOW_TTL_MS = 2 * 60 * 60 * 1000

export type ConnectSurface = "wizard" | "project" | "start"

type ConnectFlow = { id: string; surface: ConnectSurface; startedAt: number }

function storage(): Storage | null {
  if (typeof window === "undefined") return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function createId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  } catch {
    /* fall through */
  }
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function readFlow(): ConnectFlow | null {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(FLOW_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ConnectFlow> | null
    if (!parsed || typeof parsed.id !== "string" || typeof parsed.startedAt !== "number") return null
    if (Date.now() - parsed.startedAt > FLOW_TTL_MS) {
      store.removeItem(FLOW_STORAGE_KEY)
      return null
    }
    return {
      id: parsed.id,
      surface: parsed.surface === "project" || parsed.surface === "start" ? parsed.surface : "wizard",
      startedAt: parsed.startedAt,
    }
  } catch {
    return null
  }
}

function writeFlow(flow: ConnectFlow): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(FLOW_STORAGE_KEY, JSON.stringify(flow))
  } catch {
    /* quota/privacy mode — analytics is best effort */
  }
}

function emit(name: string, properties: Record<string, AnalyticsValue>): void {
  if (typeof window === "undefined") return
  try {
    track(name, properties)
  } catch {
    /* Analytics must never break the journey. */
  }
}

function flowFor(surface: ConnectSurface): ConnectFlow {
  return readFlow() ?? { id: createId(), surface, startedAt: Date.now() }
}

/** Entering the connect journey. Reuses a live flow so a reload is not a restart. */
export function beginConnectFlow(surface: ConnectSurface): ConnectFlow {
  const existing = readFlow()
  if (existing) return existing
  const flow = { id: createId(), surface, startedAt: Date.now() }
  writeFlow(flow)
  emit("connect_started", { flow_id: flow.id, surface })
  return flow
}

/** The preflight found the business held by another account. This is the
 * signal that separates a blocked squatter from a blocked real owner. */
export function trackConnectClaimBlocked(input: {
  surface: ConnectSurface
  state: "held_by_other" | "held_by_same_account"
}): void {
  const flow = flowFor(input.surface)
  writeFlow(flow)
  emit("connect_claim_blocked", { flow_id: flow.id, surface: input.surface, state: input.state })
}

/** The founder submitted the wizard and the business project was created. */
export function trackConnectSubmitted(input: { surface: ConnectSurface }): void {
  const flow = flowFor(input.surface)
  writeFlow(flow)
  emit("connect_submitted", {
    flow_id: flow.id,
    surface: input.surface,
    time_to_submit_ms: Math.max(0, Math.round(Date.now() - flow.startedAt)),
  })
}

/** The first assessment arrived — the read finished and was paid for. */
export function trackConnectReadCompleted(input: { surface: ConnectSurface }): void {
  const flow = flowFor(input.surface)
  emit("connect_read_completed", {
    flow_id: flow.id,
    surface: input.surface,
    time_to_read_ms: Math.max(0, Math.round(Date.now() - flow.startedAt)),
  })
}

/** Ownership was proven. `attempts` is how many checks it took, not who did it. */
export function trackConnectVerified(input: { method: string; attempts?: number }): void {
  const flow = readFlow()
  emit("connect_verified", {
    flow_id: flow?.id,
    method: input.method,
    attempts: typeof input.attempts === "number" ? input.attempts : undefined,
  })
}

/** The connection is live: proof of ownership plus a call from the founder's app. */
export function trackConnectCompleted(input: { surface: ConnectSurface }): void {
  const flow = flowFor(input.surface)
  emit("connect_completed", {
    flow_id: flow.id,
    surface: input.surface,
    time_to_connect_ms: Math.max(0, Math.round(Date.now() - flow.startedAt)),
  })
}
