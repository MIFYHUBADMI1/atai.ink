import { createOpenAICompatible } from "@ai-sdk/openai-compatible"

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

const openrouter = createOpenAICompatible({
  name: "openrouter",
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: OPENROUTER_BASE_URL,
})

/** 
 * Shared model used by all AI analysis steps (understanding + specification).
 * Model can be changed via OPENROUTER_MODEL environment variable.
 * Defaults to OPENROUTER_FREE_MODEL if OPENROUTER_MODEL is not set.
 * Falls back to openrouter/auto if neither is configured.
 */
const modelName = process.env.OPENROUTER_MODEL 
  || process.env.OPENROUTER_FREE_MODEL 
  || "openrouter/auto"

export const MODEL = openrouter.chatModel(modelName)

/** The resolved id, for callers that need the raw HTTP shape (see raw-chat). */
export const MODEL_ID = modelName

/** Build a chat model handle for an explicit OpenRouter model id — used by
 * per-user model selection (e.g. the co-founder's tier picker) without
 * disturbing the shared default MODEL. */
export function openRouterChatModel(id: string) {
  return openrouter.chatModel(id)
}

console.log(`[AI Model] Using: ${modelName}`)

