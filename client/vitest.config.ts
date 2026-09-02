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

    /**
     * 20s, not vitest's default 5s.
     *
     * Nothing here is slow: the worst test in the suite runs in ~480ms on its
     * own. Under the full run it was measured at 2042ms and intermittently
     * blew past 5s — 28 jsdom environments and their workers contending for
     * the same cores, not a test doing more work. So a 5s limit was really
     * asserting "a core was free".
     *
     * Measured, twelve full runs each on an otherwise idle machine: 2 failures
     * out of 12 at 5s, 0 out of 12 at 20s. Under contention it was worse —
     * 5 runs in 12, spread across the timezone picker, the attendee list, the
     * label field and pagination, whichever happened to be unlucky.
     *
     * A timeout is there to stop a hang, and 20s still does that — it is two
     * orders of magnitude above the real cost. What it stops doing is
     * reporting machine load as a product defect.
     */
    testTimeout: 20_000,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/**/*.test.{ts,tsx}', 'src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
});
