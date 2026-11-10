"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight, Check, ImageIcon, Link2, Loader2, Send, TriangleAlert, Upload, X } from "lucide-react"
import { postJson } from "@/lib/client/api"
import type { AdRequestAsset, AdRequestCreationMode, AdRequestSubmission } from "@/lib/types/ads"
import {
  AD_REQUEST_BOUNDS,
  AD_REQUEST_CHANNEL_OPTIONS,
  AD_REQUEST_CONFIRMATIONS,
  AD_REQUEST_CREATION_MODE_LABELS,
  AD_REQUEST_GOAL_OPTIONS,
} from "@/lib/marketing/ads/request-shared"

export interface PromotePrefill {
  name: string
  liveUrl: string
  description: string
  targetAudience: string
  pricingInfo: string
  stage: string
  contact: string
}

const B = AD_REQUEST_BOUNDS

const SECTION_TITLES = [
  "Business information",
  "What should Atai promote?",
  "Target audience",
  "Campaign preferences",
  "What should Atai create or use?",
  "Review and submit",
] as const

function emptySubmission(prefill: PromotePrefill): AdRequestSubmission {
  return {
    business: {
      name: prefill.name,
      liveUrl: prefill.liveUrl,
      description: prefill.description,
      industry: "",
      targetAudience: prefill.targetAudience,
      mainProduct: "",
      location: "",
      contact: prefill.contact,
      socialLinks: [],
      pricingInfo: prefill.pricingInfo,
      stage: prefill.stage,
    },
    promote: { goals: [], pitch: "", context: "" },
    audience: { who: "", ageRange: "", countries: "", regions: "", interests: "", customerType: "", problems: "", profile: "" },
    preferences: {
      objective: "",
      channels: [],
      duration: "",
      startDate: "",
      frequency: "",
      contentFormat: "",
      brandVoice: "",
      callToAction: "",
      budgetNote: "",
      instructions: "",
    },
    assets: [],
    creation: { mode: "atai_recommends", vision: "" },
    confirmations: {
      urlCorrect: false,
      infoAccurate: false,
      assetsAuthorized: false,
      manualExecutionUnderstood: false,
      noGuarantees: false,
      noAutoApproval: false,
    },
  }
}

