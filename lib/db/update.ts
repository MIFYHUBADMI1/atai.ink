/**
 * Build a MongoDB update document from a patch.
 *
 * The driver runs with `ignoreUndefined: true`, so the serializer drops keys
 * whose value is `undefined`. `$set: { field: undefined }` therefore leaves the
 * stored field untouched instead of clearing it — a silent no-op that reads as
 * a successful write. Fields that must be cleared go through `$unset` here.
 */
export function buildUpdate(patch: Record<string, unknown>): Record<string, unknown> {
  const set: Record<string, unknown> = {}
  const unset: Record<string, string> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) unset[key] = ""
    else set[key] = value
  }
  const update: Record<string, unknown> = {}
  if (Object.keys(set).length > 0) update.$set = set
  if (Object.keys(unset).length > 0) update.$unset = unset
  return update
}
