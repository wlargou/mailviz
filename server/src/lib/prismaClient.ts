/**
 * The single place that knows where the generated Prisma client lives.
 *
 * Prisma 7 stopped generating into node_modules, so `@prisma/client` no longer
 * resolves — every import has to point at the generated directory instead. That
 * would be sixteen files hard-coding a relative path into a build artefact, and
 * sixteen files to edit if it ever moves. This re-export keeps it to one.
 *
 * The path works unchanged before and after the build: `src/lib/` and
 * `dist/lib/` are both one level under the workspace root, so `../../generated`
 * resolves to `server/generated` either way. That is why the generator writes
 * there rather than under `src/`, which esbuild and tsconfig both glob.
 */
export * from '../../generated/prisma/index.js';
