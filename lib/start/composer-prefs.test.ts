import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The composer persistence contract: chips (metadata) persist per keystroke in
 * the prefs key, contents ride their own key, and a reload restores the full
 * files — not just name chips.
 */

import {
  COMPOSER_FILE_CONTENTS_KEY,
  COMPOSER_PREFS_KEY,
  loadComposerPrefs,
  saveComposerFileContents,
  saveComposerPrefs,
  type ComposerPrefs,
} from "./composer-prefs"

const basePrefs: ComposerPrefs = {
  prompt: "Build me a tutoring business",
  title: "TutorMatch",
  mode: "idea",
  agents: ["atai"],
  tool: null,
  auto: "auto",
  files: [{ id: "f1", name: "brief.pdf", size: 1000, content: "data:application/pdf;base64,AAAA" }],
}

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.stubGlobal("window", {})
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
  })
})

describe("saveComposerPrefs / loadComposerPrefs", () => {
  it("strips attachment contents from the per-keystroke prefs write", () => {
    saveComposerPrefs(basePrefs)
    const raw = JSON.parse(sessionStorage.getItem(COMPOSER_PREFS_KEY) ?? "{}") as { files: Array<{ content?: string }> }
    expect(raw.files).toHaveLength(1)
    expect(raw.files[0]).not.toHaveProperty("content")
  })

  it("restores contents from the file-contents key on load", () => {
    saveComposerPrefs(basePrefs)
    saveComposerFileContents(basePrefs.files)
    const restored = loadComposerPrefs()
    expect(restored.files).toHaveLength(1)
    expect(restored.files[0].content).toBe("data:application/pdf;base64,AAAA")
    expect(restored.title).toBe("TutorMatch")
  })

  it("keeps metadata-only chips loadable when contents were never saved", () => {
    saveComposerPrefs({ ...basePrefs, files: [{ id: "f2", name: "notes.txt", size: 5 }] })
    const restored = loadComposerPrefs()
    expect(restored.files).toEqual([{ id: "f2", name: "notes.txt", size: 5 }])
  })

  it("drops stale content mappings for chips that no longer exist", () => {
    saveComposerPrefs(basePrefs)
    sessionStorage.setItem(COMPOSER_FILE_CONTENTS_KEY, JSON.stringify({ f1: "data:text/plain;base64,QQ==", gone: "data:text/plain;base64,Wg==" }))
    const restored = loadComposerPrefs()
    expect(restored.files[0].content).toBe("data:text/plain;base64,QQ==")
  })
})
