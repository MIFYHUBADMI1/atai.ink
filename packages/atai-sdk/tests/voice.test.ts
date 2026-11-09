/**
 * @atai-group/sdk — voice result helpers.
 */

import { describe, expect, it } from "vitest"
import { VoiceCapability } from "../src/capabilities/voice"
import type { VoiceSynthesizeResult } from "../src/types"

const RESULT: VoiceSynthesizeResult = {
  audioBase64: "SUQzBA==",
  mimeType: "audio/mpeg",
  voiceId: "voice-1234567890",
  modelId: "eleven_flash_v2_5",
  characters: 3,
}

describe("VoiceCapability.toDataUrl", () => {
  it("wraps base64 audio in a playable data URL", () => {
    const voice = new VoiceCapability({} as never)
    expect(voice.toDataUrl(RESULT)).toBe("data:audio/mpeg;base64,SUQzBA==")
  })
})
