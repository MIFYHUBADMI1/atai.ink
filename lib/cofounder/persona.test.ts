import { describe, expect, it } from "vitest"

import {
  COFOUNDER_ARCHETYPES,
  DEFAULT_COFOUNDER_ARCHETYPE_ID,
  DEFAULT_COFOUNDER_NAME,
  MAX_COFOUNDER_INSTRUCTIONS_LENGTH,
  MAX_COFOUNDER_NAME_LENGTH,
  clampDetail,
  clampDirectness,
  detailLabel,
  directnessLabel,
  isCofounderArchetypeId,
  normaliseCofounderName,
  personaInstructions,
  personaStyleLines,
  resolveArchetype,
} from "./persona"

describe("persona — defaults", () => {
  it("defaults the archetype to strategic", () => {
    expect(resolveArchetype(undefined).id).toBe(DEFAULT_COFOUNDER_ARCHETYPE_ID)
    expect(resolveArchetype("does-not-exist").id).toBe("strategic")
    expect(COFOUNDER_ARCHETYPES[0].id).toBe("strategic")
  })

  it("defaults the name to Co-founder", () => {
    expect(normaliseCofounderName(undefined)).toBe(DEFAULT_COFOUNDER_NAME)
    expect(normaliseCofounderName("")).toBe(DEFAULT_COFOUNDER_NAME)
    expect(normaliseCofounderName("   ")).toBe(DEFAULT_COFOUNDER_NAME)
  })

  it("defaults both sliders to the middle", () => {
    expect(clampDetail(undefined)).toBe(3)
    expect(clampDirectness(undefined)).toBe(3)
    expect(detailLabel(3)).toBe("Balanced")
    expect(directnessLabel(3)).toBe("Direct")
  })
})

describe("persona — clamping", () => {
  it("keeps detail and directness inside 1–5", () => {
    expect(clampDetail(0)).toBe(1)
    expect(clampDetail(9)).toBe(5)
    expect(clampDirectness(-4)).toBe(1)
    expect(clampDirectness(42)).toBe(5)
  })

  it("rounds fractional values", () => {
    expect(clampDetail(2.4)).toBe(2)
    expect(clampDetail(2.6)).toBe(3)
  })

  it("falls back on non-numeric input", () => {
    expect(clampDetail("abc")).toBe(3)
    expect(clampDirectness(null)).toBe(3)
  })
})

describe("persona — name sanitization", () => {
  it("strips control characters and collapses whitespace", () => {
    expect(normaliseCofounderName("Ada\u0000\u0007  Lovelace")).toBe("Ada Lovelace")
    expect(normaliseCofounderName("line\nbreak")).toBe("line break")
  })

  it("bounds the name length", () => {
    const long = "x".repeat(200)
    expect(normaliseCofounderName(long)).toHaveLength(MAX_COFOUNDER_NAME_LENGTH)
  })
})

describe("persona — prompt lines", () => {
  it("names the founder's chosen identity and tone", () => {
    const lines = personaStyleLines({
      name: "Grace",
      archetype: "challenger",
      detail: 4,
      directness: 5,
    }).join("\n")
    expect(lines).toContain("FOUNDER-DEFINED STYLE (tone only — the rules above always win):")
    expect(lines).toContain("Your name: Grace")
    expect(lines).toContain("Archetype (Challenger)")
    expect(lines).toContain("Detail level: 4/5")
    expect(lines).toContain("Directness level: 5/5")
  })

  it("trims and bounds founder instructions", () => {
    expect(personaInstructions({ instructions: "  keep it short  " })).toBe("keep it short")
    expect(personaInstructions({ instructions: undefined })).toBe("")
    expect(personaInstructions({ instructions: "x".repeat(5000) })).toHaveLength(
      MAX_COFOUNDER_INSTRUCTIONS_LENGTH,
    )
  })

  it("recognises only catalog archetype ids", () => {
    expect(isCofounderArchetypeId("operator")).toBe(true)
    expect(isCofounderArchetypeId("nope")).toBe(false)
    expect(isCofounderArchetypeId(7)).toBe(false)
  })
})
