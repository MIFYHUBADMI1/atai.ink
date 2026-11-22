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

export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound()
  const { state } = await searchParams
  const v = state === "unread" ? view({ website: { submitted: true, analyzed: false, status: "failed", url: "https://cornerbakery.com" } }) : view()
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:py-8 lg:px-8">
      <BusinessProfile projectId="preview" initialView={v} />
    </div>
  )
}
