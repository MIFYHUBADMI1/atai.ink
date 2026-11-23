import { describe, expect, it } from "vitest"
import type { BusinessAssessment } from "@/lib/types/business-intake"
import type { MirrorProject } from "@/lib/types/project"
import { businessNextMoves, businessPriorities } from "./growth"

function project(priorities: unknown[], objectives: string[] = []): MirrorProject {
  return {
    id: "p1",
    userId: "u1",
    intake: {
      collectedAt: 1,
      objectives,
      assessment: { status: "completed", result: { priorities } as BusinessAssessment },
    },
  } as unknown as MirrorProject
}

const stored = {
  title: "Rewrite the hero",
  explanation: "The hero states what you sell but not who it is for.",
  whyItMatters: "A visitor cannot tell in one line whether this is for them.",
  expectedOutcome: "More visitors start the signup flow.",
  priority: "immediate",
  ataiSection: "Growth",
  route: "/project/p1/market",
  executableNow: true,
}

describe("businessPriorities", () => {
  it("re-addresses a stored priority onto the business surface", () => {
    const [priority] = businessPriorities({ project: project([stored]), businessId: "biz_1" })

    expect(priority?.priority).toBe("immediate")
    expect(priority?.href).toBe("/business/biz_1/market")
  })

  it("reads a priority written before the horizon existed as the neutral one", () => {
    const [priority] = businessPriorities({
      project: project([{ title: "Rewrite the hero", explanation: "The hero is vague." }]),
      businessId: "biz_1",
    })

    expect(priority?.priority).toBe("short_term")
    expect(priority?.href).toBe("")
  })

  it("offers no route when Atai has no surface for the priority", () => {
    const [priority] = businessPriorities({
      project: project([{ ...stored, route: "", executableNow: false, needs: "A CRM" }]),
      businessId: "biz_1",
    })

    expect(priority?.href).toBe("")
    expect(priority?.needs).toBe("A CRM")
  })

  it("survives a project whose assessment never produced a result", () => {
    const empty = { id: "p1", userId: "u1" } as unknown as MirrorProject

    expect(businessPriorities({ project: empty, businessId: "biz_1" })).toEqual([])
    expect(businessNextMoves({ project: empty, userId: "u1", businessId: "biz_1" })).toEqual([])
  })
})
