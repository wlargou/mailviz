import { build } from 'esbuild';
import { globSync } from 'node:fs';

// Get all TypeScript source files (preserves file structure like tsc)
const entryPoints = globSync('src/**/*.ts');

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
