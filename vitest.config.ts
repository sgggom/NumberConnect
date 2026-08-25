import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'src/gameplay/editor/editorPreferences.test.ts',
      'src/gameplay/mode3/**/*.test.ts',
      'src/gameplay/mode5/**/*.test.ts',
    ],
  },
});
