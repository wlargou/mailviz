import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Matches vite.config.ts. Carbon's packages declare a react@18 peer, so npm
    // used to place react@18 in the workspace root while the client ran 19 —
    // and @testing-library/react, being hoisted to the root, resolved that 18
    // and blew up with "Cannot read properties of null (reading 'useRef')".
    // The root now pins react 19 to match the app; this keeps a single copy.
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/**/*.test.{ts,tsx}', 'src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
});
