import "server-only"
import { GitHubApiError, getReadme, getRepo, getRepoTree, getFileContent } from "@/lib/integrations/github/client"
import { usersCol } from "@/lib/db/collections"
import { wrapUntrustedContent } from "@/lib/planning/utils/security"
import { logger } from "@/lib/logging/logger"

/**
 * Read-only repository evidence for an existing business.
 *
 * Deliberately narrower than the build-from pipeline: nothing is cloned,
 * nothing is pushed, no zipball is handed to the model, and no repository code
 * is executed. We read the repo metadata, the file tree, the README and a
 * capped set of manifest files with the founder's own OAuth token.
 *
 * Honesty rules baked into the shape:
 *  - languages are INFERRED from file extensions in the tree (there is no
 *    GitHub language API call here), so the field says so;
 *  - commit activity is a count of at most the last N commits we actually
 *    fetched, never a claim about velocity or quality;
 *  - potential credentials are reported as file + pattern, never as value.
 */

const TREE_FILE_CAP = 2_000
const MANIFEST_CAP = 6
const MANIFEST_BYTES = 6_000
const COMMIT_CAP = 30

const MANIFEST_NAMES: Array<{ match: RegExp; kind: string }> = [
  { match: /^package\.json$/, kind: "npm" },
  { match: /(^|\/)package\.json$/, kind: "npm" },
  { match: /(^|\/)composer\.json$/, kind: "composer" },
  { match: /(^|\/)requirements[^/]*\.txt$/, kind: "python-requirements" },
  { match: /(^|\/)pyproject\.toml$/, kind: "python-project" },
  { match: /(^|\/)go\.mod$/, kind: "go" },
  { match: /(^|\/)Cargo\.toml$/, kind: "rust" },
  { match: /(^|\/)pom\.xml$/, kind: "maven" },
  { match: /(^|\/)build\.gradle(\.kts)?$/, kind: "gradle" },
  { match: /(^|\/)Gemfile$/, kind: "ruby" },
  { match: /(^|\/)Dockerfile$/, kind: "docker" },
  { match: /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/, kind: "ci-workflow" },
]

/** Extension → language, for statements we can actually support. */
const LANGUAGE_EXTENSIONS: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
  py: "Python", rb: "Ruby", go: "Go", rs: "Rust", php: "PHP",
  java: "Java", kt: "Kotlin", swift: "Swift", cs: "C#", c: "C", cpp: "C++",
  vue: "Vue", svelte: "Svelte", sql: "SQL", sh: "Shell",
}

