/// <reference types="vitest/config" />
/**
 * Vite configuration for the NetworkMonitor SPA.
 *
 * The dev server proxies /api to the ASP.NET backend so the client can use
 * relative URLs everywhere — the same URLs work unchanged when the built SPA
 * is served by the API host in production. Vitest is configured here too
 * (jsdom + a setup file) so unit tests share the exact build pipeline.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5150',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Playwright specs live in e2e/ and must never run under Vitest — they
    // need a real browser and a running server, not jsdom.
    exclude: ['e2e/**', 'node_modules/**'],
    css: false,
  },
});
