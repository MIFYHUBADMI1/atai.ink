"use client"

import { useEffect, useRef, useState } from "react"
import { MessagesSquare, Send, Sparkles, UserRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SectionCard } from "@/components/connected-business/page-ui"
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

const OPENERS = [
  "What should I fix first on my site?",
  "Write a homepage headline in my voice.",
  "Where should I look for my first customers?",
] as const

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
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" })
  }, [messages.length, actions.length, busy])

  async function send(text?: string) {
    const message = (text ?? draft).trim()
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
    <SectionCard
      icon={MessagesSquare}
      title="Plan with your co-founder"
      description="It reads the site you connected, never your code. Anything it proposes needs your approval before it runs."
    >
      <div className="flex max-h-[26rem] min-h-[10rem] flex-col gap-3 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border bg-muted/20 p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="size-4 text-primary" aria-hidden />
              Ask what to fix first, what to write, or where to find customers.
            </p>
            <div className="flex flex-wrap gap-2">
              {OPENERS.map((opener) => (
                <button
                  key={opener}
                  type="button"
                  onClick={() => void send(opener)}
                  disabled={busy}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground disabled:opacity-50"
                >
                  {opener}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "flex max-w-[46rem] items-start gap-2",
              message.role === "user" ? "self-end flex-row-reverse" : "self-start",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full",
                message.role === "user" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              {message.role === "user" ? <UserRound className="size-3.5" /> : <Sparkles className="size-3.5" />}
            </span>
            <div
              className={cn(
                "min-w-0 whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-6",
                message.role === "user" ? "bg-primary/10" : "bg-muted/50",
              )}
            >
              {message.content}
            </div>
          </div>
        ))}

        {busy ? (
          <div className="flex items-center gap-2 self-start rounded-2xl bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            <span className="flex gap-1" aria-hidden>
              <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-current" />
            </span>
            Thinking…
          </div>
        ) : null}

        {actions.map((action) => (
          <div
            key={action.id}
            className="self-start rounded-2xl border border-primary/20 bg-primary/5 px-3 py-2 text-sm"
          >
            <p className="font-medium">{action.description}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Nothing runs until you approve it.</p>
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
        <div ref={endRef} />
      </div>

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
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
          aria-label="Message your co-founder"
          placeholder="What should we work on next?"
          className="min-h-[2.75rem] w-full resize-y rounded-xl border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button type="button" onClick={() => void send()} disabled={busy || draft.trim().length === 0} className="shrink-0">
          <Send className="mr-2 size-4" aria-hidden />
          {busy ? "Thinking…" : "Send"}
        </Button>
      </div>
    </SectionCard>
  )
}
