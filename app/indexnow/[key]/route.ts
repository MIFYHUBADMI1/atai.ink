import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ key: string }> }

/** IndexNow key verification file. Participating engines fetch
 * /indexnow/<key>.txt to confirm the site owns the key. Only the configured
 * key is ever served; anything else 404s. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { key } = await params
  const configured = process.env.INDEXNOW_KEY?.trim()
  const expected = configured ? `${configured}.txt` : ""
  if (!configured || key !== expected) {
    return new Response("Not found", { status: 404 })
  }
  return new Response(configured, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}