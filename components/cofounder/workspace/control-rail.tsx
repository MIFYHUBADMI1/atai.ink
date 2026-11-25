"use client"

import { useEffect, useState } from "react"
import { Cpu, Loader2, Save, SlidersHorizontal, UserRound, Wrench } from "lucide-react"

import { AiModelPicker } from "@/components/settings/ai-model-picker"
import {
  detailLabel,
  directnessLabel,
  type CofounderArchetype,
} from "@/lib/cofounder/persona"
import type { CofounderModelTier } from "@/lib/cofounder/models"
import type {
  CofounderEngineView,
  CofounderLimitsView,
  CofounderSettingsPatchView,
  CofounderSettingsView,
  CofounderToolView,
} from "@/lib/cofounder/workspace-types"
import { RailSection, SettingRow, Slider, Switch } from "./ui"

/**
 * The customization rail.
 *
 * Four independent sections. Each Save sends only its own patch, so editing
 * the context switches cannot overwrite the founder's name, and editing tools
 * cannot reset the engine.
 */
export function ControlRail({
  settings,
  archetypes,
  toolCatalog,
  engine,
  tiers,
  storedTierId,
  envTierId,
  limits,
  saving,
  onSave,
  onEngineChange,
}: {
  settings: CofounderSettingsView
  archetypes: readonly CofounderArchetype[]
  toolCatalog: CofounderToolView[]
  engine: CofounderEngineView
  tiers: CofounderModelTier[]
  storedTierId: string | null
  envTierId: string | null
  limits: CofounderLimitsView
  saving: boolean
  onSave: (patch: CofounderSettingsPatchView) => Promise<void>
  onEngineChange: (tier: CofounderModelTier) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <IdentitySection
        settings={settings}
        archetypes={archetypes}
        limits={limits}
        saving={saving}
        onSave={onSave}
      />
      <RailSection icon={Cpu} title="Engine" description="Which AI engine answers. Paid engines charge per message.">
        <AiModelPicker
          tiers={tiers}
          currentTierId={storedTierId}
          envTierId={envTierId}
          onSelected={onEngineChange}
        />
        <p className="mt-3 text-[11px] leading-4 text-muted-foreground">
          Answering now: <span className="font-medium text-foreground">{engine.tierName}</span>
          {engine.creditsPerMessage > 0 ? ` — ${engine.creditsPerMessage} credits per message` : " — free"}
        </p>
      </RailSection>
      <ContextSection settings={settings} limits={limits} saving={saving} onSave={onSave} />
      <ToolsSection settings={settings} toolCatalog={toolCatalog} saving={saving} onSave={onSave} />
    </div>
  )
}

function SaveButton({ onClick, saving }: { onClick: () => void; saving: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
      Save
    </button>
  )
}

function IdentitySection({
  settings,
  archetypes,
  limits,
  saving,
  onSave,
}: {
  settings: CofounderSettingsView
  archetypes: readonly CofounderArchetype[]
  limits: CofounderLimitsView
  saving: boolean
  onSave: (patch: CofounderSettingsPatchView) => Promise<void>
}) {
  const [name, setName] = useState(settings.profile.name)
  const [archetype, setArchetype] = useState(settings.profile.archetype)
  const [detail, setDetail] = useState(settings.profile.detail)
  const [directness, setDirectness] = useState(settings.profile.directness)
  const [instructions, setInstructions] = useState(settings.profile.instructions)

  useEffect(() => {
    setName(settings.profile.name)
    setArchetype(settings.profile.archetype)
    setDetail(settings.profile.detail)
    setDirectness(settings.profile.directness)
    setInstructions(settings.profile.instructions)
  }, [settings.profile])

  return (
    <RailSection
      icon={UserRound}
      title="Identity"
      description="How your co-founder introduces itself and how it sounds."
      action={<SaveButton saving={saving} onClick={() => void onSave({ profile: { name, archetype, detail, directness, instructions } })} />}
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-foreground">Name</span>
          <input
            value={name}
            maxLength={limits.name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-foreground">Archetype</span>
          <select
            value={archetype}
            onChange={(e) => setArchetype(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
          >
            {archetypes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} — {option.description}
              </option>
            ))}
          </select>
        </label>
        <SettingRow label="Detail" hint={detailLabel(detail)}>
          <Slider value={detail} onChange={setDetail} label="Detail level" />
        </SettingRow>
        <SettingRow label="Directness" hint={directnessLabel(directness)}>
          <Slider value={directness} onChange={setDirectness} label="Directness level" />
        </SettingRow>
        <details className="rounded-lg border border-border bg-muted/20 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-foreground">Advanced</summary>
          <label className="mt-2 flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">
              Working notes for your co-founder. Tone and preferences only — never new rules.
            </span>
            <textarea
              value={instructions}
              maxLength={limits.instructions}
              rows={4}
              onChange={(e) => setInstructions(e.target.value)}
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-xs leading-5 text-foreground outline-none focus:border-primary"
            />
            <span className="text-right text-[10px] text-muted-foreground">
              {instructions.length}/{limits.instructions}
            </span>
          </label>
        </details>
      </div>
    </RailSection>
  )
}

