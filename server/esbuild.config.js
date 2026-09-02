import { build } from 'esbuild';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Recursively find all .ts files in src/
function findTsFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findTsFiles(full));
    } else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

const entryPoints = findTsFiles('src');

await build({
  entryPoints,
  outdir: 'dist',
  /**
   * When this server was built.
   *
   * The release date has to be a property of the BUILD, not of the process:
   * a container restart — a crash, a scale event, a platform migration — is
   * not a release, and reporting process start time would silently relabel one
   * as the other. Substituted here so it is fixed at the moment the image is
   * made.
   *
   * `define` works with `bundle: false`; it is an identifier substitution
   * during transform, not a bundling feature.
   */
  define: {
    __SERVER_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  bundle: false,
});

console.log('Server build complete');
