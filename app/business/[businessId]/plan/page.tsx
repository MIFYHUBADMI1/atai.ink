import { ListChecks } from "lucide-react"

import { NotConnected } from "@/components/connected-business/not-connected"
import { PageHero, SectionCard } from "@/components/connected-business/page-ui"
import { PlanChat, type PlanMessage } from "@/components/connected-business/plan-chat"
import { findBusinessConversation } from "@/lib/connected-business/cofounder"
import { businessPageContext } from "@/lib/connected-business/page-context"
import { businessPriorities } from "@/lib/connected-business/growth"

export const dynamic = "force-dynamic"

/**
 * The growth plan.
 *
 * The founder plans with the co-founder, and the plan is grounded in the same
 * assessment the Overview shows — not in a build plan, which does not exist for
 * a business Atai does not build.
 */
export default async function BusinessPlanPage({
  params,
}: {
  params: Promise<{ businessId: string }>
}) {
  const { businessId } = await params
  const { user, business, project } = await businessPageContext(businessId, "growth.read")

  if (!project) return <NotConnected businessId={business.id} what="a plan" />

  const conversation = await findBusinessConversation(user.id, project.id)
  const messages: PlanMessage[] = (conversation?.messages ?? [])
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({ id: message.id, role: message.role as "user" | "assistant", content: message.content, at: message.at }))

  const priorities = businessPriorities({ project, businessId: business.id })

  return (
    <div className="flex flex-col gap-6">
      <PageHero
        eyebrow="Plan"
        title="Plan the next move"
        description="The co-founder reads the site you connected and the assessment built from it. It can propose marketing, content, campaigns and growth tasks — never a build, a deploy or a change to your code."
      />

      {priorities.length > 0 ? (
        <SectionCard
          icon={ListChecks}
          title="Starting points"
          description="What the assessment says to work on first — ask the co-founder to plan any of these."
        >
          <ul className="flex flex-col gap-2">
            {priorities.slice(0, 4).map((priority) => (
              <li key={priority.title} className="min-w-0 border-t border-border/60 pt-2 text-sm first:border-0 first:pt-0">
                <span className="break-words font-medium">{priority.title}</span>
                <span className="break-words text-muted-foreground"> — {priority.expectedOutcome}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <PlanChat
        businessId={business.id}
        initialConversationId={conversation?.id ?? null}
        initialMessages={messages}
      />
    </div>
  )
}
