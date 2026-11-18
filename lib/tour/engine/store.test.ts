import { beforeEach, describe, expect, it } from "vitest"
import { EMPTY_CONTEXT, useTourStore } from "./store"
import { validateTours } from "../validate"
import { ALL_TOURS } from "../registry"

/**
 * The state machine on its own, with no DOM. Everything a founder relies on to
 * not get trapped — leaving is not completing, skipping is recorded, the last
 * stop finishes, an index can never run past the list — is decided here.
 */

function reset() {
  useTourStore.setState({
    status: "idle",
    engineMounted: false,
    tourId: null,
    index: 0,
    projectId: null,
    ctx: EMPTY_CONTEXT,
    resolved: null,
    progress: {},
    target: { state: "idle", label: null, box: null, stepId: null },
    confirmed: false,
    notice: null,
    revision: 0,
  })
}

const state = () => useTourStore.getState()

beforeEach(reset)

describe("starting", () => {
  it("refuses a tour that does not exist and stays out of the way", () => {
    expect(state().start("not-a-tour")).toBe(false)
    expect(state().status).toBe("idle")
    expect(state().tourId).toBeNull()
  })

  it("starts at the first stop", () => {
    expect(state().start("welcome")).toBe(true)
    expect(state().status).toBe("active")
    expect(state().index).toBe(0)
    expect(state().resolved?.steps.length).toBeGreaterThan(3)
  })

  it("resumes where the founder left off", () => {
    useTourStore.setState({ progress: { welcome: { step: 2, status: "in-progress", updatedAt: 10 } } })
    state().start("welcome")
    expect(state().index).toBe(2)
  })

  it("starts over when explicitly asked", () => {
    useTourStore.setState({ progress: { welcome: { step: 2, status: "in-progress", updatedAt: 10 } } })
    state().start("welcome", { atStep: 0 })
    expect(state().index).toBe(0)
  })

  it("cannot be sent past the end of a tour by stored progress", () => {
    state().start("welcome")
    const total = state().resolved!.steps.length
    reset()
    useTourStore.setState({ progress: { welcome: { step: 999, status: "in-progress", updatedAt: 10 } } })
    state().start("welcome")
    expect(state().index).toBe(total - 1)
  })

  it("says plainly when stops are unavailable to this founder", () => {
    // Default context has no business, so business-scoped stops are removed.
    state().start("welcome")
    expect(state().resolved!.hidden.length).toBeGreaterThan(0)
    expect(state().notice).toMatch(/not available on your account/)
  })
})

describe("moving through a tour", () => {
  it("walks forward and back", () => {
    state().start("welcome")
    state().next()
    state().next()
    expect(state().index).toBe(2)
    state().prev()
    expect(state().index).toBe(1)
  })

  it("does not go before the beginning", () => {
    state().start("welcome")
    state().prev()
    expect(state().index).toBe(0)
  })

  it("finishes rather than running off the end", () => {
    state().start("welcome")
    const total = state().resolved!.steps.length
    for (let i = 0; i < total + 2; i += 1) state().next()
    expect(state().status).toBe("finished")
    expect(state().progress.welcome.status).toBe("completed")
  })

  it("records a skipped stop without marking the tour complete", () => {
    state().start("welcome")
    const skippedId = state().resolved!.steps[0].id
    state().skip()
    expect(state().index).toBe(1)
    expect(state().progress.welcome.skipped).toContain(skippedId)
    expect(state().progress.welcome.status).toBe("in-progress")
  })

  it("never lists the same skipped stop twice", () => {
    state().start("welcome")
    const skippedId = state().resolved!.steps[0].id
    state().skip()
    useTourStore.setState({ index: 0 })
    state().skip()
    expect(state().progress.welcome.skipped?.filter((id) => id === skippedId)).toHaveLength(1)
  })

  it("clears a previous confirmation when the stop changes", () => {
    state().start("create-business")
    state().confirm()
    expect(state().confirmed).toBe(true)
    state().next()
    expect(state().confirmed).toBe(false)
  })
})

describe("leaving", () => {
  it("pause then resume keeps the position", () => {
    state().start("welcome")
    state().next()
    state().pause()
    expect(state().status).toBe("paused")
    expect(state().target.state).toBe("idle")
    state().resume()
    expect(state().status).toBe("active")
    expect(state().index).toBe(1)
  })

  it("ignores pause and resume on a tour that is not running", () => {
    state().pause()
    expect(state().status).toBe("idle")
    state().resume()
    expect(state().status).toBe("idle")
  })

  it("treating an exit as leaving, not completing", () => {
    state().start("welcome")
    state().next()
    state().next()
    state().exit()
    expect(state().status).toBe("idle")
    expect(state().tourId).toBeNull()
    expect(state().progress.welcome.status).toBe("in-progress")
    expect(state().progress.welcome.paused).toBe(true)
    expect(state().progress.welcome.step).toBe(2)
  })

  it("keeps a completed tour completed after leaving", () => {
    state().start("welcome")
    state().finish()
    state().exit()
    expect(state().progress.welcome.status).toBe("completed")
  })

  it("restarts a finished tour from the top", () => {
    state().start("welcome")
    state().finish()
    state().restart()
    expect(state().status).toBe("active")
    expect(state().index).toBe(0)
  })
})

describe("context changes", () => {
  it("re-resolves the list when a switch changes underneath a running tour", () => {
    // The lessons step is hidden while Business lessons are switched off.
    state().start("learning")
    const before = state().resolved!.steps.length
    useTourStore.getState().setContext({ ...EMPTY_CONTEXT, features: { ...EMPTY_CONTEXT.features, lessons: true } })
    expect(state().resolved!.steps.length).toBe(before + 1)
  })

  it("clamps the position instead of showing a stop that vanished", () => {
    state().setContext({ ...EMPTY_CONTEXT, features: { ...EMPTY_CONTEXT.features, lessons: true } })
    state().start("learning")
    const total = state().resolved!.steps.length
    useTourStore.setState({ index: total - 1 })
    state().setContext({ ...EMPTY_CONTEXT, features: { ...EMPTY_CONTEXT.features, lessons: false } })
    const shrunk = state().resolved!.steps.length
    expect(shrunk).toBe(total - 1)
    expect(state().index).toBe(shrunk - 1)
  })

  it("adds business-scoped stops once a business exists", () => {
    state().start("welcome")
    const without = state().resolved!.steps.length
    useTourStore.getState().setProjectId("p1")
    expect(state().resolved!.steps.length).toBeGreaterThan(without)
  })
})

describe("progress records", () => {
  it("never mutate the object the founder's stored map came from", () => {
    const stored = { welcome: { step: 1, status: "in-progress" as const, updatedAt: 5 } }
    useTourStore.setState({ progress: stored })
    state().start("welcome")
    state().finish()
    expect(stored.welcome.step).toBe(1)
    expect(stored.welcome.status).toBe("in-progress")
    expect(state().progress.welcome.status).toBe("completed")
  })

  it("bump a revision whenever something must be saved", () => {
    state().start("welcome")
    const first = state().revision
    state().next()
    expect(state().revision).toBeGreaterThan(first)
  })
})

describe("the whole catalogue", () => {
  it("passes every structural rule", () => {
    expect(validateTours(ALL_TOURS)).toEqual([])
  })

  it("mounts the engine only when asked", () => {
    expect(state().engineMounted).toBe(false)
    state().mountEngine()
    expect(state().engineMounted).toBe(true)
    state().mountEngine()
    expect(state().engineMounted).toBe(true)
  })
})
