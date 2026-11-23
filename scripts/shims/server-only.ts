/**
 * Stand-in for the `server-only` package when a script runs outside Next.
 *
 * Next aliases `server-only` during the build, so the app never needs the
 * package installed. A standalone script has no such alias and would fail to
 * resolve the bare import. tsconfig.scripts.json maps the specifier here; the
 * guard still applies to every bundled import, which is where it matters.
 */
export {}
