import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
  resolve: { alias: { '@provider-endpoint': resolve('src/generation/provider-endpoint.ts') } },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    // Bound CPU contention on hosted runners; keep test deadlines and assertions intact.
    maxWorkers: 2,
  },
});
