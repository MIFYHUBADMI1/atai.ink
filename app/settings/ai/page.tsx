import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { SettingsShell } from "@/components/settings/settings-shell"
import { AiModelPicker } from "@/components/settings/ai-model-picker"
import { getCurrentUser } from "@/lib/auth/session"
import { listCofounderTiers } from "@/lib/cofounder/model-catalog"
import { readCofounderModelTier } from "@/lib/cofounder/model"

/** Only a same-site path is a return address; anything else is dropped. */
function returnPath(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) return null
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("://")) return null
  return raw
}

/**
 * AI co-founder engine picker — the named modes from the admin-managed
 * catalog. The founder picks an engine, never a raw model; the underlying
 * model id is shown on each card for transparency. The pick is stored on the
 * user doc and applies to the very next co-founder message and the very next
 * intake read; paid engines charge credits per message, free ones never do.
 */
export default async function SettingsAiPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/login?next=%2Fsettings%2Fai")

  const backTo = returnPath((await searchParams)?.next)
  const [tiers, stored] = await Promise.all([listCofounderTiers(), readCofounderModelTier(user.id)])
  const currentTier = tiers.find((t) => t.id === stored) ?? tiers[0]
  const envRaw = process.env.COFOUNDER_MODEL_TIER?.trim() || null
  const envTier = envRaw && tiers.some((t) => t.id === envRaw) ? envRaw : null

  return (
    <SettingsShell title="AI co-founder">
      <div className="flex flex-col gap-8">

        {backTo ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border border-primary/25 bg-primary/5 px-4 py-3">
            <p className="text-sm leading-6 text-foreground">
              You came here from a read that did not finish. Pick an engine below, then go straight back — your
              progress is saved and the read is still there.
            </p>
            <Link
              href={backTo}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <ArrowLeft className="size-3.5" />
              Back to your business
            </Link>
          </div>
        ) : null}

        <header>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">AI co-founder</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Choose your engine</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The engine behind your co-founder — the advisor that reads your workspace, proposes plan changes, and
            kicks off builds once you approve. Each mode has its own strength; switch any time and it applies to
            your next message.
          </p>
        </header>

        <section className="border border-border bg-card p-6">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Current engine: <span className="text-foreground">{currentTier?.name ?? "—"}</span>
          </p>
          <div className="mt-5">
            <AiModelPicker tiers={tiers} currentTierId={currentTier?.id ?? null} envTierId={envTier} />
          </div>
        </section>
      </div>
    </SettingsShell>
  )
}
