import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({ resolve: { alias: { '@provider-endpoint': resolve('src/generation/provider-endpoint.ts') } }, test: { include: ['tests/unit/**/*.test.{ts,tsx}'], maxWorkers:4 } });
