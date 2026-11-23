/**
 * Central error-code enum (spec section 28). Every code maps to an HTTP
 * status and a safe, user-facing message. Raw error details (stack traces,
 * driver errors) never reach the client — only `logger.error` sees them.
 *
 * Runtime API error codes (runtime_*) are registered additively at module
 * load by runtime/contracts/errors.ts — see importRuntimeErrorCodes() below.
 * This keeps the single error framework while letting the runtime module
 * own its code vocabulary.
 */
export type ErrorCode =
  | "DATABASE_UNAVAILABLE"
  | "AUTHENTICATION_FAILED"
  | "GOOGLE_AUTH_FAILED"
  | "EMAIL_NOT_VERIFIED"
  | "EMAIL_UNAVAILABLE"
  | "VERIFICATION_EXPIRED"
  | "VERIFICATION_INVALID"
  | "VERIFICATION_RATE_LIMITED"
  | "IMAGE_UPLOAD_FAILED"
  | "TOTALUM_UNAVAILABLE"
  | "FIRECRAWL_UNAVAILABLE"
  | "AI_UNAVAILABLE"
  | "INSUFFICIENT_CREDITS"
  | "PROJECT_NOT_FOUND"
  | "UNAUTHORIZED_PROJECT_ACCESS"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "VALIDATION"
  | "NOT_FOUND"
  | "EMAIL_ALREADY_REGISTERED"
  | "PAYMENT_UNAVAILABLE"
  | "BUSINESS_NOT_FOUND"
  | "BUSINESS_FORBIDDEN"
  | "BUSINESS_SUSPENDED"
  | "BUSINESS_NOT_MIGRATED"
  | "APPLICATION_ALREADY_EXISTS"
  | "CATALOG_UNAVAILABLE"
  | "CATALOG_CONFLICT"
  | "UNKNOWN"

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  DATABASE_UNAVAILABLE: "The database isn't available right now. Please try again shortly.",
  AUTHENTICATION_FAILED: "Incorrect email or password.",
  GOOGLE_AUTH_FAILED: "We couldn't sign you in with Google. Please try again.",
  EMAIL_NOT_VERIFIED: "Please verify your email address before continuing.",
  EMAIL_UNAVAILABLE: "Email delivery isn't configured right now.",
  VERIFICATION_EXPIRED: "This verification link has expired. Please request a new one.",
  VERIFICATION_INVALID: "This verification link is invalid.",
  VERIFICATION_RATE_LIMITED: "You've requested too many verification emails. Please wait before trying again.",
  IMAGE_UPLOAD_FAILED: "We couldn't upload that image. Please try a different file.",
  TOTALUM_UNAVAILABLE: "The build service isn't available right now.",
  FIRECRAWL_UNAVAILABLE: "The website analyzer isn't available right now.",
  AI_UNAVAILABLE: "AI generation isn't available right now. Please try again shortly.",
  INSUFFICIENT_CREDITS: "You don't have enough credits for this action.",
  PROJECT_NOT_FOUND: "We couldn't find this project.",
  UNAUTHORIZED_PROJECT_ACCESS: "You don't have access to this project.",
  UNAUTHORIZED: "Please sign in to continue.",
  RATE_LIMITED: "Too many attempts. Please wait and try again.",
  VALIDATION: "Please check your input and try again.",
  NOT_FOUND: "We couldn't find that.",
  EMAIL_ALREADY_REGISTERED: "An account with this email already exists.",
  PAYMENT_UNAVAILABLE: "Payment processing is not available right now.",
  BUSINESS_NOT_FOUND: "We couldn't find that business.",
  BUSINESS_FORBIDDEN: "You don't have permission to do that in this business.",
  BUSINESS_SUSPENDED: "This business is suspended. Contact support to restore access.",
  BUSINESS_NOT_MIGRATED: "This business is being prepared. Try again shortly.",
  APPLICATION_ALREADY_EXISTS: "An application already exists at that address.",
  CATALOG_UNAVAILABLE: "Pricing is temporarily unavailable. Please try again shortly.",
  CATALOG_CONFLICT: "The catalog changed since you loaded it. Reload and try again.",
  UNKNOWN: "Something went wrong. Please try again.",
}

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  DATABASE_UNAVAILABLE: 503,
  AUTHENTICATION_FAILED: 401,
  GOOGLE_AUTH_FAILED: 401,
  EMAIL_NOT_VERIFIED: 403,
  EMAIL_UNAVAILABLE: 503,
  VERIFICATION_EXPIRED: 410,
  VERIFICATION_INVALID: 400,
  VERIFICATION_RATE_LIMITED: 429,
  IMAGE_UPLOAD_FAILED: 400,
  TOTALUM_UNAVAILABLE: 503,
  FIRECRAWL_UNAVAILABLE: 503,
  AI_UNAVAILABLE: 503,
  INSUFFICIENT_CREDITS: 402,
  PROJECT_NOT_FOUND: 404,
  UNAUTHORIZED_PROJECT_ACCESS: 403,
  UNAUTHORIZED: 401,
  RATE_LIMITED: 429,
  VALIDATION: 422,
  NOT_FOUND: 404,
  EMAIL_ALREADY_REGISTERED: 409,
  PAYMENT_UNAVAILABLE: 503,
  BUSINESS_NOT_FOUND: 404,
  BUSINESS_FORBIDDEN: 403,
  BUSINESS_SUSPENDED: 403,
  BUSINESS_NOT_MIGRATED: 409,
  APPLICATION_ALREADY_EXISTS: 409,
  CATALOG_UNAVAILABLE: 503,
  CATALOG_CONFLICT: 409,
  UNKNOWN: 500,
}

export class AppError extends Error {
  code: ErrorCode
  status: number
  retryAfterSeconds?: number
  constructor(code: ErrorCode, message?: string, status?: number) {
    super(message ?? ERROR_MESSAGES[code])
    this.code = code
    this.status = status ?? STATUS_BY_CODE[code]
    this.name = "AppError"
  }
}

export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code] ?? 500
}

export function messageForCode(code: ErrorCode): string {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.UNKNOWN
}

// ─── Runtime API additive registration (Phase 2) ──────────────────────────
// Registers runtime_* codes into the maps above WITHOUT mutating the unions:
// the shared registry stays source-of-truth, runtime owns its vocabulary.
try {
  // Optional module: a static import would turn "runtime unavailable" into a
  // load-time crash, so this require is intentional.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { importRuntimeErrorCodes } = require("@/runtime/contracts/errors") as {
    importRuntimeErrorCodes: () => void
  }
  importRuntimeErrorCodes()
} catch {
  // Runtime contracts unavailable in this context — safe no-op. Runtime
  // endpoints still resolve codes via runtimeStatusForCode/runtimeMessageForCode.
}
