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
 * When this process started — a proxy for when the image was deployed, which
 * is the question being asked when someone checks the version at all.
 */
export const STARTED_AT = new Date().toISOString();
