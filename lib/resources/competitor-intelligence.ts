import "server-only"
import { store } from "@/lib/store/store"
import { AppError } from "@/lib/errors"
import { readResourcesCompetitors } from "./competitor-schema"

export async function getResourcesCompetitorIntelligence(userId: string, projectId: string) {
  const project = await store.getProject(projectId)
  if (!project || project.userId !== userId) throw new AppError("UNAUTHORIZED_PROJECT_ACCESS")
  return readResourcesCompetitors((project as typeof project & { resourcesCache?: unknown }).resourcesCache)
}
