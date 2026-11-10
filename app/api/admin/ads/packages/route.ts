import { z } from "zod"
import { requireAdmin } from "@/lib/auth/session"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { listPricingPackages, upsertPricingPackage } from "@/lib/marketing/ads/pricing"
import { publicPackageView } from "@/lib/marketing/ads/views"

const UpsertSchema = z
  .object({
    id: z.string().min(1).max(80).optional(),
    name: z.string().min(1).max(80),
    description: z.string().max(800).optional(),
    durationDays: z.number().int().min(1).max(365),
    creditsPrice: z.number().int().min(1).max(1_000_000),
    estimatedImpressionsMin: z.number().int().min(0).max(100_000_000),
    estimatedImpressionsMax: z.number().int().min(0).max(100_000_000),
    channels: z.array(z.string().max(80)).max(12).optional(),
    active: z.boolean().optional(),
  })
  .strict()

export async function GET() {
  try {
    await requireAdmin()
    const packages = await listPricingPackages({ includeInactive: true })
    return ok({ packages: packages.map(publicPackageView) })
  } catch (e) {
    return handleRouteError("api.admin.ads.packages.get", e)
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin()
    const parsed = UpsertSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return fail("VALIDATION", "Check the package fields.", 422)
    const pkg = await upsertPricingPackage(parsed.data)
    return ok({ package: publicPackageView(pkg) })
  } catch (e) {
    return handleRouteError("api.admin.ads.packages.post", e)
  }
}
