/** Client navigated away, HMR cancelled a request, or a socket reset mid-write. */
export function isBenignDisconnect(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const err = error as { name?: string; message?: string; code?: string }
  const code = err.code ?? ""
  const message = (err.message ?? "").toLowerCase()
  return (
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    code === "ECONNABORTED" ||
    code === "ERR_STREAM_PREMATURE_CLOSE" ||
    err.name === "AbortError" ||
    message === "aborted" ||
    message === "request aborted" ||
    message.includes("operation was aborted")
  )
}

/**
 * The process is shutting down. A background index build interrupted by an
 * explicit close is expected, not a failure worth logging: a one-shot script
 * closes the client as soon as its report is printed.
 */
export function isShutdownError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const err = error as { name?: string; message?: string }
  if (err.name === "MongoClientClosedError" || err.name === "MongoNotConnectedError" || err.name === "MongoPoolClosedError") {
    return true
  }
  const message = (err.message ?? "").toLowerCase()
  return message.includes("client was closed") || message.includes("client must be connected") || message.includes("closed connection pool")
}