/** Same rules as the server's normalizePromotionUrl, for instant feedback. */
function looksLikeLiveUrl(raw: string): boolean {
  let value = raw.trim()
  if (!value) return false
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`
  try {
    const url = new URL(value)
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && url.hostname.includes(".")
  } catch {
    return false
  }
}

function Field({
  label,
  optional = true,
  children,
  counter,
}: {
  label: string
  optional?: boolean
  children: React.ReactNode
  counter?: string
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">
        {label} {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </span>
      {children}
      {counter && <span className="text-right font-mono text-[10px] text-muted-foreground">{counter}</span>}
    </label>
  )
}

const inputClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
const textareaClass =
  "w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"

/**
 * The six-section "Promote My Business with Atai" submission wizard.
 * Submission is free and idempotent (one key per wizard instance), and the
 * review step requires all six explicit confirmations before Submit enables.
 */
export function PromoteWizard({ projectId, prefill }: { projectId: string; prefill: PromotePrefill }) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<AdRequestSubmission>(() => emptySubmission(prefill))
  const [socialDraft, setSocialDraft] = useState("")
  const [assetUrlDraft, setAssetUrlDraft] = useState("")
  const [assetLabelDraft, setAssetLabelDraft] = useState("")
  const [assetKindDraft, setAssetKindDraft] = useState<AdRequestAsset["kind"]>("logo")
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // One key per wizard instance: retries after a network failure return the
  // original request instead of creating a duplicate.
  const idempotencyKeyRef = useRef<string | null>(null)

  const setBusiness = (patch: Partial<AdRequestSubmission["business"]>) =>
    setForm((current) => ({ ...current, business: { ...current.business, ...patch } }))
  const setPromote = (patch: Partial<AdRequestSubmission["promote"]>) =>
    setForm((current) => ({ ...current, promote: { ...current.promote, ...patch } }))
  const setAudience = (patch: Partial<AdRequestSubmission["audience"]>) =>
    setForm((current) => ({ ...current, audience: { ...current.audience, ...patch } }))
  const setPreferences = (patch: Partial<AdRequestSubmission["preferences"]>) =>
    setForm((current) => ({ ...current, preferences: { ...current.preferences, ...patch } }))
  const setCreation = (patch: Partial<AdRequestSubmission["creation"]>) =>
    setForm((current) => ({ ...current, creation: { ...current.creation, ...patch } }))

  const toggleList = (list: string[], value: string, max: number) =>
    list.includes(value) ? list.filter((entry) => entry !== value) : list.length >= max ? list : [...list, value]

  const urlOk = looksLikeLiveUrl(form.business.liveUrl)
  const stepValid =
    step === 0
      ? form.business.name.trim().length > 0 && urlOk
      : step === 1
        ? form.promote.pitch.trim().length > 0
        : step === 5
          ? Object.values(form.confirmations).every(Boolean)
          : true

  function addSocialLink() {
    const value = socialDraft.trim()
    if (!value || !looksLikeLiveUrl(value)) return
    setBusiness({ socialLinks: [...form.business.socialLinks, value].slice(0, B.socialLinks) })
    setSocialDraft("")
  }

  async function uploadImage(file: File) {
    setUploading(true)
    setUploadError(null)
    try {
      const body = new FormData()
      body.append("file", file)
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`, { method: "POST", body })
      const json = await res.json().catch(() => null)
      const url = json?.data?.asset?.url
      if (!res.ok || !json?.ok || typeof url !== "string") {
        throw new Error(json?.message ?? "The upload didn't go through.")
      }
      setForm((current) => ({
        ...current,
        assets: [
          ...current.assets,
          { url, label: file.name.slice(0, B.assetLabel), kind: assetKindDraft },
        ].slice(0, B.assets),
      }))
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "The upload didn't go through — try again.")
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  function addAssetUrl() {
    const url = assetUrlDraft.trim()
    if (!url || !/^https:\/\//i.test(url) || form.assets.length >= B.assets) return
    setForm((current) => ({
      ...current,
      assets: [...current.assets, { url, label: assetLabelDraft.trim() || url.slice(0, B.assetLabel), kind: assetKindDraft }],
    }))
    setAssetUrlDraft("")
    setAssetLabelDraft("")
  }

  async function submit() {
    if (submitting || !stepValid) return
    setSubmitting(true)
    setError(null)
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `adreq-${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
    try {
      const result = await postJson<{ request: { id: string } }>(
        `/api/projects/${encodeURIComponent(projectId)}/ads/requests`,
        { idempotencyKey: idempotencyKeyRef.current, submission: form },
      )
      router.push(`/project/${projectId}/ads?tab=promote&request=${encodeURIComponent(result.request.id)}`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? `${e.message} Your answers are still here — try submitting again.` : "The request didn't submit — your answers are still here, try again.")
      setSubmitting(false)
    }
  }

  return (
    <section aria-labelledby="promote-wizard-heading" className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="promote-wizard-heading" className="text-lg font-semibold tracking-tight">
            Section {step + 1} of 6 — {SECTION_TITLES[step]}
          </h2>
          <div className="flex items-center gap-1" aria-hidden>
            {SECTION_TITLES.map((title, index) => (
              <span
                key={title}
                className={`h-1.5 w-6 rounded-full ${index < step ? "bg-primary" : index === step ? "bg-primary/60" : "bg-muted"}`}
              />
            ))}
          </div>
        </div>

        {step === 0 && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
              Prefilled from your project — confirm or edit anything. The live URL is required: Atai&apos;s team can
              only review a business people can actually visit.
            </p>
            <Field label="Business / application name" optional={false}>
              <input type="text" value={form.business.name} onChange={(e) => setBusiness({ name: e.target.value.slice(0, B.name) })} maxLength={B.name} className={inputClass} />
            </Field>
            <Field label="Live production URL" optional={false}>
              <input type="text" value={form.business.liveUrl} onChange={(e) => setBusiness({ liveUrl: e.target.value.slice(0, B.liveUrl) })} maxLength={B.liveUrl} placeholder="https://your-business.com" className={inputClass} />
              {!urlOk && form.business.liveUrl.trim() !== "" && (
                <span className="text-xs text-amber-600 dark:text-amber-400">That doesn&apos;t look like a valid site URL yet.</span>
              )}
            </Field>
            <div className="sm:col-span-2">
              <Field label="Business description" counter={`${form.business.description.length}/${B.description}`}>
                <textarea value={form.business.description} onChange={(e) => setBusiness({ description: e.target.value.slice(0, B.description) })} rows={3} maxLength={B.description} className={textareaClass} />
              </Field>
            </div>
            <Field label="Industry / category">
              <input type="text" value={form.business.industry} onChange={(e) => setBusiness({ industry: e.target.value.slice(0, B.industry) })} maxLength={B.industry} placeholder="e.g. Food delivery" className={inputClass} />
            </Field>
            <Field label="Main product or service">
              <input type="text" value={form.business.mainProduct} onChange={(e) => setBusiness({ mainProduct: e.target.value.slice(0, B.mainProduct) })} maxLength={B.mainProduct} placeholder="e.g. Weekend breakfast bundles" className={inputClass} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Target audience" counter={`${form.business.targetAudience.length}/${B.targetAudience}`}>
                <textarea value={form.business.targetAudience} onChange={(e) => setBusiness({ targetAudience: e.target.value.slice(0, B.targetAudience) })} rows={2} maxLength={B.targetAudience} className={textareaClass} />
              </Field>
            </div>
            <Field label="Business location / target market">
              <input type="text" value={form.business.location} onChange={(e) => setBusiness({ location: e.target.value.slice(0, B.location) })} maxLength={B.location} placeholder="e.g. Kampala, Uganda" className={inputClass} />
            </Field>
            <Field label="Contact information">
              <input type="text" value={form.business.contact} onChange={(e) => setBusiness({ contact: e.target.value.slice(0, B.contact) })} maxLength={B.contact} placeholder="Email or phone the team can reach you on" className={inputClass} />
            </Field>
            <Field label="Current business stage">
              <input type="text" value={form.business.stage} onChange={(e) => setBusiness({ stage: e.target.value.slice(0, B.stage) })} maxLength={B.stage} placeholder="e.g. Just launched, first customers" className={inputClass} />
            </Field>
            <Field label="Pricing / subscription information" counter={`${form.business.pricingInfo.length}/${B.pricingInfo}`}>
              <input type="text" value={form.business.pricingInfo} onChange={(e) => setBusiness({ pricingInfo: e.target.value.slice(0, B.pricingInfo) })} maxLength={B.pricingInfo} placeholder="e.g. Free tier, then $9/month" className={inputClass} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Business social media links">
                <div className="flex gap-2">
                  <input type="text" value={socialDraft} onChange={(e) => setSocialDraft(e.target.value.slice(0, B.socialLink))} placeholder="https://instagram.com/yourbusiness" className={inputClass} />
                  <button type="button" onClick={addSocialLink} disabled={!looksLikeLiveUrl(socialDraft) || form.business.socialLinks.length >= B.socialLinks} className="shrink-0 rounded-xl border border-border px-3 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">
                    Add
                  </button>
                </div>
              </Field>
              {form.business.socialLinks.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {form.business.socialLinks.map((link) => (
                    <li key={link} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs">
                      <span className="max-w-56 truncate">{link}</span>
                      <button type="button" aria-label={`Remove ${link}`} onClick={() => setBusiness({ socialLinks: form.business.socialLinks.filter((entry) => entry !== link) })} className="text-muted-foreground hover:text-foreground">
                        <X className="size-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="mt-4 flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">What do you want this campaign to do? Pick any that fit.</legend>
              <div className="flex flex-wrap gap-2">
                {AD_REQUEST_GOAL_OPTIONS.map((goal) => {
                  const checked = form.promote.goals.includes(goal)
                  return (
                    <button key={goal} type="button" role="checkbox" aria-checked={checked} onClick={() => setPromote({ goals: toggleList(form.promote.goals, goal, B.goals) })} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${checked ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
                      {checked && <Check className="size-3" aria-hidden />}
                      {goal}
                    </button>
                  )
                })}
              </div>
            </fieldset>
            <Field label="Tell us what you want people to know about your business" optional={false} counter={`${form.promote.pitch.length}/${B.pitch}`}>
              <textarea value={form.promote.pitch} onChange={(e) => setPromote({ pitch: e.target.value.slice(0, B.pitch) })} rows={4} maxLength={B.pitch} placeholder="The one thing people should remember — in your own words." className={textareaClass} />
            </Field>
            <Field label="Anything else the team should know" counter={`${form.promote.context.length}/${B.context}`}>
              <textarea value={form.promote.context} onChange={(e) => setPromote({ context: e.target.value.slice(0, B.context) })} rows={4} maxLength={B.context} placeholder="Unique selling points, offers, launch details, promotional messages, important instructions…" className={textareaClass} />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
              Describe the audience in broad terms — Atai doesn&apos;t collect sensitive personal information about
              individuals here.
            </p>
            <div className="sm:col-span-2">
              <Field label="Who should see the advertisement?" counter={`${form.audience.who.length}/${B.who}`}>
                <textarea value={form.audience.who} onChange={(e) => setAudience({ who: e.target.value.slice(0, B.who) })} rows={2} maxLength={B.who} className={textareaClass} />
              </Field>
            </div>
            <Field label="Age range (where appropriate)">
              <input type="text" value={form.audience.ageRange} onChange={(e) => setAudience({ ageRange: e.target.value.slice(0, B.ageRange) })} maxLength={B.ageRange} placeholder="e.g. 25–45" className={inputClass} />
            </Field>
            <Field label="Customer type">
              <input type="text" value={form.audience.customerType} onChange={(e) => setAudience({ customerType: e.target.value.slice(0, B.customerType) })} maxLength={B.customerType} placeholder="Individuals, businesses, students, professionals…" className={inputClass} />
            </Field>
            <Field label="Target countries">
              <input type="text" value={form.audience.countries} onChange={(e) => setAudience({ countries: e.target.value.slice(0, B.countries) })} maxLength={B.countries} placeholder="e.g. Uganda, Kenya" className={inputClass} />
            </Field>
            <Field label="Target cities or regions">
              <input type="text" value={form.audience.regions} onChange={(e) => setAudience({ regions: e.target.value.slice(0, B.regions) })} maxLength={B.regions} placeholder="e.g. Kampala and surrounding districts" className={inputClass} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Customer interests" counter={`${form.audience.interests.length}/${B.interests}`}>
                <textarea value={form.audience.interests} onChange={(e) => setAudience({ interests: e.target.value.slice(0, B.interests) })} rows={2} maxLength={B.interests} className={textareaClass} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="What problems do these customers have?" counter={`${form.audience.problems.length}/${B.problems}`}>
                <textarea value={form.audience.problems} onChange={(e) => setAudience({ problems: e.target.value.slice(0, B.problems) })} rows={2} maxLength={B.problems} className={textareaClass} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Desired customer profile" counter={`${form.audience.profile.length}/${B.profile}`}>
                <textarea value={form.audience.profile} onChange={(e) => setAudience({ profile: e.target.value.slice(0, B.profile) })} rows={2} maxLength={B.profile} className={textareaClass} />
              </Field>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="mt-4 flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Campaign objective">
                <input type="text" value={form.preferences.objective} onChange={(e) => setPreferences({ objective: e.target.value.slice(0, B.objective) })} maxLength={B.objective} placeholder="e.g. First 100 orders" className={inputClass} />
              </Field>
              <Field label="Desired campaign duration">
                <input type="text" value={form.preferences.duration} onChange={(e) => setPreferences({ duration: e.target.value.slice(0, B.duration) })} maxLength={B.duration} placeholder="e.g. 2 weeks" className={inputClass} />
              </Field>
              <Field label="Preferred start date">
                <input type="date" value={form.preferences.startDate} onChange={(e) => setPreferences({ startDate: e.target.value.slice(0, B.startDate) })} className={inputClass} />
              </Field>
              <Field label="Desired promotional frequency">
                <input type="text" value={form.preferences.frequency} onChange={(e) => setPreferences({ frequency: e.target.value.slice(0, B.frequency) })} maxLength={B.frequency} placeholder="e.g. 3 posts a week" className={inputClass} />
              </Field>
              <Field label="Preferred content format">
                <input type="text" value={form.preferences.contentFormat} onChange={(e) => setPreferences({ contentFormat: e.target.value.slice(0, B.contentFormat) })} maxLength={B.contentFormat} placeholder="e.g. Short videos and image posts" className={inputClass} />
              </Field>
              <Field label="Preferred brand voice">
                <input type="text" value={form.preferences.brandVoice} onChange={(e) => setPreferences({ brandVoice: e.target.value.slice(0, B.brandVoice) })} maxLength={B.brandVoice} placeholder="e.g. Warm, plain-spoken" className={inputClass} />
              </Field>
              <Field label="Desired call to action">
                <input type="text" value={form.preferences.callToAction} onChange={(e) => setPreferences({ callToAction: e.target.value.slice(0, B.callToAction) })} maxLength={B.callToAction} placeholder="e.g. Order your first bundle" className={inputClass} />
              </Field>
              <Field label="Campaign budget preference">
                <input type="text" value={form.preferences.budgetNote} onChange={(e) => setPreferences({ budgetNote: e.target.value.slice(0, B.budgetNote) })} maxLength={B.budgetNote} placeholder="e.g. Start small — quote me first" className={inputClass} />
              </Field>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Preferred promotional channels</legend>
              <div className="flex flex-wrap gap-2">
                {AD_REQUEST_CHANNEL_OPTIONS.map((channel) => {
                  const checked = form.preferences.channels.includes(channel)
                  return (
                    <button key={channel} type="button" role="checkbox" aria-checked={checked} onClick={() => setPreferences({ channels: toggleList(form.preferences.channels, channel, B.channels) })} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${checked ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
                      {checked && <Check className="size-3" aria-hidden />}
                      {channel}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">Preferences only — Atai&apos;s team confirms what it can actually run and quotes it transparently.</p>
            </fieldset>
            <Field label="Additional instructions" counter={`${form.preferences.instructions.length}/${B.instructions}`}>
              <textarea value={form.preferences.instructions} onChange={(e) => setPreferences({ instructions: e.target.value.slice(0, B.instructions) })} rows={3} maxLength={B.instructions} className={textareaClass} />
            </Field>

            <div className="rounded-xl border border-border p-3.5">
              <p className="text-sm font-medium">Supporting materials</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Upload images (logos, screenshots, promotional or product images, existing ads) through the secure
                project uploader, or paste a link to a video, brand guidelines or document hosted elsewhere. Only
                upload material you have permission to use.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select value={assetKindDraft} onChange={(e) => setAssetKindDraft(e.target.value as AdRequestAsset["kind"])} aria-label="Material type" className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="logo">Logo</option>
                  <option value="screenshot">Screenshot</option>
                  <option value="promo_image">Promotional image</option>
                  <option value="product_image">Product image</option>
                  <option value="existing_ad">Existing advertisement</option>
                  <option value="brand_guidelines">Brand guidelines</option>
                  <option value="document">Supporting document</option>
                  <option value="video">Video (link)</option>
                  <option value="other">Other</option>
                </select>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadImage(file) }} />
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || form.assets.length >= B.assets} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">
                  {uploading ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Upload className="size-3" aria-hidden />}
                  {uploading ? "Uploading…" : "Upload image"}
                </button>
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input type="text" value={assetUrlDraft} onChange={(e) => setAssetUrlDraft(e.target.value.slice(0, B.assetUrl))} placeholder="Or paste an https:// link (video, guidelines, document)" className={inputClass} />
                <input type="text" value={assetLabelDraft} onChange={(e) => setAssetLabelDraft(e.target.value.slice(0, B.assetLabel))} placeholder="Label" className={`${inputClass} sm:max-w-40`} />
                <button type="button" onClick={addAssetUrl} disabled={!/^https:\/\//i.test(assetUrlDraft.trim()) || form.assets.length >= B.assets} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">
                  <Link2 className="size-3" aria-hidden /> Add link
                </button>
              </div>
              {uploadError && <p role="alert" className="mt-2 text-xs text-amber-700 dark:text-amber-400">{uploadError}</p>}
              {form.assets.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {form.assets.map((asset, index) => (
                    <li key={`${asset.url}-${index}`} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-xs">
                      <ImageIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{asset.label || asset.url}</span>
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{asset.kind.replace(/_/g, " ")}</span>
                      <button type="button" aria-label={`Remove ${asset.label || asset.url}`} onClick={() => setForm((current) => ({ ...current, assets: current.assets.filter((_, i) => i !== index) }))} className="text-muted-foreground hover:text-foreground">
                        <X className="size-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">Nothing attached yet — materials are optional.</p>
              )}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="mt-4 flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">How should your advertising be handled?</legend>
              {(Object.keys(AD_REQUEST_CREATION_MODE_LABELS) as AdRequestCreationMode[]).map((mode) => (
                <label key={mode} className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors ${form.creation.mode === mode ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}>
                  <input type="radio" name="creation-mode" checked={form.creation.mode === mode} onChange={() => setCreation({ mode })} className="accent-[var(--primary)]" />
                  {AD_REQUEST_CREATION_MODE_LABELS[mode]}
                </label>
              ))}
            </fieldset>
            <Field label="Describe the exact advertisement you envision" counter={`${form.creation.vision.length}/${B.vision}`}>
              <textarea value={form.creation.vision} onChange={(e) => setCreation({ vision: e.target.value.slice(0, B.vision) })} rows={4} maxLength={B.vision} placeholder="The scene, the message, the feeling — as specific as you like." className={textareaClass} />
            </Field>
          </div>
        )}

        {step === 5 && (
          <div className="mt-4 flex flex-col gap-4">
            <ReviewBlock title="Business">
              <ReviewRow label="Name" value={form.business.name} />
              <ReviewRow label="Live URL" value={form.business.liveUrl} />
              {form.business.description && <ReviewRow label="Description" value={form.business.description} />}
              {form.business.industry && <ReviewRow label="Industry" value={form.business.industry} />}
              {form.business.mainProduct && <ReviewRow label="Main product" value={form.business.mainProduct} />}
              {form.business.location && <ReviewRow label="Location / market" value={form.business.location} />}
              {form.business.contact && <ReviewRow label="Contact" value={form.business.contact} />}
              {form.business.stage && <ReviewRow label="Stage" value={form.business.stage} />}
              {form.business.pricingInfo && <ReviewRow label="Pricing" value={form.business.pricingInfo} />}
              {form.business.socialLinks.length > 0 && <ReviewRow label="Social links" value={form.business.socialLinks.join(", ")} />}
            </ReviewBlock>
            <ReviewBlock title="What to promote">
              {form.promote.goals.length > 0 && <ReviewRow label="Goals" value={form.promote.goals.join("; ")} />}
              <ReviewRow label="Pitch" value={form.promote.pitch} />
              {form.promote.context && <ReviewRow label="Extra context" value={form.promote.context} />}
            </ReviewBlock>
            <ReviewBlock title="Audience">
              {form.audience.who && <ReviewRow label="Who" value={form.audience.who} />}
              {form.audience.ageRange && <ReviewRow label="Age range" value={form.audience.ageRange} />}
              {form.audience.countries && <ReviewRow label="Countries" value={form.audience.countries} />}
              {form.audience.regions && <ReviewRow label="Regions" value={form.audience.regions} />}
              {form.audience.customerType && <ReviewRow label="Customer type" value={form.audience.customerType} />}
              {form.audience.interests && <ReviewRow label="Interests" value={form.audience.interests} />}
              {form.audience.problems && <ReviewRow label="Problems" value={form.audience.problems} />}
              {form.audience.profile && <ReviewRow label="Profile" value={form.audience.profile} />}
            </ReviewBlock>
            <ReviewBlock title="Preferences">
              {form.preferences.objective && <ReviewRow label="Objective" value={form.preferences.objective} />}
              {form.preferences.channels.length > 0 && <ReviewRow label="Channels" value={form.preferences.channels.join(", ")} />}
              {form.preferences.duration && <ReviewRow label="Duration" value={form.preferences.duration} />}
              {form.preferences.startDate && <ReviewRow label="Start date" value={form.preferences.startDate} />}
              {form.preferences.frequency && <ReviewRow label="Frequency" value={form.preferences.frequency} />}
              {form.preferences.contentFormat && <ReviewRow label="Format" value={form.preferences.contentFormat} />}
              {form.preferences.brandVoice && <ReviewRow label="Brand voice" value={form.preferences.brandVoice} />}
              {form.preferences.callToAction && <ReviewRow label="Call to action" value={form.preferences.callToAction} />}
              {form.preferences.budgetNote && <ReviewRow label="Budget preference" value={form.preferences.budgetNote} />}
              {form.preferences.instructions && <ReviewRow label="Instructions" value={form.preferences.instructions} />}
              {form.assets.length > 0 && <ReviewRow label="Materials" value={`${form.assets.length} attached`} />}
            </ReviewBlock>
            <ReviewBlock title="Creation approach">
              <ReviewRow label="Approach" value={AD_REQUEST_CREATION_MODE_LABELS[form.creation.mode]} />
              {form.creation.vision && <ReviewRow label="Your vision" value={form.creation.vision} />}
            </ReviewBlock>

            <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-3.5">
              <legend className="px-1 text-sm font-medium">Before you submit, confirm all six</legend>
              {AD_REQUEST_CONFIRMATIONS.map(({ key, label }) => (
                <label key={key} className="flex cursor-pointer items-start gap-2.5 text-sm leading-6">
                  <input
                    type="checkbox"
                    checked={form.confirmations[key]}
                    onChange={(e) => setForm((current) => ({ ...current, confirmations: { ...current.confirmations, [key]: e.target.checked } }))}
                    className="mt-1 accent-[var(--primary)]"
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <p className="text-xs leading-5 text-muted-foreground">
              Submitting is free. Atai&apos;s team reviews your business and comes back with a proposal and transparent
              pricing — you approve before anything is charged or run. No guaranteed sales, customers, or reach.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-400">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <button type="button" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || submitting} className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">
            <ArrowLeft className="size-3.5" aria-hidden /> Back
          </button>
          {step < 5 ? (
            <div className="flex items-center gap-2">
              {step === 0 && !urlOk && <span className="text-xs text-muted-foreground">A valid live URL is needed to continue.</span>}
              {step === 1 && !stepValid && <span className="text-xs text-muted-foreground">Tell us what people should know first.</span>}
              <button type="button" onClick={() => setStep((current) => Math.min(5, current + 1))} disabled={!stepValid} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
                Next <ArrowRight className="size-3.5" aria-hidden />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => void submit()} disabled={!stepValid || submitting} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
              {submitting ? "Submitting…" : "Submit request — free"}
            </button>
          )}
        </div>
      </div>
      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Atai promotes businesses manually through the channels it actually has. Submission is a request for review —
        not approval, not publication, and never a promise of results.
      </p>
    </section>
  )
}

function ReviewBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border p-3.5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
      <dl className="mt-2 flex flex-col gap-1.5">{children}</dl>
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <dt className="shrink-0 text-xs text-muted-foreground sm:w-32">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words text-sm">{value}</dd>
    </div>
  )
}
