import '@testing-library/jest-dom/vitest';

// jsdom has no ResizeObserver, and several Carbon components (Modal, Tile and
// anything using `useResizeObserver`) construct one on mount — without this a
// component test throws before it can assert anything.
// jsdom has no matchMedia either. `InterstitialScreen.Body` builds a carousel on
// mount (via @carbon/utilities `initCarousel`), which calls it unconditionally —
// without this the body never mounts, so its steps and footer buttons are absent
// and the failure looks like a missing button rather than a missing API.
// Checked with `typeof`, not `in`: jsdom declares the property but leaves it
// undefined, so an `in` guard passes and the stub never gets installed.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
