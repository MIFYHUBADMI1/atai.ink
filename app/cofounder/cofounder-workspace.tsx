"use client"

import { useCallback, useRef, useState } from "react"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { ChatPane } from "@/components/cofounder/workspace/chat-pane"
import { ControlRail } from "@/components/cofounder/workspace/control-rail"
import {
  CreditsShortfallDialog,
  type JourneyCost,
} from "@/components/existing-business/credits-shortfall-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { jsonFetcher, patchJson, type ApiError } from "@/lib/client/api"
import { sendCofounderStream } from "@/lib/client/cofounder-stream"
import type { CofounderModelTier } from "@/lib/cofounder/models"
import type { CofounderConversationMessage } from "@/lib/cofounder/types"
import type {
  CofounderScope,
  CofounderSettingsPatchView,
  CofounderSettingsView,
  CofounderWorklogStep,
  CofounderWorkspaceConfig,
} from "@/lib/cofounder/workspace-types"

function localId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * The dedicated co-founder workspace.
 *
 * Owns the transcript, the settings draft and the stream. The pane and the rail
 * are presentational; this component is the only place that talks to
 * `/api/cofounder/stream`.
 */
export function CofounderWorkspace({ config }: { config: CofounderWorkspaceConfig }) {
  const [settings, setSettings] = useState<CofounderSettingsView>(config.settings)
  const [engine, setEngine] = useState(config.engine)
  const [scope, setScope] = useState<CofounderScope>(config.initialScope)
  const [conversationId, setConversationId] = useState<string | null>(config.initialConversationId)
  const [messages, setMessages] = useState<CofounderConversationMessage[]>(config.initialMessages)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [loadingScope, setLoadingScope] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [steps, setSteps] = useState<CofounderWorklogStep[]>([])
  const [worklogVisible, setWorklogVisible] = useState(false)
  const [mobileRailOpen, setMobileRailOpen] = useState(false)
  const [shortfall, setShortfall] = useState<JourneyCost | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const refreshConversation = useCallback(async () => {
    const params = new URLSearchParams({ scope: scope.kind })
    if (scope.kind !== "none") params.set("scopeId", scope.id)
    const data = await jsonFetcher<{
      conversation: { id: string; messages: CofounderConversationMessage[] } | null
    }>(`/api/cofounder?${params.toString()}`)
    setConversationId(data.conversation?.id ?? null)
    setMessages(data.conversation?.messages ?? [])
  }, [scope])

  async function changeScope(next: CofounderScope) {
    if (loadingScope || sending) return
    if (next.kind === scope.kind && (next.kind === "none" || next.id === (scope as { id: string }).id)) return
    setLoadingScope(true)
    setError(null)
    const params = new URLSearchParams({ scope: next.kind })
    if (next.kind !== "none") params.set("scopeId", next.id)
    try {
      const data = await jsonFetcher<{
        conversation: { id: string; messages: CofounderConversationMessage[] } | null
      }>(`/api/cofounder?${params.toString()}`)
      setScope(next)
      setConversationId(data.conversation?.id ?? null)
      setMessages(data.conversation?.messages ?? [])
      setSteps([])
      setWorklogVisible(false)
    } catch (e) {
      setError((e as ApiError).message || "That conversation didn't load. Your current one is still here.")
    } finally {
      setLoadingScope(false)
    }
  }

  async function send() {
    const text = draft.trim()
    if (!text || sending) return

    const optimistic: CofounderConversationMessage = { id: localId("local_user"), role: "user", content: text, at: Date.now() }
    const placeholder: CofounderConversationMessage = { id: localId("local_reply"), role: "assistant", content: "", at: Date.now() }
    setMessages((prev) => [...prev, optimistic, placeholder])
    setDraft("")
    setError(null)
    setSending(true)
    setSteps([])
    setWorklogVisible(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const done = await sendCofounderStream({
        message: text,
        ...(conversationId ? { conversationId } : {}),
        scope,
        signal: controller.signal,
        onDelta: (chunk) => {
          setMessages((prev) =>
            prev.map((message) => (message.id === placeholder.id ? { ...message, content: message.content + chunk } : message)),
          )
        },
        onStep: (step) => {
          setSteps((prev) => {
            const index = prev.findIndex((existing) => existing.id === step.id)
            if (index === -1) return [...prev, step]
            const next = [...prev]
            next[index] = step
            return next
          })
        },
      })
      setConversationId(done.conversationId)
      setMessages(done.messages)
      setWorklogVisible(false)
    } catch (e) {
      const err = e as ApiError
      if (err.code === "STOPPED") {
        // The server keeps whatever text it produced; re-read it rather than
        // guessing how much of the stream the browser saw.
        try {
          await refreshConversation()
        } catch {
          // keep the partial text already on screen
        }
      } else {
        setMessages((prev) => prev.filter((message) => message.id !== placeholder.id && message.id !== optimistic.id))
        setDraft(text)
        if (err.code === "INSUFFICIENT_CREDITS") {
          const required = Number(err.meta?.required ?? 0)
          const available = Number(err.meta?.available ?? 0)
          const engineCost = Number(err.meta?.engineCost ?? 0)
          setShortfall({
            readCost: 0,
            assessmentCost: required,
            ...(engineCost > 0 ? { engineCost } : {}),
            ...(typeof err.meta?.engine === "string" ? { engineName: err.meta.engine } : {}),
            required,
            available,
            shortfall: Math.max(0, required - available),
          })
        } else {
          setError(err.message || "The co-founder couldn't answer. Please try again.")
        }
      }
    } finally {
      setSending(false)
      abortRef.current = null
    }
  }

  function stop() {
    abortRef.current?.abort()
  }

  async function saveSettings(patch: CofounderSettingsPatchView) {
    setSavingSettings(true)
    setError(null)
    try {
      const data = await patchJson<{ settings: CofounderSettingsView }>("/api/cofounder/settings", patch)
      setSettings(data.settings)
    } catch (e) {
      setError((e as ApiError).message || "Those settings didn't save. Please try again.")
    } finally {
      setSavingSettings(false)
    }
  }

  function handleEngineChange(tier: CofounderModelTier) {
    setEngine({
      tierId: tier.id,
      tierName: tier.name,
      modelId: tier.modelId,
      creditsPerMessage: tier.creditsPerMessage,
    })
  }

  const rail = (
    <ControlRail
      settings={settings}
      archetypes={config.archetypes}
      toolCatalog={config.toolCatalog}
      engine={engine}
      tiers={config.tiers}
      storedTierId={config.storedTierId}
      envTierId={config.envTierId}
      limits={config.limits}
      saving={savingSettings}
      onSave={saveSettings}
      onEngineChange={handleEngineChange}
    />
  )

  return (
    <DashboardShell title="Co-founder">
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <header className="mb-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Co-founder</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Work with your co-founder
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            A real conversation about your business. It can read your workspace and prepare actions — anything that
            changes something waits for your approval.
          </p>
          <span className="mt-3 inline-flex items-center rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            {engine.tierName}
            {engine.creditsPerMessage > 0 ? ` · ${engine.creditsPerMessage} credits/message` : " · free"}
          </span>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <ChatPane
            name={settings.profile.name}
            engineLabel={`${engine.tierName}${engine.creditsPerMessage > 0 ? ` · ${engine.creditsPerMessage} credits/message` : " · free"}`}
            workspaces={config.workspaces}
            scope={scope}
            loadingScope={loadingScope}
            onScopeChange={(next) => void changeScope(next)}
            messages={messages}
            draft={draft}
            onDraftChange={setDraft}
            onSend={() => void send()}
            onStop={stop}
            sending={sending}
            steps={steps}
            worklogVisible={worklogVisible}
            onHideWorklog={() => setWorklogVisible(false)}
            error={error}
            onOpenSettings={() => setMobileRailOpen(true)}
            onActionResolved={() => void refreshConversation().catch(() => undefined)}
          />
          <aside className="hidden lg:block">
            <div className="sticky top-4 max-h-[calc(100dvh-15rem)] overflow-y-auto pr-1">{rail}</div>
          </aside>
        </div>
      </div>

      <Dialog open={mobileRailOpen} onOpenChange={setMobileRailOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Co-founder settings</DialogTitle>
            <DialogDescription>Change how your co-founder sounds, what it sees and what it may do.</DialogDescription>
          </DialogHeader>
          {rail}
        </DialogContent>
      </Dialog>

      <CreditsShortfallDialog
        open={shortfall !== null}
        onOpenChange={(next) => {
          if (!next) setShortfall(null)
        }}
        cost={shortfall}
        businessName=""
        stepLabel="Co-founder message"
        stepHint="Nothing has been sent yet. Your draft is still here, and the message runs the moment the credits land."
        variant="message"
      />
    </DashboardShell>
  )
}
