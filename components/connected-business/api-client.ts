/** Small fetch helper for the connected-business screens. */
export interface ApiResult<T> {
  ok: boolean
  data?: T
  message?: string
}

export async function sendJson<T>(url: string, method: string, body?: unknown): Promise<ApiResult<T>> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; data?: T; error?: { message?: string } }
    | null

  if (!response.ok || !payload?.ok) {
    return { ok: false, message: payload?.error?.message ?? "Something went wrong. Try again." }
  }
  return { ok: true, data: payload.data }
}
