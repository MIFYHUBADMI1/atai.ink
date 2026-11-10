import { z } from "zod"
import { LESSON_STAGES } from "@/lib/lessons/types"
import { LEARNING_PATH_STATUSES } from "@/lib/lessons/paths"

const slugSchema = z
  .string()
  .trim()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens.")
  .optional()

const lessonRefSchema = z
  .string()
  .trim()
  .max(120)
  .regex(/^(core:[a-z0-9-]+\/[a-z0-9-]+|les_[A-Za-z0-9_-]{1,100})$/, "Unknown lesson reference.")

export const learningPathObjectSchema = z.object({
  title: z.string().trim().min(3, "Give the path a title.").max(160),
  slug: slugSchema,
  description: z.string().trim().min(20, "Describe the path in at least 20 characters.").max(600),
  objectives: z
    .array(z.string().trim().min(3).max(180))
    .min(1, "Add at least one learning objective.")
    .max(12),
  audience: z.string().trim().min(3).max(240),
  stage: z.enum(LESSON_STAGES),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]),
  estimatedMinutes: z.number().int().min(5).max(600),
  lessonRefs: z
    .array(lessonRefSchema)
    .min(1, "Add at least one lesson.")
    .max(40)
    .refine((refs) => new Set(refs).size === refs.length, "Each lesson can appear only once."),
  status: z.enum(LEARNING_PATH_STATUSES),
  featured: z.boolean(),
  order: z.number().int().min(0).max(10_000),
})

export const learningPathPatchSchema = learningPathObjectSchema.partial()
