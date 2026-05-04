import path from 'path';
import { fileURLToPath } from 'url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  logLevel: 'error',
  plugins: [react()],
  // Excalidraw's CJS entry (main.js) gates on `process.env.IS_PREACT` and
  // `process.env.NODE_ENV`. Vite has no `process` global by default, so we
  // resolve those gates at build time. This is the official recommendation
  // from the Excalidraw docs for Vite consumers.
  define: {
    'process.env.IS_PREACT': JSON.stringify('false'),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
