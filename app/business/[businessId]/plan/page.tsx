import { NotConnected } from "@/components/connected-business/not-connected"
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
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Plan</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Plan the next move</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          The co-founder reads the site you connected and the assessment built from it. It can propose marketing,
          content, campaigns and growth tasks — never a build, a deploy or a change to your code.
        </p>
      </header>

      {priorities.length > 0 ? (
        <section className="rounded-2xl border border-border/80 bg-card p-5 sm:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Starting points</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {priorities.slice(0, 4).map((priority) => (
              <li key={priority.title} className="text-sm">
                <span className="font-medium">{priority.title}</span>
                <span className="text-muted-foreground"> — {priority.expectedOutcome}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <PlanChat
        businessId={business.id}
        initialConversationId={conversation?.id ?? null}
        initialMessages={messages}
      />
    </div>
  )
}
