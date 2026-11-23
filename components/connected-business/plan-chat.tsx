"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface PlanMessage {
  id: string
  role: "user" | "assistant"
  content: string
  at: number
}

export interface PlanPreparedAction {
  id: string
  toolName: string
  description: string
}

/**
 * The growth planner.
 *
 * It is the same co-founder, on the operate surface: `currentSurface:
 * "business"` removes every build, deploy and plan-at-build tool, so the only
 * things it can propose are marketing, content, campaigns and growth tasks —
 * each of which still needs the founder's explicit approval.
 */
export function PlanChat({
  businessId,
  initialConversationId,
  initialMessages,
}: {
  businessId: string
  initialConversationId: string | null
  initialMessages: PlanMessage[]
}) {
  const [messages, setMessages] = useState<PlanMessage[]>(initialMessages)
  const [actions, setActions] = useState<PlanPreparedAction[]>([])
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    const message = draft.trim()
    if (!message || busy) return
    setBusy(true)
    setError(null)
    setDraft("")
    setMessages((current) => [
      ...current,
      { id: `local_${Date.now()}`, role: "user", content: message, at: Date.now() },
    ])
    try {
      const response = await fetch(`/api/businesses/${businessId}/cofounder`, {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
      })
      const body = (await response.json().catch(() => null)) as
        | {
            data?: { conversationId: string; reply: string; preparedActions: PlanPreparedAction[] }
            error?: { message?: string }
          }
        | null
      if (!response.ok || !body?.data) {
        setError(body?.error?.message ?? "The co-founder could not answer just now.")
        return
      }
      const data = body.data
      setConversationId(data.conversationId)
      setMessages((current) => [
        ...current,
        { id: `reply_${Date.now()}`, role: "assistant", content: data.reply, at: Date.now() },
      ])
      setActions((current) => [...current, ...data.preparedActions])
    } catch {
      setError("The co-founder could not answer just now.")
    } finally {
      setBusy(false)
    }
  }

  async function resolve(action: PlanPreparedAction, decision: "approve" | "reject") {
    const response = await fetch(`/api/cofounder/actions/${action.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ decision }),
    })
    if (response.ok) setActions((current) => current.filter((item) => item.id !== action.id))
  }

  return (
    <section className="rounded-2xl border border-border/80 bg-card p-5 sm:p-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        Plan with your co-founder
      </p>
      <h2 className="mt-1 text-lg font-semibold">What to do next, in your words</h2>

      <div className="mt-4 flex max-h-[26rem] flex-col gap-3 overflow-auto">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ask what to fix first, what to write, or where to find customers. The co-founder reads the site you
            connected, never your code.
          </p>
        ) : null}
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "max-w-[46rem] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm",
              message.role === "user" ? "self-end bg-primary/10" : "self-start bg-muted/50",
            )}
          >
            {message.content}
          </div>
        ))}
        {actions.map((action) => (
          <div key={action.id} className="self-start rounded-xl border border-border bg-background px-3 py-2 text-sm">
            <p className="font-medium">{action.description}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => resolve(action, "approve")}>
                Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => resolve(action, "reject")}>
                Not now
              </Button>
            </div>
          </div>
        ))}
      </div>

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
          rows={2}
          placeholder="What should we work on next?"
          className="min-h-[2.75rem] w-full resize-y rounded-xl border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button type="button" onClick={send} disabled={busy || draft.trim().length === 0}>
          {busy ? "Thinking…" : "Send"}
        </Button>
      </div>
    </section>
  )
}