/** Presence patterns only. A matched value is discarded, never stored. */
const SECRET_PATTERNS: Array<{ id: string; label: string; test: RegExp }> = [
  { id: "aws_access_key", label: "an AWS access key id", test: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "private_key_block", label: "a private key block", test: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: "github_token", label: "a GitHub token", test: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { id: "generic_assignment", label: "an assigned secret-looking value", test: /\b(?:api[_-]?key|secret|password|token)\s*[=:]\s*["'][^"']{12,}["']/i },
]

export interface RepoManifest {
  path: string
  kind: string
  name?: string
  scripts: string[]
  dependencies: string[]
  frameworks: string[]
}

export interface RepoFacts {
  owner: string
  repo: string
  repoId: number
  defaultBranch: string
  /** Read from the API response for THIS token — never inferred. */
  isPrivate: boolean
  accessVerified: true
  /** Pull access is what "read-only" means here; recorded from permissions. */
  canPull: boolean
  description?: string
  filesListed: number
  treeTruncated: boolean
  languagesInferred: Array<{ language: string; files: number }>
  topLevelEntries: string[]
  manifests: RepoManifest[]
  readmeChars: number
  /** Latest commit date and how many recent commits we actually fetched. */
  recentCommits: { count: number; newestAt: string | null; fetched: number }
  secretConcerns: Array<{ file: string; label: string }>
  /** Sizes are reported so the report can say what we did NOT look at. */
  filesSkippedForSize: number
}

export type RepoFactsResult =
  | { facts: RepoFacts; readme: string | null }
  | { failure: { code: string; message: string } }

/**
 * Access is only ever "verified" when `getRepo` succeeded WITH the founder's
 * token. A public repo being downloadable is not evidence that this founder
 * owns or controls it — the caller must say so separately.
 */
export async function collectRepoFacts(input: {
  userId: string
  owner: string
  repo: string
  branch?: string
}): Promise<RepoFactsResult> {
  const userDoc = await (await usersCol()).findOne({ id: input.userId })
  const token = (userDoc as { githubAccessToken?: string } | null)?.githubAccessToken || null

  if (!token) {
    return {
      failure: {
        code: "GITHUB_NOT_CONNECTED",
        message: "Connect GitHub in Settings → Profile to let Atai read your repository.",
      },
    }
  }

  let repoMeta
  try {
    repoMeta = await getRepo(token, input.owner, input.repo)
  } catch (error) {
    return { failure: githubFailure(error) }
  }

  const branch = input.branch?.trim() || repoMeta.default_branch || "main"
  let tree: Awaited<ReturnType<typeof getRepoTree>> = []
  try {
    tree = await getRepoTree(token, input.owner, input.repo, branch)
  } catch (error) {
    return { failure: githubFailure(error) }
  }

  const files = tree.filter((item) => item.type === "blob")
  const treeTruncated = files.length > TREE_FILE_CAP
  const considered = files.slice(0, TREE_FILE_CAP)

  const languageCounts = new Map<string, number>()
  const topLevel = new Set<string>()
  for (const file of considered) {
    const ext = file.path.includes(".") ? file.path.split(".").pop()!.toLowerCase() : ""
    const language = LANGUAGE_EXTENSIONS[ext]
    if (language) languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1)
    const first = file.path.split("/")[0]
    if (first) topLevel.add(first)
  }

  const manifestCandidates = dedupePaths(
    considered
      .filter((file) => MANIFEST_NAMES.some((manifest) => manifest.match.test(file.path)))
      .map((file) => file.path),
  ).slice(0, MANIFEST_CAP)

  const manifests: RepoManifest[] = []
  const secretConcerns: Array<{ file: string; label: string }> = []
  let filesSkippedForSize = 0

  for (const path of manifestCandidates) {
    let content = ""
    try {
      content = await getFileContent(token, input.owner, input.repo, path)
    } catch (error) {
      // A manifest we cannot read is a missing fact, not a failed intake.
      logger.info("intake.repo", "manifest unreadable", { path, status: error instanceof GitHubApiError ? error.status : "error" })
      continue
    }
    if (content.length > MANIFEST_BYTES) {
      content = content.slice(0, MANIFEST_BYTES)
      filesSkippedForSize += 1
    }
    const kind = MANIFEST_NAMES.find((manifest) => manifest.match.test(path))?.kind ?? "other"
    manifests.push(parseManifest(path, kind, content))
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test.test(content)) secretConcerns.push({ file: path, label: pattern.label })
    }
  }

  let readme: string | null = null
  try {
    readme = await getReadme(token, input.owner, input.repo)
  } catch (error) {
    logger.info("intake.repo", "readme unavailable", { status: error instanceof GitHubApiError ? error.status : "error" })
  }
  if (readme) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test.test(readme)) secretConcerns.push({ file: "README", label: pattern.label })
    }
  }

  let recentCommits = { count: 0, newestAt: null as string | null, fetched: 0 }
  try {
    const { listRecentCommits } = await import("@/lib/integrations/github/client")
    const commits = await listRecentCommits(token, input.owner, input.repo, COMMIT_CAP)
    recentCommits = {
      count: commits.length,
      newestAt: commits[0]?.date ?? null,
      fetched: commits.length,
    }
  } catch (error) {
    logger.info("intake.repo", "commit list unavailable", { status: error instanceof GitHubApiError ? error.status : "error" })
  }

  return {
    // The README text is handed to the caller for the prompt and never stored
    // on the project; it is bounded here so a huge README cannot be held.
    readme: readme ? readme.slice(0, 20_000) : null,
    facts: {
      owner: input.owner,
      repo: input.repo,
      repoId: repoMeta.id,
      defaultBranch: repoMeta.default_branch || branch,
      isPrivate: Boolean(repoMeta.private),
      accessVerified: true,
      canPull: repoMeta.permissions?.pull !== false,
      ...(repoMeta.description ? { description: repoMeta.description } : {}),
      filesListed: considered.length,
      treeTruncated,
      languagesInferred: [...languageCounts.entries()]
        .map(([language, files_]) => ({ language, files: files_ }))
        .sort((a, b) => b.files - a.files)
        .slice(0, 8),
      topLevelEntries: [...topLevel].slice(0, 25),
      manifests,
      readmeChars: readme?.length ?? 0,
      recentCommits,
      secretConcerns: secretConcerns.slice(0, 10),
      filesSkippedForSize,
    },
  }
}

function githubFailure(error: unknown): { code: string; message: string } {
  if (error instanceof GitHubApiError) {
    if (error.status === 401) {
      return { code: "GITHUB_AUTH_EXPIRED", message: "Your GitHub connection needs to be authorised again in Settings → Profile." }
    }
    if (error.status === 403) {
      // GitHub uses 403 for both permission denial and rate limiting; we do
      // not claim to know which, and never echo the API body.
      return { code: "GITHUB_FORBIDDEN", message: "GitHub refused that request. It may be a permission limit or too many requests — try again shortly." }
    }
    if (error.status === 404) {
      return { code: "GITHUB_NOT_FOUND", message: "We could not find that repository with your GitHub access." }
    }
    if (error.status === 409) {
      return { code: "GITHUB_EMPTY_REPO", message: "That repository has no content to read yet." }
    }
    if (error.status === 429) {
      return { code: "GITHUB_RATE_LIMIT", message: "GitHub is rate-limiting these requests. Try again in a few minutes." }
    }
  }
  return { code: "GITHUB_UNAVAILABLE", message: "We could not reach GitHub right now. Your business can still be initialized from what you told us." }
}

