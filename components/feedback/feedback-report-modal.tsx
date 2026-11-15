"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import useSWR from "swr"
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Coins,
  FileText,
  Languages,
  Loader2,
  Maximize2,
  Minimize2,
  Mic,
  Paperclip,
  ShieldCheck,
  Square,
  X,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { jsonFetcher, postJson } from "@/lib/client/api"
import { useVoiceDictation } from "@/lib/client/use-voice-dictation"
import { useVoiceRecorder, VoiceRecorderPanel } from "@/components/feedback/voice-recorder"
import { collectDiagnostics, primaryFingerprint, sanitizeUrl } from "@/lib/feedback/diagnostics"
import type { FeedbackCategory, FeedbackDiagnostics, FeedbackTranscription } from "@/lib/feedback/types"
import { FEEDBACK_CATEGORIES } from "@/lib/feedback/types"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface FeedbackConfig {
  enabled: boolean
  bugReportsEnabled: boolean
  voiceEnabled: boolean
  screenshotEnabled: boolean
  maxAudioSeconds: number
  maxAttachmentBytes: number
  categories: readonly { id: FeedbackCategory; label: string }[]
}

interface UploadedAttachment {
  id: string
  kind: "image" | "audio"
  name: string
  mimeType: string
  size: number
  durationSeconds?: number
}

const CATEGORY_ICONS: Record<string, typeof AlertTriangle> = {
  broken: AlertTriangle,
  error: AlertTriangle,
  page_load: FileText,
  performance: FileText,
  incorrect: FileText,
  security: ShieldCheck,
  improvement: FileText,
  other: FileText,
}

async function uploadAttachment(file: File | Blob, kind: "image" | "audio", name: string, durationSeconds?: number): Promise<UploadedAttachment> {
  const form = new FormData()
  form.append("kind", kind)
  form.append("file", file instanceof File ? file : new File([file], name, { type: file.type }))
  if (durationSeconds) form.append("durationSeconds", String(durationSeconds))
  const res = await fetch("/api/feedback/attachments", { method: "POST", credentials: "include", body: form })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.ok) throw new Error(body?.error?.message ?? "Upload failed")
  return body.data as UploadedAttachment
}

const DRAFT_KEY = "atai:feedback-draft"

interface FeedbackDraft {
  category: FeedbackCategory | null
  description: string
  originalText: string
  detectedLanguage?: string
  step: 0 | 1 | 2
  attachments: UploadedAttachment[]
  savedAt: number
}

function loadDraft(): FeedbackDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as FeedbackDraft
    // Drafts older than 7 days are stale — drop them.
    if (!d || Date.now() - (d.savedAt ?? 0) > 7 * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(DRAFT_KEY)
      return null
    }
    return d
  } catch {
    return null
  }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY) } catch { /* quota */ }
}

