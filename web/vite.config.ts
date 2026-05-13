import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: false,
    // The calling library makes up most of the media chunk.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: 'media', test: /node_modules\/livekit-client/ }] },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
