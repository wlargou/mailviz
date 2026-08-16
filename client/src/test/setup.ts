import '@testing-library/jest-dom/vitest';

// jsdom has no ResizeObserver, and several Carbon components (Modal, Tile and
// anything using `useResizeObserver`) construct one on mount — without this a
// component test throws before it can assert anything.
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
