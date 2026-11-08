/**
 * Plan copy that used to read as tooling. The live strings stay in
 * `lib/billing/config.ts` (behind the details disclosure, and unchanged for the
 * billing settings page); this is what a visitor reads first.
 *
 * Client-safe module: the pricing page needs these rewrites across the
 * server→client boundary, so they travel as data, never as a function prop.
 */
export const PLAN_JARGON_TRANSLATIONS: Record<string, string> = {
  "500 welcome credits on email verification": "500 credits the moment you confirm your email",
  "All generation models (crawl & scrape agents)": "Atai can study other businesses and the web around yours",
  "Advanced site analysis": "A written read of your market before anything is built",
  "Built-in database & infrastructure (limited)": "Your data lives somewhere safe, with room to grow",
  "Access to the Atai workspace": "One place for the plan, the build and the running of it",
  "Built-in code editor": "Change the business yourself when you want to",
  "AI code fixes & implementations": "Ask for a fix and it gets made",
  "Limited multi-section code editing": "Change several parts of the business at once",
  "Full multi-section code editing": "Change any part of the business, as often as you need",
  "Up to 30 parallel AI agents": "Several jobs moving at the same time, not one queue",
  "Latest powered build models": "The best teams we have, on your work first",
  "Incoming API key & deployment access": "Your business gets its own Atai key for its features",
  "Full application builds (no follow-ups needed)": "A complete launch in one go, not a fragment you have to finish",
  "Deployment system — sell & earn on marketplace": "Publish it, and earn when other owners start from it",
  "Database management & storage": "Room for your customers, orders and history",
  "Limited team support": "A team behind your builds",
  "Standard team support": "A team behind your builds",
  "Team support": "A team behind your builds",
  "Full team support": "A dedicated team on your work",
  "Edit code in editor or visually": "Edit it yourself — by clicking, or in the editor",
  "Edit your code — in the editor or visually": "Edit it yourself — by clicking, or in the editor",
  "Download source code": "Take a copy of your business with you",
  "Download your source code": "Take a copy of your business with you",
  "Sync with GitHub": "Keep it in sync if your team already works that way",
  "Use your own domain": "Launch on your own web address",
  "Parallel AI agents": "Several jobs moving at the same time, not one queue",
  "Priority builds": "Your work goes to the front of the queue",
  "Direct support": "Talk to a person about your business",
  "Community support": "Ask alongside other owners",
  "Monthly credit grants": "Credits every month",
  "Custom volume": "Credit volume sized to your operation",
  "Dedicated infrastructure": "Your own capacity, not a shared one",
  "SLA-backed uptime": "An uptime commitment in writing",
  "White-glove onboarding": "We help your first businesses go out the door",
  "Dedicated account manager": "One person who knows your business",
  "Custom integrations on request": "Connect the tools you already run on",
  "Enterprise team support": "Support shaped around your team",
}

export function translateFeature(feature: string): string {
  const exact = PLAN_JARGON_TRANSLATIONS[feature]
  if (exact) return exact
  const grant = feature.match(/^([\d,]+) Atai Credits \/ month$/)
  if (grant) return `${grant[1]} credits every month, for the work your teams do`
  const everything = feature.match(/^Everything in (\w+), plus:$/)
  if (everything) return `Everything in ${everything[1]}, plus:`
  const volume = feature.match(/^([\d,]+)\+ Atai Credits \/ month$/)
  if (volume) return `${volume[1]}+ credits every month`
  return feature
}
