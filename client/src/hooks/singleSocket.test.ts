import { describe, it, expect } from 'vitest';

/**
 * Exactly one module may open a WebSocket.
 *
 * CLAUDE.md states the rule — "one module-level socket, reference-counted
 * across subscribers... Never open your own" — and SettingsPage broke it
 * anyway, quietly, for as long as it took someone to read that file. A second
 * socket costs a connection, doubles every delivery, and (as there) arrives
 * without the reconnect logic, so the page it feeds freezes on the first drop
 * and never recovers.
 *
 * A source scan rather than a behavioural test, because that is what the rule
 * actually is: a constraint on the whole tree, which no single component's
 * tests can see. Nothing else in the suite would notice a third one appearing.
 *
 * `import.meta.glob` rather than node:fs — the client tsconfig carries no Node
 * types, and this keeps the test in the workspace whose rule it guards.
 */
const SOURCES = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Record<string, string>;

// Vite normalises glob keys to the shortest relative path, so the hook — a
// sibling of this file — comes back as './useEmailWebSocket.ts' rather than the
// '../hooks/...' the pattern was written with. Matched by suffix so the test
// does not depend on that normalisation.
const ALLOWED = /hooks\/useEmailWebSocket\.ts$|^\.\/useEmailWebSocket\.ts$/;

describe('the shared WebSocket', () => {
  it('is the only place that constructs one', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([path]) => !ALLOWED.test(path))
      .filter(([, source]) => /new WebSocket\s*\(/.test(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it('is actually reading the source tree', () => {
    // Without this the test above passes just as well on an empty glob — a
    // wrong pattern, a moved file — and guards nothing at all.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    const hook = Object.entries(SOURCES).find(([path]) => ALLOWED.test(path));
    expect(hook?.[1]).toContain('new WebSocket(');
  });
});
