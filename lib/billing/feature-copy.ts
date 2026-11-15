/**
 * Plan copy that used to read as tooling. The live strings live in
 * `lib/billing/entitlements/commercial-plans.ts` (COMMERCIAL_FEATURES); this is
 * what a visitor reads first.
 *
 * Client-safe module: the pricing page needs these rewrites across the
 * server→client boundary, so they travel as data, never as a function prop.
 */
export const PLAN_JARGON_TRANSLATIONS: Record<string, string> = {
  "Community support": "Ask alongside other owners",
  "Monthly credit grants": "Credits every month",
  "Priority builds": "Your work goes to the front of the queue",
  "Direct support": "Talk to a person about your business",
  "Custom volume": "Credit volume sized to your operation",
  "Dedicated infrastructure": "Your own capacity, not a shared one",
  "SLA-backed uptime": "An uptime commitment in writing",
  "White-glove onboarding": "We help your first businesses go out the door",
  "Dedicated account manager": "One person who knows your business",
}

export function translateFeature(feature: string): string {
  const exact = PLAN_JARGON_TRANSLATIONS[feature]
  if (exact) return exact
  const grant = feature.match(/^([\d,]+) Atai Credits \/ month(?: \(provisional\))?$/)
  if (grant) return `${grant[1]} credits every month, for the work your teams do`
  const everything = feature.match(/^Everything in (\w+), plus:$/)
  if (everything) return `Everything in ${everything[1]}, plus:`
  const volume = feature.match(/^([\d,]+)\+ Atai Credits \/ month$/)
  if (volume) return `${volume[1]}+ credits every month`
  return feature
}
