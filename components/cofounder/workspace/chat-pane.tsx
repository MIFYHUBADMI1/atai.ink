"use client"

import { useEffect, useRef } from "react"
import { ArrowUp, Mic, SlidersHorizontal, Sparkles, Square } from "lucide-react"

import { CofounderActionCard } from "@/components/cofounder/action-cards"
import { CofounderMarkdown } from "@/components/cofounder/markdown"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { useVoiceDictation } from "@/lib/client/use-voice-dictation"
import type { CofounderConversationMessage } from "@/lib/cofounder/types"
import type {
  CofounderScope,
  CofounderWorkspaceOption,
  CofounderWorklogStep,
} from "@/lib/cofounder/workspace-types"
import { cn } from "@/lib/utils"
import { LiveWorklog } from "./live-worklog"

function scopeKey(scope: CofounderScope): string {
  return scope.kind === "none" ? "none" : `${scope.kind}:${scope.id}`
}

function scopeFromKey(key: string): CofounderScope {
  if (key === "none") return { kind: "none" }
  const [kind, id] = key.split(":")
  return kind === "business" ? { kind: "business", id } : { kind: "project", id }
}

/**
 * The conversation surface.
 *
 * Presentational on purpose: the workspace owns state and transport, so the
 * pane can be rendered with static messages in a test.
 */
export function ChatPane({
  name,
  engineLabel,
  workspaces,
  scope,
  loadingScope,
  onScopeChange,
  messages,
  draft,
  onDraftChange,
  onSend,
  onStop,
  sending,
  steps,
  worklogVisible,
  onHideWorklog,
  error,
  onOpenSettings,
  onActionResolved,
}: {
  name: string
  engineLabel: string
  workspaces: CofounderWorkspaceOption[]
  scope: CofounderScope
  loadingScope: boolean
  onScopeChange: (scope: CofounderScope) => void
  messages: CofounderConversationMessage[]
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  sending: boolean
  steps: CofounderWorklogStep[]
  worklogVisible: boolean
  onHideWorklog: () => void
  error: string | null
  onOpenSettings: () => void
  onActionResolved: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const dictation = useVoiceDictation({ value: draft, setValue: onDraftChange })

  useEffect(() => {
    const viewport = scrollRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [messages, steps.length])

  return (
    <div className="flex h-[calc(100dvh-15rem)] min-h-[26rem] flex-col overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{engineLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="cofounder-scope">
            Conversation scope
          </label>
          <select
            id="cofounder-scope"
            value={scopeKey(scope)}
            disabled={loadingScope || sending}
            onChange={(e) => onScopeChange(scopeFromKey(e.target.value))}
            className="max-w-[12rem] truncate rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary disabled:opacity-60"
          >
            <option value="none">Everything</option>
            {workspaces.map((workspace) => (
              <option key={`${workspace.kind}:${workspace.id}`} value={`${workspace.kind}:${workspace.id}`}>
                {workspace.kind === "business" ? "Business" : "Build"} — {workspace.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Open co-founder settings"
            className="inline-flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground lg:hidden"
          >
            <SlidersHorizontal className="size-4" aria-hidden />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-4 p-4">
          {messages.length === 0 ? (
            <div className="mx-auto my-10 max-w-sm text-center">
              <Sparkles className="mx-auto size-6 text-primary" aria-hidden />
              <p className="mt-3 text-sm font-medium text-foreground">What should we work on?</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Ask about your businesses, your plan, or what to do next. I can look at your workspace and act on it —
                with your approval for anything that matters.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={cn("flex flex-col gap-1.5", message.role === "user" ? "items-end" : "items-start")}
              >
                {message.role === "assistant" ? (
                  <div className="w-full min-w-0">
                    <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      <Sparkles className="size-3 text-primary" aria-hidden />
                      {name}
                    </p>
                    <CofounderMarkdown>{message.content}</CofounderMarkdown>
                  </div>
                ) : (
                  <div className="max-w-[88%] min-w-0 text-right">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                      You
                    </p>
                    <CofounderMarkdown variant="user">{message.content}</CofounderMarkdown>
                  </div>
                )}
                {message.action ? (
                  <div className="w-full max-w-[95%]">
                    <CofounderActionCard message={message} onActionResolved={onActionResolved} />
                  </div>
                ) : null}
              </div>
            ))
          )}

          {worklogVisible ? <LiveWorklog steps={steps} running={sending} onHide={onHideWorklog} /> : null}
          </div>
        </ScrollArea>
      </div>

      {error ? (
        <p role="alert" className="mx-3 mb-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            rows={1}
            placeholder={`Message ${name}…`}
            onChange={(e) => dictation.typeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                onSend()
              }
            }}
            className="max-h-40 min-h-[2.5rem] resize-none"
          />
          <button
            type="button"
            onClick={dictation.toggle}
            aria-label={dictation.listening ? "Stop dictation" : "Dictate a message"}
            aria-pressed={dictation.listening}
            className={cn(
              "inline-flex size-10 shrink-0 items-center justify-center rounded-lg border transition-colors",
              dictation.listening
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <Mic className="size-4" aria-hidden />
          </button>
          {sending ? (
            <Button type="button" size="icon" variant="outline" onClick={onStop} aria-label="Stop the reply">
              <Square className="size-4" aria-hidden />
            </Button>
          ) : (
            <Button type="button" size="icon" onClick={onSend} disabled={!draft.trim()} aria-label="Send message">
              <ArrowUp className="size-4" aria-hidden />
            </Button>
          )}
        </div>
        {dictation.partial ? (
          <p className="mt-1.5 text-[11px] italic text-muted-foreground">{dictation.partial}</p>
        ) : null}
        {dictation.error ? <p className="mt-1.5 text-[11px] text-destructive">{dictation.error}</p> : null}
      </div>
    </div>
  )
}
