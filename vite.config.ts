/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages under /<repo>/.
export default defineConfig({
  base: './',
  test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'] },
});