export function FeedbackReportModal({
  open,
  onOpenChange,
  onSubmitted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmitted?: (reference: string) => void
}) {
  const { data: config } = useSWR<FeedbackConfig>(open ? "/api/feedback/config" : null, jsonFetcher)
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [category, setCategory] = useState<FeedbackCategory | null>(null)
  const [description, setDescription] = useState("")
  const [originalText, setOriginalText] = useState("")
  const [detectedLanguage, setDetectedLanguage] = useState<string | undefined>()
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([])
  const [uploading, setUploading] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submittedRef, setSubmittedRef] = useState<string | null>(null)
  const [translating, setTranslating] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [restoredDraft, setRestoredDraft] = useState(false)
  const [diagnostics] = useState<FeedbackDiagnostics>(() => collectDiagnostics())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const shotInputRef = useRef<HTMLInputElement>(null)
  const submitLock = useRef(false)

  const dictation = useVoiceDictation({ value: description, setValue: setDescription })
  const recorder = useVoiceRecorder(config?.maxAudioSeconds ?? 300)

  // Restore any saved draft when the modal opens — a reload or accidental
  // navigation must never cost the user their report.
  useEffect(() => {
    if (!open) return
    const draft = loadDraft()
    setRestoredDraft(Boolean(draft))
    if (draft) {
      setStep(draft.step ?? 0)
      setCategory(draft.category ?? null)
      setDescription(draft.description ?? "")
      setOriginalText(draft.originalText ?? "")
      setDetectedLanguage(draft.detectedLanguage)
      setAttachments(Array.isArray(draft.attachments) ? draft.attachments : [])
    } else {
      setStep(0)
      setCategory(null)
      setDescription("")
      setOriginalText("")
      setDetectedLanguage(undefined)
      setAttachments([])
    }
    setSubmittedRef(null)
    setExpanded(false)
    submitLock.current = false
  }, [open])

  // Persist the draft on every meaningful change while the modal is open.
  useEffect(() => {
    if (!open || submittedRef) return
    const hasContent = Boolean(category || description.trim() || originalText.trim() || attachments.length)
    if (!hasContent) return
    const draft: FeedbackDraft = {
      category, description, originalText,
      ...(detectedLanguage ? { detectedLanguage } : {}),
      step, attachments, savedAt: Date.now(),
    }
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)) } catch { /* quota */ }
  }, [open, submittedRef, category, description, originalText, detectedLanguage, step, attachments])

  const categories = useMemo(() => config?.categories ?? FEEDBACK_CATEGORIES, [config])

  const handleFiles = useCallback(
    async (files: FileList | null, kind: "image" | "audio") => {
      if (!files?.length) return
      for (const file of Array.from(files).slice(0, 4 - attachments.length)) {
        setUploading(file.name)
        try {
          const ref = await uploadAttachment(file, kind, file.name)
          setAttachments((prev) => [...prev, ref])
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Upload failed")
        } finally {
          setUploading(null)
        }
      }
    },
    [attachments.length],
  )

  const attachRecording = useCallback(async () => {
    const audio = recorder.audio
    if (!audio) return
    setUploading("voice-note")
    try {
      const ref = await uploadAttachment(audio.blob, "audio", `voice-note.${audio.mimeType.includes("mp4") ? "m4a" : "webm"}`, audio.durationSeconds)
      setAttachments((prev) => [...prev, ref])
      recorder.discard()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setUploading(null)
    }
  }, [recorder])

  const handleDictate = useCallback(() => {
    if (!originalText && description.trim()) setOriginalText(description)
    dictation.toggle()
  }, [dictation, description, originalText])

  const handleTranslate = useCallback(async () => {
    const text = description.trim()
    if (text.length < 3) return
    setTranslating(true)
    try {
      const res = await postJson<{ english: string; language?: string }>("/api/feedback/translate", { text })
      if (!originalText) setOriginalText(description)
      setDescription(res.english)
      setDetectedLanguage(res.language ?? detectedLanguage)
      toast.success("Converted to English — review the text before submitting.")
    } catch {
      toast.error("English conversion isn't available right now. You can edit the text manually.")
    } finally {
      setTranslating(false)
    }
  }, [description, detectedLanguage, originalText])

  const fingerprint = useMemo(
    () => primaryFingerprint(diagnostics, category ?? "other"),
    [diagnostics, category],
  )

  const canSubmit = description.trim().length >= 10 && !!category && !submitting && !submitLock.current

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitLock.current) return
    submitLock.current = true
    setSubmitting(true)
    try {
      // Refresh the diagnostic snapshot at submission time — the state at
      // submit is what admins need, not the moment the modal opened.
      const fresh = collectDiagnostics()

      // Optional automatic page snapshot — only when enabled in
      // Settings → Feedback & privacy. Best-effort; never blocks submit.
      const finalAttachments = [...attachments]
      try {
        const { loadPrivacyPrefs, capturePageSnapshot } = await import("@/lib/feedback/privacy")
        if (loadPrivacyPrefs().autoScreenshot && !finalAttachments.some((a) => a.kind === "image")) {
          const blob = await capturePageSnapshot()
          if (blob) finalAttachments.push(await uploadAttachment(blob, "image", "auto-screenshot.png"))
        }
      } catch { /* screenshot is best-effort */ }

      const transcription: FeedbackTranscription = {
        status: originalText && originalText !== description.trim() ? "done" : description.trim() ? "done" : "none",
        method: dictation.listening || originalText ? "browser_speech" : "manual",
        ...(originalText ? { originalText: originalText.slice(0, 8000) } : {}),
        ...(description.trim() ? { englishText: description.trim().slice(0, 8000) } : {}),
        ...(detectedLanguage ? { language: detectedLanguage } : {}),
      }
      const result = await postJson<{ id: string; reference: string }>("/api/feedback/reports", {
        category,
        description: description.trim(),
        ...(originalText && originalText !== description.trim() ? { originalDescription: originalText.trim() } : {}),
        ...(detectedLanguage ? { detectedLanguage } : {}),
        transcription,
        attachments: finalAttachments,
        diagnostics: fresh,
        ...(primaryFingerprint(fresh, category ?? "other") ? { fingerprint: primaryFingerprint(fresh, category ?? "other") } : {}),
      })
      setSubmittedRef(result.reference)
      clearDraft()
      onSubmitted?.(result.reference)
    } catch (e) {
      submitLock.current = false
      toast.error(e instanceof Error ? e.message : "Couldn't submit the report. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, category, description, originalText, detectedLanguage, attachments, dictation.listening, onSubmitted])

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-xl",
          expanded && "h-[100dvh] max-h-[100dvh] w-screen max-w-none rounded-none sm:max-w-none",
        )}
      >
        {/* Gradient header */}
        <div className={cn(
          "border-b border-border bg-gradient-to-br from-primary/15 via-primary/5 to-transparent px-5 pb-4 pt-5",
          expanded ? "sm:px-10" : "",
        )}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogHeader className="gap-1 text-left">
                <DialogTitle className="text-lg">Report a bug or issue</DialogTitle>
                <DialogDescription>
                  Tell us what isn&apos;t working correctly — we automatically capture page and device context so you don&apos;t have to.
                </DialogDescription>
              </DialogHeader>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="grid size-9 place-items-center rounded-lg border border-border bg-background/60 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={expanded ? "Exit full screen" : "Open full screen"}
                title={expanded ? "Exit full screen" : "Full screen"}
              >
                {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="grid size-9 place-items-center rounded-lg border border-border bg-background/60 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Close report dialog"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        </div>

        {submittedRef ? (
          <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
            <div className="relative">
              <CheckCircle2 className="size-14 text-green-500" />
              <Coins className="absolute -right-2 -top-1 size-5 text-primary" />
            </div>
            <DialogHeader>
              <DialogTitle>Report received — thank you!</DialogTitle>
              <DialogDescription>
                Your report <span className="font-mono font-medium text-foreground">{submittedRef}</span> was submitted
                and will be reviewed by the Atai team. Verified reports can earn permanent Atai Credits — track the
                journey under{" "}
                <a href="/contributions" className="text-primary underline underline-offset-2">My Contributions</a>.
              </DialogDescription>
            </DialogHeader>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        ) : (
          <div className={cn("w-full", expanded && "mx-auto max-w-3xl")}>
            {restoredDraft ? (
              <div className="mx-5 mt-4 flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
                <span className="text-muted-foreground">Welcome back — your draft was restored. Nothing was lost.</span>
                <button
                  type="button"
                  className="shrink-0 font-medium text-primary hover:underline"
                  onClick={() => { clearDraft(); setRestoredDraft(false); setStep(0); setCategory(null); setDescription(""); setOriginalText(""); setAttachments([]) }}
                >
                  Start over
                </button>
              </div>
            ) : null}

            {/* Step indicator */}
            <div className={cn("flex items-center gap-2 px-5", restoredDraft ? "mt-3" : "mt-4")} aria-hidden>
              {["What happened?", "Describe it", "Review & send"].map((label, i) => (
                <div key={label} className="flex flex-1 items-center gap-2">
                  <span className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full font-mono text-xs",
                    step >= i ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}>
                    {i + 1}
                  </span>
                  <span className={cn("hidden text-xs sm:block", step === i ? "text-foreground" : "text-muted-foreground")}>{label}</span>
                  {i < 2 ? <span className="h-px flex-1 bg-border" /> : null}
                </div>
              ))}
            </div>

            {step === 0 ? (
              <div className="grid gap-2 px-5 pt-4 sm:grid-cols-2">
                {categories.map((c) => {
                  const Icon = CATEGORY_ICONS[c.id] ?? FileText
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setCategory(c.id); setStep(1) }}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/50",
                        category === c.id && "border-primary/60 bg-primary/5",
                      )}
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="text-sm font-medium">{c.label}</span>
                    </button>
                  )
                })}
              </div>
            ) : null}

            {step === 1 ? (
              <div className="space-y-3 px-5 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="fb-desc" className="text-sm font-medium">What happened?</label>
                  <div className="flex gap-1.5">
                    {config?.voiceEnabled !== false ? (
                      <Button
                        type="button"
                        variant={dictation.listening ? "default" : "outline"}
                        size="sm"
                        onClick={handleDictate}
                        className="gap-1.5"
                        aria-pressed={dictation.listening}
                      >
                        {dictation.listening ? <Square className="size-3.5" /> : <Mic className="size-3.5" />}
                        {dictation.listening ? "Stop dictation" : "Dictate"}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleTranslate()}
                      disabled={translating || description.trim().length < 3}
                      className="gap-1.5"
                    >
                      {translating ? <Loader2 className="size-3.5 animate-spin" /> : <Languages className="size-3.5" />}
                      English
                    </Button>
                  </div>
                </div>
                <Textarea
                  id="fb-desc"
                  value={description}
                  onChange={(e) => dictation.typeText(e.target.value)}
                  placeholder="Describe what you were doing, what you expected, and what actually happened…"
                  rows={6}
                  maxLength={8000}
                />
                {dictation.listening ? (
                  <p className="text-xs text-muted-foreground">
                    Listening… {dictation.partial ? <span className="italic">“{dictation.partial}”</span> : null}
                  </p>
                ) : null}
                {dictation.error ? <p className="text-xs text-destructive">{dictation.error}</p> : null}
                {originalText && originalText !== description.trim() ? (
                  <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                    Original (kept on the report): “{originalText.slice(0, 160)}{originalText.length > 160 ? "…" : ""}”
                  </p>
                ) : null}

                <VoiceRecorderPanel recorder={recorder} maxSeconds={config?.maxAudioSeconds ?? 300} />
                {recorder.audio ? (
                  <div className="space-y-1.5">
                    <Button
                      type="button"
                      variant={attachments.some((a) => a.kind === "audio") ? "outline" : "default"}
                      size="sm"
                      onClick={() => void attachRecording()}
                      disabled={!!uploading}
                      className="gap-1.5"
                    >
                      {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
                      {attachments.some((a) => a.kind === "audio") ? "Re-attach voice note" : "Attach voice note to report"}
                    </Button>
                    {!attachments.some((a) => a.kind === "audio") ? (
                      <p className="flex items-center gap-1.5 text-xs font-medium text-amber-500">
                        <AlertTriangle className="size-3.5" />
                        You recorded a voice note — it won&apos;t be included until you tap &quot;Attach voice note&quot;.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => { void handleFiles(e.target.files, "image"); e.target.value = "" }}
                  />
                  <input
                    ref={shotInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => { void handleFiles(e.target.files, "image"); e.target.value = "" }}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={!!uploading} className="gap-1.5">
                    <Paperclip className="size-3.5" /> Attach file
                  </Button>
                  {config?.screenshotEnabled !== false ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => shotInputRef.current?.click()} disabled={!!uploading} className="gap-1.5">
                      <Camera className="size-3.5" /> Screenshot
                    </Button>
                  ) : null}
                  {uploading ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Uploading…</span> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  Screenshots and files you attach are stored privately and only visible to you and the review team.
                </p>
                {attachments.length ? (
                  <ul className="space-y-1">
                    {attachments.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs">
                        {a.kind === "image" ? <Camera className="size-3.5 text-muted-foreground" /> : <Mic className="size-3.5 text-muted-foreground" />}
                        <span className="min-w-0 flex-1 truncate">{a.name}</span>
                        <span className="shrink-0 font-mono text-muted-foreground">{(a.size / 1024).toFixed(0)} KB</span>
                        <button
                          type="button"
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                          aria-label={`Remove ${a.name}`}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-4 px-5 pt-4">
                {/* Reward journey teaser — informational only, no promise */}
                <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-gradient-to-br from-primary/10 to-transparent p-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                    <Coins className="size-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">Help the team — get rewarded</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      Genuine, verified reports earn permanent Atai Credits — from <strong className="text-foreground">1,000</strong> for
                      minor issues up to <strong className="text-foreground">2,000,000</strong> for exceptional discoveries.
                      Rewards are approved by the team after review, never automatically.
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Badge variant="secondary">{categories.find((c) => c.id === category)?.label}</Badge>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{description}</p>
                  {originalText && originalText !== description.trim() ? (
                    <p className="mt-2 text-xs text-muted-foreground">Original transcription preserved on the report.</p>
                  ) : null}
                  {attachments.length ? (
                    <p className="mt-2 text-xs text-muted-foreground">{attachments.length} attachment{attachments.length > 1 ? "s" : ""} included.</p>
                  ) : null}
                </div>

                <details className="rounded-lg border border-border p-3 text-sm">
                  <summary className="cursor-pointer font-medium text-muted-foreground">Diagnostics included with this report</summary>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <dt className="text-muted-foreground">Page</dt><dd className="truncate font-mono">{sanitizeUrl(diagnostics.page.url)}</dd>
                    <dt className="text-muted-foreground">Route</dt><dd className="truncate font-mono">{diagnostics.page.route}</dd>
                    <dt className="text-muted-foreground">Device</dt><dd>{diagnostics.device.deviceCategory} · {diagnostics.device.browser ?? "browser"} {diagnostics.device.browserVersion ?? ""}</dd>
                    <dt className="text-muted-foreground">Screen</dt><dd className="font-mono">{diagnostics.device.viewportWidth}×{diagnostics.device.viewportHeight}</dd>
                    <dt className="text-muted-foreground">Captured</dt><dd className="font-mono">{new Date(diagnostics.collectedAt).toISOString()}</dd>
                    <dt className="text-muted-foreground">Recent errors</dt><dd>{diagnostics.errors.length ? `${diagnostics.errors.length} captured` : "none observed"}</dd>
                  </dl>
                  <p className="mt-3 text-xs text-muted-foreground">
                    We collect your page URL, device/browser info, and recent error summaries to help diagnose the issue.
                    Passwords, tokens, and personal data are automatically redacted. Voice notes and screenshots are stored
                    privately and retained for 30 days.
                  </p>
                </details>
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-2 px-5 pb-5 pt-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => (step === 0 ? onOpenChange(false) : setStep((step - 1) as 0 | 1))}
                className="gap-1"
                disabled={submitting}
              >
                <ChevronLeft className="size-3.5" /> {step === 0 ? "Cancel" : "Back"}
              </Button>
              {step < 2 ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setStep((step + 1) as 1 | 2)}
                  disabled={step === 0 ? !category : description.trim().length < 10}
                  className="gap-1"
                >
                  Continue <ChevronRight className="size-3.5" />
                </Button>
              ) : (
                <Button type="button" size="sm" onClick={() => void handleSubmit()} disabled={!canSubmit} className="gap-1.5">
                  {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                  Submit report
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
