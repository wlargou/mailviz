import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What version of this app is running.
 *
 * Read from the repo-root `VERSION` file rather than derived at runtime,
 * because the deployed container has neither `.git` nor any Railway variable
 * carrying the commit — both checked. Whatever is in that file when the image
 * is built is what shipped, which makes the version a property of the commit
 * instead of a guess about it.
 *
 * Four components, `major.minor.patch.build`, so a rebuild of the same code
 * can be told apart from a change to it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * `src/config/` and `dist/config/` sit at the same depth under `server/`, so
 * one relative path finds the repo root whether this is running through tsx in
 * development or from the build. The cwd candidates are a belt-and-braces
 * fallback for anything that starts the process from somewhere unexpected.
 */
const CANDIDATES = [
  resolve(HERE, '../../../VERSION'),
  resolve(process.cwd(), '../VERSION'),
  resolve(process.cwd(), 'VERSION'),
];

function readVersion(): string {
  for (const path of CANDIDATES) {
    try {
      const raw = readFileSync(path, 'utf-8').trim();
      if (raw) return raw;
    } catch {
      // Try the next candidate — a missing file here is not fatal.
    }
  }
  /**
   * Never throw. A version string is diagnostic, and an app that will not boot
   * because it cannot say what it is would be a worse outcome than one that
   * says it does not know.
   */
  console.warn('[Version] No VERSION file found; reporting "unknown"');
  return 'unknown';
}

/** Resolved once at import: the file cannot change under a running process. */
export const APP_VERSION = readVersion();

/**
 * Substituted by esbuild at build time — see `define` in esbuild.config.js.
 * Absent under tsx in development, which is why every read is guarded.
 */
declare const __SERVER_BUILT_AT__: string | undefined;

/**
 * When this build was made, which is what "released" means to a reader.
 *
 * Deliberately NOT process start time. A container restart — a crash, a scale
 * event, a platform migration — is not a release, and reporting the process's
 * age would relabel one as the other and quietly reset the date of a build
 * that has not changed in weeks.
 *
 * Development has no build step, so it falls back to process start: the only
 * honest answer there, and never seen by a user.
 */
export const RELEASED_AT: string =
  typeof __SERVER_BUILT_AT__ === 'string' ? __SERVER_BUILT_AT__ : new Date().toISOString();
