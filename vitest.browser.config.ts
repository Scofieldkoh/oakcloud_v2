import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['react', 'react-dom', '@testing-library/user-event', 'react-dropzone', 'use-debounce'],
  },
  define: {
    'process.env': '{}',
  },
  test: {
    include: ['__tests__/browser/**/*.browser.test.tsx'],
    browser: {
      enabled: true,
      headless: true,
      // BROWSER_TEST_CHROMIUM points at a preinstalled Chromium when the pinned Playwright build is missing.
      provider: playwright(process.env.BROWSER_TEST_CHROMIUM
        ? { launchOptions: { executablePath: process.env.BROWSER_TEST_CHROMIUM } }
        : undefined),
      instances: [{ browser: 'chromium' }],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
