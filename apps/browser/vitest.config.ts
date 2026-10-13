import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@ewe/shared': resolve(__dirname, '../../packages/shared/src/index.ts') } },
  test: { include: ['tests/unit/**/*.test.ts'] },
})
