import type { FaqEntry } from "@/lib/blog/content"

export function FaqSection({ faqs }: { faqs: FaqEntry[] }) {
  if (!faqs.length) return null
  return (
    <section className="mt-12" aria-label="Frequently asked questions">
      <h2 className="text-xl font-semibold tracking-tight">Frequently asked questions</h2>
      <div className="mt-4 space-y-3">
        {faqs.map((faq) => (
          <details key={faq.q} className="group rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer list-none text-sm font-medium leading-6 text-foreground marker:hidden [&::-webkit-details-marker]:hidden">
              {faq.q}
            </summary>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">{faq.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}