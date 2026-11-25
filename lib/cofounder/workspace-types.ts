/**
 * Serializable shapes shared by the co-founder workspace client and the API
 * routes. Client-safe by construction: only type imports from isomorphic
 * modules, never a server-only one.
 */

import type { CofounderArchetype } from "./persona"
import type { CofounderModelTier } from "./models"
import type { CofounderConversationMessage } from "./types"

export type CofounderScope =
  | { kind: "none" }
  | { kind: "project"; id: string }
  | { kind: "business"; id: string }

export interface CofounderProfileView {
  name: string
  archetype: string
  detail: number
  directness: number
  instructions: string
}

export interface CofounderContextView {
  historyDepth: number
  includePlanBrief: boolean
  includeAnalytics: boolean
  includeRecentProjects: boolean
  includeBusinessAssessment: boolean
  notes: string
}

export interface CofounderToolsView {
  disabledTools: string[]
  allowConsequential: boolean
}

export interface CofounderSettingsView {
  profile: CofounderProfileView
  context: CofounderContextView
  tools: CofounderToolsView
}

export interface CofounderToolView {
  name: string
  description: string
  risk: string
  requiresConfirmation: boolean
  surfaces: Array<"build" | "operate">
}

export interface CofounderWorkspaceOption {
  kind: "project" | "business"
  id: string
  name: string
  state?: string
  subtitle?: string
}

export interface CofounderEngineView {
  tierId: string
  tierName: string
  modelId: string
  creditsPerMessage: number
}

export interface CofounderLimitsView {
  name: number
  instructions: number
  notes: number
  historyDepths: readonly number[]
}

export interface CofounderWorkspaceConfig {
  settings: CofounderSettingsView
  archetypes: readonly CofounderArchetype[]
  toolCatalog: CofounderToolView[]
  tiers: CofounderModelTier[]
  engine: CofounderEngineView
  storedTierId: string | null
  envTierId: string | null
  workspaces: CofounderWorkspaceOption[]
  initialScope: CofounderScope
  initialConversationId: string | null
  initialMessages: CofounderConversationMessage[]
  limits: CofounderLimitsView
}

export interface CofounderWorklogStep {
  id: string
  toolName: string
  status: "running" | "done" | "error"
  label: string
}

export interface CofounderStreamAction {
  id: string
  toolName: string
  description: string
}

export interface CofounderStreamDone {
  conversationId: string
  reply: string
  messages: CofounderConversationMessage[]
  preparedActions: CofounderStreamAction[]
  maxToolSteps: number
  scope: CofounderScope
}

export interface CofounderSettingsPatchView {
  profile?: Partial<CofounderProfileView>
  context?: Partial<CofounderContextView>
  tools?: Partial<CofounderToolsView>
}
