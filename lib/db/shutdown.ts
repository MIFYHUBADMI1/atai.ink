import { ensureIndexes } from "./collections"
import { closeMongoClient } from "./mongodb"

/**
 * Close the database for a process that is about to exit.
 *
 * Order matters. Index creation is started lazily on first collection access
 * and is not awaited by the caller that triggered it. Closing the client while
 * it is still running aborts that work mid-flight and surfaces as an unhandled
 * pool error after the report has already been printed. Settling it first makes
 * the shutdown quiet.
 */
export async function closeDatabase(): Promise<void> {
  await ensureIndexes()
  await closeMongoClient()
}
