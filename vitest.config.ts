import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['core/**/*.test.ts', 'server/**/*.test.ts', 'test/**/*.test.ts', 'web/src/**/*.test.ts'],
  },
});
