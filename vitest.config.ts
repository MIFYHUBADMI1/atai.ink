import { defineConfig } from 'vitest/config'
import path from 'path'

// Mirrors Next.js's build-time aliasing of the `server-only` sentinel, which
// vitest does not perform (the package is not installed as a dependency).
const serverOnlyShim = {
  name: 'server-only-shim',
  resolveId(id: string) {
    if (id === 'server-only' || id === 'client-only') {
      return '\0server-only-stub'
    }
    return null
  },
  load(id: string) {
    if (id === '\0server-only-stub') return 'export {}'
    return null
  },
}

export default defineConfig({
  plugins: [serverOnlyShim],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    // The suite encodes real images through sharp and imports the SDK's built
    // dist, so individual tests legitimately run for seconds. The 5s default
    // turned CPU contention into false failures, and an aborted transaction
    // test then rolled its snapshot over the next test's state.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Leave headroom on a 4-core box; one worker per core thrashes the module
    // graph badly enough to trip the timeouts above.
    maxWorkers: 3,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
