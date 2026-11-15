import { siteSettingsCol } from "@/lib/db/collections"

/**
 * Site-wide settings controlled by admins from /admin. Stored as a single
 * document in the `site_settings` collection (id: "site-settings").
 *
 * The onboarding video URL is the first setting; the document shape is
 * deliberately flat so future site-wide toggles can join it without a
 * migration.
 */
export interface SiteSettingsDoc {
  id: "site-settings"
  /** Raw URL the admin pasted — a YouTube watch/share URL or any https embed URL. */
  onboardingVideoUrl?: string
  updatedAt: number
  updatedBy?: string
}

const SETTINGS_ID = "site-settings" as const

const DEFAULT_SETTINGS: SiteSettingsDoc = {
  id: SETTINGS_ID,
  updatedAt: 0,
}

export async function getSiteSettings(): Promise<SiteSettingsDoc> {
  try {
    const col = await siteSettingsCol()
    const doc = (await col.findOne({ id: SETTINGS_ID })) as SiteSettingsDoc | null
    return doc ?? DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function updateSiteSettings(
  patch: Partial<Pick<SiteSettingsDoc, "onboardingVideoUrl">>,
  adminId: string,
): Promise<SiteSettingsDoc> {
  const col = await siteSettingsCol()
  const current = await getSiteSettings()
  const next: SiteSettingsDoc = {
    ...current,
    ...patch,
    id: SETTINGS_ID,
    updatedAt: Date.now(),
    updatedBy: adminId,
  }
  // An empty/missing value means "cleared" — store it as absent so readers
  // don't have to treat "" and undefined differently.
  if (!next.onboardingVideoUrl?.trim()) {
    delete next.onboardingVideoUrl
  }
  await col.replaceOne({ id: SETTINGS_ID }, next, { upsert: true })
  return next
}

/**
 * The effective onboarding video URL: the admin-set value wins; the
 * NEXT_PUBLIC_ONBOARDING_VIDEO_URL env var is the deployment fallback.
 */
export async function getOnboardingVideoUrl(): Promise<string | null> {
  const settings = await getSiteSettings()
  const fromDb = settings.onboardingVideoUrl?.trim()
  if (fromDb) return fromDb
  const fromEnv = process.env.NEXT_PUBLIC_ONBOARDING_VIDEO_URL?.trim()
  return fromEnv || null
}
