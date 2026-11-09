import { describe, expect, it } from "vitest"
import {
  appendFinal,
  readSpeechEvent,
  speechRecognitionErrorMessage,
} from "@/lib/start/browser-speech"

function event(results: Array<{ isFinal: boolean; transcript: string }>, resultIndex = 0) {
  const list = {
    length: results.length,
    ...Object.fromEntries(results.map((result, i) => [i, { isFinal: result.isFinal, 0: { transcript: result.transcript } }])),
  }
  return { resultIndex, results: list }
}

describe("browser speech", () => {
  it("reads only results from resultIndex onward", () => {
    // Results 0 was committed by an earlier event — it must not be re-read.
    const { finalized, partial } = readSpeechEvent(
      event(
        [
          { isFinal: true, transcript: "Build a booking app" },
          { isFinal: false, transcript: "for clinics" },
        ],
        1,
      ),
    )
    expect(finalized).toEqual([])
    expect(partial).toBe("for clinics")
  })

  it("splits finalized segments from the live partial", () => {
    const { finalized, partial } = readSpeechEvent(
      event([
        { isFinal: true, transcript: "Build a booking app" },
        { isFinal: true, transcript: "for clinics" },
        { isFinal: false, transcript: "with payments" },
      ]),
    )
    expect(finalized).toEqual(["Build a booking app", "for clinics"])
    expect(partial).toBe("with payments")
  })

  it("ignores empty transcripts", () => {
    const { finalized, partial } = readSpeechEvent(event([{ isFinal: true, transcript: "   " }]))
    expect(finalized).toEqual([])
    expect(partial).toBe("")
  })

  it("appends final dictation to the base text", () => {
    expect(appendFinal("Build a SaaS", "for clinics")).toBe("Build a SaaS for clinics")
    expect(appendFinal("", "hello")).toBe("hello")
    expect(appendFinal("hello ", "")).toBe("hello")
    expect(appendFinal("text with trailing    ", "more")).toBe("text with trailing more")
  })

  it("explains permission, hardware, and network errors; ignores silence", () => {
    expect(speechRecognitionErrorMessage("not-allowed")).toMatch(/Microphone/)
    expect(speechRecognitionErrorMessage("audio-capture")).toMatch(/microphone/i)
    expect(speechRecognitionErrorMessage("network")).toMatch(/network/)
    expect(speechRecognitionErrorMessage("no-speech")).toBeNull()
    expect(speechRecognitionErrorMessage("aborted")).toBeNull()
  })
})