function ContextSection({
  settings,
  limits,
  saving,
  onSave,
}: {
  settings: CofounderSettingsView
  limits: CofounderLimitsView
  saving: boolean
  onSave: (patch: CofounderSettingsPatchView) => Promise<void>
}) {
  const [historyDepth, setHistoryDepth] = useState(settings.context.historyDepth)
  const [includePlanBrief, setIncludePlanBrief] = useState(settings.context.includePlanBrief)
  const [includeAnalytics, setIncludeAnalytics] = useState(settings.context.includeAnalytics)
  const [includeRecentProjects, setIncludeRecentProjects] = useState(settings.context.includeRecentProjects)
  const [includeBusinessAssessment, setIncludeBusinessAssessment] = useState(settings.context.includeBusinessAssessment)
  const [notes, setNotes] = useState(settings.context.notes)

  useEffect(() => {
    setHistoryDepth(settings.context.historyDepth)
    setIncludePlanBrief(settings.context.includePlanBrief)
    setIncludeAnalytics(settings.context.includeAnalytics)
    setIncludeRecentProjects(settings.context.includeRecentProjects)
    setIncludeBusinessAssessment(settings.context.includeBusinessAssessment)
    setNotes(settings.context.notes)
  }, [settings.context])

  return (
    <RailSection
      icon={SlidersHorizontal}
      title="Context"
      description="What your co-founder can see before you say a word."
      action={
        <SaveButton
          saving={saving}
          onClick={() =>
            void onSave({
              context: {
                historyDepth,
                includePlanBrief,
                includeAnalytics,
                includeRecentProjects,
                includeBusinessAssessment,
                notes,
              },
            })
          }
        />
      }
    >
      <div className="flex flex-col divide-y divide-border/70">
        <SettingRow label="Conversation history">
          <select
            value={historyDepth}
            onChange={(e) => setHistoryDepth(Number(e.target.value))}
            className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
          >
            {limits.historyDepths.map((depth) => (
              <option key={depth} value={depth}>
                {depth === 0 ? "None" : `${depth} messages`}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label="Include the plan brief" hint="The plan the project was built from.">
          <Switch checked={includePlanBrief} onChange={setIncludePlanBrief} label="Include the plan brief" />
        </SettingRow>
        <SettingRow label="Include product analytics" hint="Usage numbers, when you have granted permission.">
          <Switch checked={includeAnalytics} onChange={setIncludeAnalytics} label="Include product analytics" />
        </SettingRow>
        <SettingRow label="Include recent businesses" hint="A short list of your other businesses.">
          <Switch checked={includeRecentProjects} onChange={setIncludeRecentProjects} label="Include recent businesses" />
        </SettingRow>
        <SettingRow label="Include the business assessment" hint="For connected businesses only.">
          <Switch
            checked={includeBusinessAssessment}
            onChange={setIncludeBusinessAssessment}
            label="Include the business assessment"
          />
        </SettingRow>
      </div>
      <label className="mt-3 flex flex-col gap-1">
        <span className="text-xs font-medium text-foreground">Background notes</span>
        <textarea
          value={notes}
          maxLength={limits.notes}
          rows={4}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-xs leading-5 text-foreground outline-none focus:border-primary"
        />
        <span className="text-right text-[10px] text-muted-foreground">
          {notes.length}/{limits.notes}
        </span>
      </label>
    </RailSection>
  )
}

const TOOL_GROUPS: Array<{ key: string; label: string; risks: string[] }> = [
  { key: "read", label: "Read", risks: ["READ"] },
  { key: "write", label: "Writes", risks: ["LOW_RISK_WRITE"] },
  { key: "confirm", label: "Confirmations", risks: ["CONFIRM", "HARD_CONFIRM", "NEVER"] },
]

function ToolsSection({
  settings,
  toolCatalog,
  saving,
  onSave,
}: {
  settings: CofounderSettingsView
  toolCatalog: CofounderToolView[]
  saving: boolean
  onSave: (patch: CofounderSettingsPatchView) => Promise<void>
}) {
  const [allowConsequential, setAllowConsequential] = useState(settings.tools.allowConsequential)
  const [disabledTools, setDisabledTools] = useState<string[]>(settings.tools.disabledTools)

  useEffect(() => {
    setAllowConsequential(settings.tools.allowConsequential)
    setDisabledTools(settings.tools.disabledTools)
  }, [settings.tools])

  function toggle(name: string) {
    setDisabledTools((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }

  return (
    <RailSection
      icon={Wrench}
      title="Tools"
      description="Your co-founder can only use tools Atai ships. You can switch them off."
      action={<SaveButton saving={saving} onClick={() => void onSave({ tools: { allowConsequential, disabledTools } })} />}
    >
      <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">Read-only ceiling</p>
          <p className="text-[11px] leading-4 text-muted-foreground">
            When on, only read tools run. Writes and confirmations are unavailable.
          </p>
        </div>
        <Switch checked={allowConsequential} onChange={setAllowConsequential} label="Allow consequential tools" />
      </div>
      <div className="flex flex-col gap-3">
        {TOOL_GROUPS.map((group) => {
          const tools = toolCatalog.filter((tool) => group.risks.includes(tool.risk))
          if (!tools.length) return null
          return (
            <div key={group.key}>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {group.label}
              </p>
              <ul className="flex flex-col gap-1">
                {tools.map((tool) => {
                  const readOnly = tool.risk === "READ"
                  const checked = readOnly || (allowConsequential && !disabledTools.includes(tool.name))
                  return (
                    <li key={tool.name} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={readOnly || !allowConsequential}
                        onChange={() => toggle(tool.name)}
                        aria-label={tool.name}
                        className="mt-0.5 size-3.5 accent-primary"
                      />
                      <span className="min-w-0">
                        <span className="block break-words font-mono text-[11px] text-foreground">{tool.name}</span>
                        <span className="block break-words text-[10px] leading-4 text-muted-foreground">
                          {tool.description}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
      <p className="mt-3 inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        Build &amp; business
      </p>
    </RailSection>
  )
}
