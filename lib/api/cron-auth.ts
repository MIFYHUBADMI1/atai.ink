import { timingSafeEqual } from "node:crypto"
import type { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Vercel Cron calls with `Authorization: Bearer <CRON_SECRET>` (see vercel.json). */
export function cronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get("authorization") ?? ""
  return header.startsWith("Bearer ") && safeEqual(header.slice(7), secret)
}

/** Scheduled job or an admin in the console. Throws when neither. */
export async function requireCronOrAdmin(request: NextRequest): Promise<"cron" | "admin"> {
  if (cronAuthorized(request)) return "cron"
  await requireAdmin()
  return "admin"
}
