import { defineConfig } from 'vitest/config';

// Integration tests create a fresh database and run every migration in their
// setup hook; under load (CI, `pnpm check` right after lint) that can exceed
// Vitest's 10 s default, so setup gets more time. Individual tests stay fast.
export default defineConfig({
  test: {
    hookTimeout: 60_000,
    testTimeout: 20_000,
  },
});
