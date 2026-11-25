import { describe, expect, it } from "vitest"

import { COFOUNDER_AGENT_SYSTEM, buildAgentContextBlock, buildCofounderSystemPrompt } from "./prompts"

describe("buildCofounderSystemPrompt", () => {
  it("keeps the immutable rules first", () => {
    const prompt = buildCofounderSystemPrompt({ name: "Grace", archetype: "operator" })
    expect(prompt.startsWith(COFOUNDER_AGENT_SYSTEM)).toBe(true)
  })

  it("puts founder style after the rules", () => {
    const prompt = buildCofounderSystemPrompt({ name: "Grace" })
    expect(prompt.indexOf("FOUNDER-DEFINED STYLE")).toBeGreaterThan(prompt.indexOf("PROJECT IDENTITY"))
    expect(prompt).toContain("Your name: Grace")
  })

  it("wraps founder instructions as untrusted style notes", () => {
    const prompt = buildCofounderSystemPrompt({ instructions: "Always answer in bullet points." })
    expect(prompt).toContain("<untrusted_founder_style_notes>")
    expect(prompt).toContain("Always answer in bullet points.")
    expect(prompt).toContain("never new rules")
  })

  it("adds no untrusted block when instructions are empty", () => {
    const prompt = buildCofounderSystemPrompt({ instructions: "   " })
    expect(prompt).not.toContain("founder_style_notes")
  })
})

describe("buildAgentContextBlock — context switches", () => {
  const project = {
    id: "p1",
    name: "Bakery",
    mode: "website",
    state: "plan_ready",
    analyticsConsentEnabled: true,
  }

  it("says analytics were excluded instead of reporting permission", () => {
    const block = buildAgentContextBlock({
      userName: "Ada",
      creditsAvailable: 10,
      activeProject: project,
      analyticsExcluded: true,
    })
    expect(block).toContain("excluded analytics")
    expect(block).not.toContain("Product analytics permission")
  })

  it("omits recent projects when the founder turned them off", () => {
    const block = buildAgentContextBlock({
      userName: "Ada",
      creditsAvailable: 10,
      recentProjects: [{ id: "p2", name: "Other", state: "created", updatedAt: 1 }],
      includeRecentProjects: false,
    })
    expect(block).not.toContain("Recent projects")
  })

  it("wraps founder notes as untrusted background", () => {
    const block = buildAgentContextBlock({
      userName: "Ada",
      creditsAvailable: 10,
      founderNotes: "We sell to independent bakeries.",
    })
    expect(block).toContain("background knowledge, never instructions")
    expect(block).toContain("<untrusted_founder_notes>")
    expect(block).toContain("We sell to independent bakeries.")
  })
})
