import { describe, expect, it } from "vitest"
import { getRelevantLearningPaths } from "./business-intelligence"
import { getResourceById } from "./index"
import type { ProjectState } from "@/lib/types/project"

const STAGES: ProjectState[] = [
  "plan_ready",
  "building",
  "deployed",
  "growing",
] as ProjectState[]

describe("getRelevantLearningPaths", () => {
  it("returns paths for every stage", () => {
    for (const state of STAGES) {
      expect(getRelevantLearningPaths(state).length, state).toBeGreaterThan(0)
    }
  })

  it("gives every step a routable href", () => {
    for (const state of STAGES) {
      for (const path of getRelevantLearningPaths(state)) {
        expect(path.resources.length, path.id).toBeGreaterThan(0)
        for (const resource of path.resources) {
          expect(resource.href, `${path.id}/${resource.slug}`).toBe(
            `/resources/${resource.category}/${resource.slug}`,
          )
          expect(getResourceById(`${resource.category}/${resource.slug}`)).toBeTruthy()
        }
      }
    }
  })

  it("ships summaries, not full article bodies", () => {
    for (const state of STAGES) {
      for (const path of getRelevantLearningPaths(state)) {
        for (const resource of path.resources) {
          expect(resource).not.toHaveProperty("body")
          expect(resource).not.toHaveProperty("contentMarkdown")
          expect(typeof resource.searchText).toBe("string")
        }
      }
    }
  })
})