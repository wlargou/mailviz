import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5174,
    // Fail loudly if the port is taken rather than silently shifting —
    // a shifted port breaks CLIENT_URL and the OAuth redirect.
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3002',
        ws: true,
      },
    },
  },
});
