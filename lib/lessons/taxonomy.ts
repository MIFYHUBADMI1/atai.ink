import type { ObjectId } from "mongodb"

/**
 * Lesson taxonomy.
 *
 * Categories are curated (not free-form) so lessons and filters always agree,
 * but their names, descriptions, ordering, and visibility are stored in
 * MongoDB and editable from /admin/learning. The constants below are the
 * idempotent default: a missing or unreachable collection falls back to them.
 */

export interface LessonCategoryDoc {
  _id?: ObjectId
  id: string
  name: string
  description: string
  order: number
  hidden: boolean
  updatedAtMs: number
  updatedBy: string
}

export interface LessonCategoryView {
  id: string
  name: string
  description: string
  order: number
  hidden: boolean
}

export const LESSON_CATEGORY_SEED: readonly LessonCategoryView[] = [
  {
    id: "foundations",
    name: "Business foundations",
    description: "How businesses actually work: value, customers, costs, and what makes one survive.",
    order: 10,
    hidden: false,
  },
  {
    id: "ideas",
    name: "Ideas and validation",
    description: "Pressure-test an idea with evidence before spending time or money on it.",
    order: 20,
    hidden: false,
  },
  {
    id: "models",
    name: "Business models and strategy",
    description: "Choose how the business creates, delivers, and captures value.",
    order: 30,
    hidden: false,
  },
  {
    id: "market-research",
    name: "Market research",
    description: "Understand demand, competitors, and the market you are entering.",
    order: 40,
    hidden: false,
  },
  {
    id: "customers",
    name: "Customers and target markets",
    description: "Know who you serve, what they need, and how they decide.",
    order: 50,
    hidden: false,
  },
  {
    id: "products",
    name: "Products and services",
    description: "Scope, build, and improve the thing customers pay for.",
    order: 60,
    hidden: false,
  },
  {
    id: "pricing",
    name: "Pricing and revenue",
    description: "Set prices, design offers, and build revenue that covers the costs.",
    order: 70,
    hidden: false,
  },
  {
    id: "finance",
    name: "Finance and accounting",
    description: "Read the numbers, manage cash, and understand unit economics.",
    order: 80,
    hidden: false,
  },
  {
    id: "marketing",
    name: "Marketing and branding",
    description: "Reach the right people with a clear message and a credible brand.",
    order: 90,
    hidden: false,
  },
  {
    id: "sales",
    name: "Sales and customer acquisition",
    description: "Turn interest into customers through repeatable acquisition.",
    order: 100,
    hidden: false,
  },
  {
    id: "retention",
    name: "Customer experience and retention",
    description: "Keep customers, reduce churn, and earn repeat business.",
    order: 110,
    hidden: false,
  },
  {
    id: "operations",
    name: "Operations and management",
    description: "Run the business reliably: processes, tools, quality, and risk.",
    order: 120,
    hidden: false,
  },
  {
    id: "technology",
    name: "Technology and digital business",
    description: "Use software, data, and automation without letting them lead the business.",
    order: 130,
    hidden: false,
  },
  {
    id: "legal",
    name: "Legal and compliance fundamentals",
    description: "Understand the obligations that come with selling to real people.",
    order: 140,
    hidden: false,
  },
  {
    id: "growth",
    name: "Business growth and scaling",
    description: "Grow revenue and capacity without breaking what already works.",
    order: 150,
    hidden: false,
  },
  {
    id: "leadership",
    name: "Leadership and entrepreneurship",
    description: "Make decisions, manage yourself, and lead the people around you.",
    order: 160,
    hidden: false,
  },
] as const

/** Category for each in-code curriculum lesson (`core:<resource id>`). */
export const CORE_LESSON_CATEGORY: Readonly<Record<string, string>> = {
  "start/how-to-validate-a-business-idea": "ideas",
  "start/founder-fundamentals": "leadership",
  "templates/customer-interview-template": "market-research",
  "build/product-requirements": "products",
  "build/how-to-build-an-mvp": "products",
  "templates/mvp-checklist": "products",
  "launch/launch-checklist": "operations",
  "launch/how-to-launch-a-product": "marketing",
  "grow/find-early-customers": "sales",
  "ai/what-is-an-ai-agent": "technology",
}

export const LESSON_CATEGORY_FALLBACK = "foundations"

export function isLessonCategoryId(value: string): boolean {
  return LESSON_CATEGORY_SEED.some((category) => category.id === value)
}

export function categoryForCoreLesson(resourceId: string): string {
  return CORE_LESSON_CATEGORY[resourceId] ?? LESSON_CATEGORY_FALLBACK
}

export function sortLessonCategories(categories: readonly LessonCategoryView[]): LessonCategoryView[] {
  return [...categories].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

/** Merge stored overrides over the defaults; stored-only ids are ignored so a
 * renamed or removed seed id can never resurrect a stray filter. */
export function mergeLessonCategories(docs: readonly LessonCategoryDoc[]): LessonCategoryView[] {
  const byId = new Map(docs.map((doc) => [doc.id, doc]))
  return sortLessonCategories(
    LESSON_CATEGORY_SEED.map((seed) => {
      const doc = byId.get(seed.id)
      if (!doc) return seed
      return {
        id: seed.id,
        name: doc.name?.trim() || seed.name,
        description: doc.description?.trim() || seed.description,
        order: Number.isFinite(doc.order) ? doc.order : seed.order,
        hidden: Boolean(doc.hidden),
      }
    }),
  )
}
