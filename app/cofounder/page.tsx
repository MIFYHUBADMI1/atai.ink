import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { CofounderWorkspace } from "./cofounder-workspace"
import { getCurrentUser } from "@/lib/auth/session"
import { store } from "@/lib/store/store"
import { businessWorkspaceAccess } from "@/lib/business/flags"
import { listBusinessesForUser } from "@/lib/business/service"
import { userActor } from "@/lib/business/permissions"
import { getLatestCofounderConversation } from "@/lib/cofounder/conversation"
import { listCofounderTiers } from "@/lib/cofounder/model-catalog"
import { readCofounderModelTier, resolveCofounderModel } from "@/lib/cofounder/model"
import { COFOUNDER_ARCHETYPES } from "@/lib/cofounder/persona"
import {
  COFOUNDER_HISTORY_DEPTHS,
  MAX_COFOUNDER_INSTRUCTIONS_LENGTH,
  MAX_COFOUNDER_NAME_LENGTH,
  MAX_COFOUNDER_NOTES_LENGTH,
  readCofounderSettings,
} from "@/lib/cofounder/profile"
import { listToolCatalog } from "@/lib/cofounder/tool-registry"
import type { CofounderWorkspaceConfig, CofounderWorkspaceOption } from "@/lib/cofounder/workspace-types"

export const metadata: Metadata = {
  title: "Co-founder",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

/**
 * The dedicated co-founder workspace — server component.
 *
 * Reads everything the rail and the transcript need, then hands a serializable
 * config to the client. Connected businesses are listed only while the
 * workspace rollout is open for this account, so a closed surface never leaks
 * their names into a picker.
 */
export default async function CofounderPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login?next=%2Fcofounder")

  const [settings, tiers, storedTier, resolved, projects, latest, access] = await Promise.all([
    readCofounderSettings(user.id),
    listCofounderTiers(),
    readCofounderModelTier(user.id),
    resolveCofounderModel(user.id),
    store.listProjects(user.id),
    getLatestCofounderConversation(user.id),
    businessWorkspaceAccess(user.id),
  ])

  const businesses = access.enabled
    ? await listBusinessesForUser({ actor: userActor(user.id) }).catch(() => [])
    : []

  const workspaces: CofounderWorkspaceOption[] = [
    ...projects
      .filter((project) => project.startingPoint !== "existing_business" && !project.businessId)
      .map((project) => ({
        kind: "project" as const,
        id: project.id,
        name: project.name,
        state: project.state,
      })),
    ...businesses.map((business) => ({
      kind: "business" as const,
      id: business.id,
      name: business.name,
      state: business.status,
    })),
  ]

  // Only a global transcript opens on the global tab. A project or business
  // conversation is loaded when its scope is selected, never replayed here.
  const initialConversation = latest && !latest.activeProjectId ? latest : null

  const config: CofounderWorkspaceConfig = {
    settings,
    archetypes: COFOUNDER_ARCHETYPES,
    toolCatalog: listToolCatalog(),
    tiers: [...tiers],
    engine: {
      tierId: resolved.tier.id,
      tierName: resolved.tier.name,
      modelId: resolved.modelId,
      creditsPerMessage: resolved.tier.creditsPerMessage,
    },
    storedTierId: storedTier ?? null,
    envTierId: process.env.COFOUNDER_MODEL_TIER?.trim() || null,
    workspaces,
    initialScope: { kind: "none" },
    initialConversationId: initialConversation?.id ?? null,
    initialMessages: initialConversation?.messages ?? [],
    limits: {
      name: MAX_COFOUNDER_NAME_LENGTH,
      instructions: MAX_COFOUNDER_INSTRUCTIONS_LENGTH,
      notes: MAX_COFOUNDER_NOTES_LENGTH,
      historyDepths: COFOUNDER_HISTORY_DEPTHS,
    },
  }

  return <CofounderWorkspace config={config} />
}