function dedupePaths(paths: string[]): string[] {
  const rootFirst = [...paths].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))
  return [...new Set(rootFirst)]
}

const FRAMEWORK_HINTS: Array<[RegExp, string]> = [
  [/\bnext\b/i, "Next.js"],
  [/\bnuxt\b/i, "Nuxt"],
  [/\breact\b/i, "React"],
  [/\bvue\b/i, "Vue"],
  [/\bsvelte\b/i, "Svelte"],
  [/\bangular\b/i, "Angular"],
  [/\blaravel\b/i, "Laravel"],
  [/\bdjango\b/i, "Django"],
  [/\bflask\b/i, "Flask"],
  [/\brails\b/i, "Ruby on Rails"],
  [/\bspring-boot\b/i, "Spring Boot"],
  [/\bexpress\b/i, "Express"],
]

/** Parse declared dependencies from a manifest without executing anything. */
export function parseManifest(path: string, kind: string, content: string): RepoManifest {
  const result: RepoManifest = { path, kind, scripts: [], dependencies: [], frameworks: [] }

  if (kind === "npm") {
    try {
      const parsed = JSON.parse(content) as {
        name?: string
        scripts?: Record<string, unknown>
        dependencies?: Record<string, unknown>
        devDependencies?: Record<string, unknown>
      }
      if (parsed.name) result.name = parsed.name
      result.scripts = Object.keys(parsed.scripts ?? {}).slice(0, 20)
      result.dependencies = [...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {})].slice(0, 60)
    } catch {
      // Truncated JSON: fall back to quoted key extraction, still honest.
      const deps = [...content.matchAll(/"([a-z0-9@._/-]+)"\s*:\s*"[\^~\d][^"]*"/gi)].map((m) => m[1]!)
      result.dependencies = [...new Set(deps)].slice(0, 60)
    }
  } else if (kind === "python-requirements") {
    result.dependencies = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split(/[=<>!~\[]/)[0]!.trim())
      .filter(Boolean)
      .slice(0, 60)
  } else if (kind === "go") {
    result.dependencies = [...content.matchAll(/^\s*([a-z0-9.\-/_]+\.[a-z]+\/\S+)/gim)].map((m) => m[1]!).slice(0, 60)
  } else {
    result.dependencies = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"))
      .slice(0, 40)
  }

  for (const [pattern, framework] of FRAMEWORK_HINTS) {
    if (pattern.test(result.dependencies.join(" "))) result.frameworks.push(framework)
  }
  return result
}

/**
 * What goes into the assessment prompt. Repository text is the founder's own
 * code documentation, but it is still external content: it is fenced as
 * untrusted and explicitly demoted to data.
 */
export function buildRepoDigest(facts: RepoFacts, readme: string | null): string {
  const lines: string[] = []
  lines.push(`Repository: ${facts.owner}/${facts.repo}`)
  lines.push(`Visibility at time of reading: ${facts.isPrivate ? "private" : "public"} (confirmed with the owner's own GitHub access)`)
  lines.push(`Default branch: ${facts.defaultBranch}`)
  if (facts.description) lines.push(`Repository description: ${facts.description.slice(0, 300)}`)
  lines.push(`Files listed: ${facts.filesListed}${facts.treeTruncated ? " (tree capped — deeper paths not inspected)" : ""}`)
  if (facts.languagesInferred.length) {
    lines.push(`Languages inferred from file extensions: ${facts.languagesInferred.map((l) => `${l.language} (${l.files})`).join(", ")}`)
  }
  if (facts.topLevelEntries.length) lines.push(`Top-level entries: ${facts.topLevelEntries.join(", ")}`)
  for (const manifest of facts.manifests) {
    lines.push(`\nMANIFEST ${manifest.path} [${manifest.kind}]`)
    if (manifest.name) lines.push(`  package name: ${manifest.name}`)
    if (manifest.frameworks.length) lines.push(`  frameworks declared: ${manifest.frameworks.join(", ")}`)
    if (manifest.dependencies.length) lines.push(`  declared dependencies: ${manifest.dependencies.slice(0, 40).join(", ")}`)
    if (manifest.scripts.length) lines.push(`  scripts defined: ${manifest.scripts.join(", ")}`)
  }
  lines.push(`\nRecent commits fetched: ${facts.recentCommits.fetched} of up to ${COMMIT_CAP}`)
  if (facts.recentCommits.newestAt) lines.push(`  newest fetched commit date: ${facts.recentCommits.newestAt}`)
  if (facts.secretConcerns.length) {
    lines.push(`\nSECURITY NOTE: ${facts.secretConcerns.map((c) => `${c.file} appears to contain ${c.label}`).join("; ")}. Values were not copied or stored.`)
  }
  if (readme) {
    lines.push(`\nREADME (${facts.readmeChars} chars):\n${readme.slice(0, 8_000)}${readme.length > 8_000 ? "\n[README truncated]" : ""}`)
  } else {
    lines.push("\nREADME: none readable at this branch.")
  }
  const digest = lines.join("\n")
  return wrapUntrustedContent(digest, "github_repository_evidence")
}
