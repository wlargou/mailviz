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
    /**
     * Keep esbuild as the CSS minifier.
     *
     * Vite 8 switched the default to Lightning CSS, which cannot parse the CSS
     * Anchor Positioning that Carbon ships: `@position-try` with a nested
     * selector, in @carbon/styles/scss/components/date-picker/_date-picker-next.scss.
     * The build dies with "[lightningcss minify] Unexpected token Delim('.')"
     * after transforming all 1928 modules — it is a minifier parse failure, not
     * anything wrong with our CSS.
     *
     * esbuild is what Vite 6 used here, so this is the status quo rather than a
     * workaround. Revisit when Lightning CSS supports the at-rule.
     */
    cssMinify: 'esbuild',
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
