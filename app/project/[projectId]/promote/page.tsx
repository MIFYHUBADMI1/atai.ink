import { redirect } from "next/navigation"

/** Legacy email/deep-link: /project/:id/promote?request= → Growth Center promote tab. */
export default async function PromoteAliasPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ request?: string }>
}) {
  const { projectId } = await params
  const { request } = await searchParams
  const qs = new URLSearchParams({ tab: "promote" })
  if (request) qs.set("request", request)
  redirect(`/project/${projectId}/ads?${qs.toString()}`)
}
