"use client"

import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { ComparisonData, ComparisonRow } from "@/lib/blog/types"

const EMPTY_ROW: ComparisonRow = { dimension: "", atai: "", competitor: "", evidence: "", lastChecked: "", note: "" }

export function ComparisonEditor({
  comparison,
  onChange,
}: {
  comparison: ComparisonData
  onChange: (next: ComparisonData) => void
}) {
  function setMeta<K extends keyof ComparisonData>(key: K, value: ComparisonData[K]) {
    onChange({ ...comparison, [key]: value })
  }

  function setRow(index: number, patch: Partial<ComparisonRow>) {
    const rows = comparison.rows.map((row, position) => (position === index ? { ...row, ...patch } : row))
    onChange({ ...comparison, rows })
  }

  function addRow() {
    onChange({ ...comparison, rows: [...comparison.rows, { ...EMPTY_ROW }] })
  }

  function removeRow(index: number) {
    onChange({ ...comparison, rows: comparison.rows.filter((_, position) => position !== index) })
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="comparison-name">Competitor</Label>
          <Input id="comparison-name" value={comparison.competitorName} onChange={(e) => setMeta("competitorName", e.target.value)} placeholder="Lovable" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="comparison-url">Competitor website</Label>
          <Input id="comparison-url" value={comparison.competitorUrl ?? ""} onChange={(e) => setMeta("competitorUrl", e.target.value)} placeholder="https://…" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="comparison-reviewed">Comparison last reviewed</Label>
          <Input id="comparison-reviewed" value={comparison.lastReviewed ?? ""} onChange={(e) => setMeta("lastReviewed", e.target.value)} placeholder="2026-11-15" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="comparison-description">Competitor description</Label>
          <Input id="comparison-description" value={comparison.competitorDescription ?? ""} onChange={(e) => setMeta("competitorDescription", e.target.value)} placeholder="What the product is, in one line" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="comparison-positioning">Positioning</Label>
        <Textarea
          id="comparison-positioning"
          rows={3}
          value={comparison.positioning ?? ""}
          onChange={(e) => setMeta("positioning", e.target.value)}
          placeholder="Where Atai differs — honest, specific, no unsupported superiority claims."
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Comparison rows</Label>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="size-4" /> Add row
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Every competitor cell needs evidence (a source URL or a verification note). Rows without evidence are
          flagged by the content audit and must not be published as facts.
        </p>
        {comparison.rows.map((row, index) => (
          <div key={index} className="rounded-xl border border-border bg-card p-3">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Row {index + 1}</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => removeRow(index)} aria-label="Remove row">
                <Trash2 className="size-4" />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input value={row.dimension} onChange={(e) => setRow(index, { dimension: e.target.value })} placeholder="Dimension (e.g. Hosting)" />
              <Input value={row.atai} onChange={(e) => setRow(index, { atai: e.target.value })} placeholder="Atai" />
              <Input value={row.competitor} onChange={(e) => setRow(index, { competitor: e.target.value })} placeholder="Competitor" />
              <Input value={row.evidence ?? ""} onChange={(e) => setRow(index, { evidence: e.target.value })} placeholder="Evidence URL or note" />
              <Input value={row.lastChecked ?? ""} onChange={(e) => setRow(index, { lastChecked: e.target.value })} placeholder="Last checked (YYYY-MM-DD)" />
              <Input value={row.note ?? ""} onChange={(e) => setRow(index, { note: e.target.value })} placeholder="Caveat (optional)" />
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="comparison-limitations">Limitations of this comparison</Label>
        <Textarea
          id="comparison-limitations"
          rows={3}
          value={comparison.limitations ?? ""}
          onChange={(e) => setMeta("limitations", e.target.value)}
          placeholder="What this comparison does not cover, and when it was last checked."
        />
      </div>
    </div>
  )
}
