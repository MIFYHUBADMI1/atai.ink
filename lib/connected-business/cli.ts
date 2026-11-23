/**
 * Argument handling shared by the migration scripts (A′.6).
 *
 * Kept here, and not inline in the scripts, so the rules are testable: a
 * script that parses its own argv can only be tested by running it.
 *
 * @module lib/connected-business/cli
 */

export type MigrationMode = "dry-run" | "apply"

/** A usage problem the operator must fix. Never a programming error. */
export class CliUsageError extends Error {}

export function parseMode(argv: readonly string[]): MigrationMode {
  return argv[2] === "apply" ? "apply" : "dry-run"
}

/** Every `--name=value`, in order. Repeatable flags use this. */
export function flagValues(argv: readonly string[], name: string): string[] {
  const prefix = `--${name}=`
  return argv
    .filter((argument) => argument.startsWith(prefix))
    .map((argument) => argument.slice(prefix.length))
    .filter(Boolean)
}

export function flagValue(argv: readonly string[], name: string): string | undefined {
  return flagValues(argv, name)[0]
}

export function limitOf(argv: readonly string[]): number | undefined {
  const raw = flagValue(argv, "limit")
  const parsed = Number(raw ?? "")
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * A dry run may invent an id — it writes nothing, so the id is throwaway.
 * An apply may not: the run id is the only handle a rollback has, and a
 * generated one is a handle nobody wrote down.
 */
export function resolveRunId(input: {
  mode: MigrationMode
  explicit?: string
  generate: () => string
}): string {
  if (input.explicit) return input.explicit
  if (input.mode === "apply") {
    throw new CliUsageError(
      "An apply run needs an explicit --run-id=<id>. It is the only way to roll the run back later.",
    )
  }
  return input.generate()
}

export function requireRunId(argv: readonly string[]): string {
  const runId = flagValue(argv, "run-id")
  if (!runId) throw new CliUsageError("A run id is required: --run-id=<id>")
  return runId
}
