import { notFound } from "next/navigation"
import { BusinessProfile } from "@/components/existing-business/business-profile"
import type { IntakeView } from "@/lib/existing-business/view"

export const dynamic = "force-dynamic"

function view(overrides: Partial<IntakeView> = {}): IntakeView {
  return {
    startingPoint: "existing_business",
    displayName: "Corner Bakery",
    objectives: [{ id: "acquire_customers", label: "More customers" }],
    overall: "partially_completed",
    website: {
      submitted: true,
      analyzed: true,
      status: "completed",
      url: "https://cornerbakery.com",
      pagesCrawled: 3,
    },
    claim: { state: "unclaimed" },
    domain: { records: [], verified: false },
    connection: { status: "not_connected", label: "Not connected" },
    assessment: {
      status: "failed",
      engine: { tierId: "spark", tierName: "Spark", modelId: "nvidia/nemotron-3-ultra-550b-a55b:free" },
      error: {
        code: "ASSESSMENT_FAILED",
        message: "The co-founder could not produce a dependable assessment this time.",
        detail: "No reply from nvidia/nemotron-3-ultra-550b-a55b:free after 91s (timeout).",
        reason: "timeout",
      },
    },
    ...overrides,
  } as IntakeView
}

const ASSESSMENT = {
  generatedAt: 1,
  evidence: { websiteAnalysed: true, pagesCrawled: 3, ownerDescription: true, domainVerified: false },
  understanding: "A neighbourhood bakery selling bread and pastries.",
  currentPosition: "Clear product, no way to order.",
  strengths: [],
  challenges: [],
  growthOpportunities: [],
  technicalOpportunities: [],
  marketingOpportunities: [],
  priorities: [],
  actionPlan: [],
  openQuestions: [],
} as const

/** The domain step, with a challenge created before file names were shortened,
 * so the long-token layout can be checked on a phone. */
function domainState(): IntakeView {
  return view({
    overall: "partially_completed",
    assessment: { status: "completed", result: ASSESSMENT as never, generatedAt: 1 },
    domain: {
      verified: false,
      records: [
        {
          id: "dom-preview",
          hostname: "study-iota-lime.vercel.app",
          registrableDomain: "vercel.app",
          submittedUrl: "https://study-iota-lime.vercel.app",
          status: "pending",
          method: "html_file",
          token: "hvM3s0PY_Um29Ecfsc66WLGOgQzZdUWmdrftgydfeuw",
          metaSnippet:
            '<meta name="atai-verification" content="hvM3s0PY_Um29Ecfsc66WLGOgQzZdUWmdrftgydfeuw">',
          fileName: "atai-verification-hvM3s0PY_Um29Ecfsc66WLGOgQzZdUWmdrftgydfeuw.html",
          tokenExpiresAt: Date.now() + 86_400_000,
          attempts: 0,
          lastAttemptAt: null,
          lastCheckedAt: null,
          claimExpiresAt: Date.now() + 172_800_000,
          verifiedAt: null,
          verifiedMethod: null,
          needsAttention: false,
          lastFailure: null,
          history: [],
          createdAt: Date.now() - 3_600_000,
          updatedAt: Date.now() - 3_600_000,
        },
      ],
    },
  })
}

export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound()
  const { state } = await searchParams
  const v =
    state === "domain"
      ? domainState()
      : state === "unread"
        ? view({ website: { submitted: true, analyzed: false, status: "failed", url: "https://cornerbakery.com" } })
        : view()
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:py-8 lg:px-8">
      <BusinessProfile projectId="preview" initialView={v} />
    </div>
  )
}
