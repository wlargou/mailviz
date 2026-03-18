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
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  bundle: false,
});

console.log('Server build complete');
