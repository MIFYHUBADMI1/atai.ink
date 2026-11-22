/**
 * Test-environment guard.
 *
 * The development .env points MONGODB_URI at a shared remote Atlas cluster.
 * Vitest loads no env file, but a URI exported in the shell would still reach
 * any test that talks to a real database — writing test projects, keys and
 * credit ledger rows into shared state. Refuse anything that is not a
 * disposable loopback database unless the operator explicitly opts in.
 */
const uri = process.env.MONGODB_URI

if (uri && process.env.ATAI_TEST_ALLOW_REMOTE_MONGO !== "1") {
  let host = ""
  try {
    host = new URL(uri).hostname
  } catch {
    throw new Error(
      `[test-env] MONGODB_URI is not a valid URL. Point it at a disposable local MongoDB, e.g. mongodb://127.0.0.1:27017/atai-test`,
    )
  }

  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"].includes(host)
  if (!loopback) {
    throw new Error(
      `[test-env] Refusing to run tests against non-local MongoDB host "${host}".\n` +
        `Tests must use a disposable database, never a shared or production cluster.\n` +
        `Start a local MongoDB and set MONGODB_URI=mongodb://127.0.0.1:27017/atai-test,\n` +
        `or set ATAI_TEST_ALLOW_REMOTE_MONGO=1 if this really is a dedicated test database.`,
    )
  }
}
// Fixed, non-secret key for at-rest encryption in tests. Production derives
// the same key material from AUTH_SECRET, which is absent in a bare test run.
process.env.AUTH_SECRET ??= "test-only-auth-secret-not-used-outside-vitest"
