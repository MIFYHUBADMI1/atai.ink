import { describe, expect, it } from "vitest"
import { normalizeCompetitors, parseCompetitorOutput, readResourcesCompetitors, replayCompetitors, sanitizeCompetitorUrl } from "./competitor-schema"

describe("competitor output validation", () => {
  it("accepts raw and singly fenced JSON and missing optional values", () => {
    for (const input of ['[{"name":"Acme"}]', '```json\n[{"name":"Acme","pricing":null,"strengths":[]}]\n```']) {
      expect(parseCompetitorOutput(input).competitors).toEqual([{ name: "Acme" }])
    }
  })
  it.each(['{}', '[]', '[null]', '[[]]', '[{"name":1}]', '[{"name":""}]', '[{"name":"Acme","strengths":"great"}]', '[{"name":"Acme","pricing":42}]', '[{"name":"Acme","verified":true}]', '[{"name":"Acme"', 'Here are suggestions: [{"name":"Acme"}]', '[{"name":"Acme"}] [{"name":"Other"}]'])('rejects malformed or unexpected output: %s', (input) => {
    expect(() => parseCompetitorOutput(input)).toThrow()
  })
  it.each(['javascript:alert(1)', 'data:text/html,bad', 'file:///etc/passwd', 'http://127.0.0.1', 'http://2130706433', 'http://0x7f000001', 'http://[::1]', 'https://user:secret@acme.example', 'http://metadata.google.internal', 'http://thing.local', 'https://acme.example:8080', 'https://acme.example/\nbad'])('rejects unsafe URLs: %s', (url) => {
    expect(sanitizeCompetitorUrl(url)).toBeUndefined()
    expect(() => parseCompetitorOutput(JSON.stringify([{ name: "Acme", url }]))).toThrow()
  })
  it("normalizes domains and duplicate company names", () => {
    const result = parseCompetitorOutput(JSON.stringify([
      { name: "Acme", url: "https://WWW.ACME.EXAMPLE/" },
      { name: " acme " }, { name: "Acme Incorporated", url: "https://acme.example/pricing" },
      { name: "Other" },
    ]))
    expect(result.competitors.map((c) => c.name)).toEqual(["Acme", "Other"])
    expect(result.duplicates).toBe(2)
    expect(result.competitors[0].url).toBe("https://www.acme.example/")
  })
  it("does not mutate or reject the complete legacy cache for a malformed row", () => {
    const cache = { competitors: { data: [{ name: "Legacy", founded: "2001", url: "https://legacy.example" }, null, { name: "Broken link", url: "javascript:alert(1)" }], generatedAt: 1700000000000 }, marketResearch: { text: "Keep me" } }
    const before = structuredClone(cache)
    const read = readResourcesCompetitors(cache)
    expect(read).toMatchObject({ sourceSection: "resources", status: "ai_suggestion", verificationStatus: "unverified", generatedAt: 1700000000000, omittedEntries: 1 })
    expect(read.competitors[0]).toMatchObject({ name: "Legacy", founded: "2001", url: "https://legacy.example/" })
    expect(read.competitors[1].url).toBeUndefined()
    expect(cache).toEqual(before)
  })
  it("keeps complete legacy text and lists while bounding new model output", () => {
    const legacy = { name: "Legacy", competitiveEdge: "Detailed positioning. ".repeat(40), strengths: Array.from({ length: 10 }, (_, index) => `Strength ${index}: ${"Detail. ".repeat(40)}`) }
    const cache = { competitors: { data: [legacy], generatedAt: 123 } }
    expect(readResourcesCompetitors(cache).competitors).toEqual([{ ...legacy, competitiveEdge: legacy.competitiveEdge.trim(), strengths: legacy.strengths.map((strength) => strength.trim()) }])
    expect(() => parseCompetitorOutput(JSON.stringify([legacy]))).toThrow()
  })
  it.each([undefined, null, {}, { competitors: { data: {} } }])("handles an absent or malformed cache", (cache) => {
    expect(readResourcesCompetitors(cache).competitors).toEqual([])
    expect(readResourcesCompetitors(cache).generatedAt).toBeNull()
  })
  it("only replays a stored result with its exact intent identity", () => {
    const cache = { competitors: { data: [{ name: "Acme" }], generatedAt: 1, intentKey: "intent_1" } }
    expect(replayCompetitors(cache, "intent_1")).toEqual({ competitors: [{ name: "Acme" }], generatedAt: 1 })
    expect(replayCompetitors(cache, "intent_2")).toBeNull()
    expect(replayCompetitors(cache, undefined)).toBeNull()
    expect(normalizeCompetitors([null, { name: "Acme", strengths: [null, "Useful"] }]).competitors).toEqual([{ name: "Acme", strengths: ["Useful"] }])
  })
})
