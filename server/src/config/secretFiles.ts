import { readFileSync } from 'node:fs';

/**
 * Secrets given as files: `X_FILE=/path` instead of `X=value`.
 *
 * On Kubernetes the secrets are mounted as files rather than injected as
 * environment variables, which keeps them out of `kubectl describe`, out of
 * the process environment a crash dump or a child process inherits, and out of
 * anything that logs its environment. The app still reads `process.env`
 * everywhere, so this copies each file into its variable once, at startup,
 * before anything reads it — `env.ts` calls it, and so does `prisma.config.ts`
 * for the migrator, which is given DATABASE_URL_FILE and nothing else.
 *
 * Kept apart from env.ts so that prisma.config.ts can import it without the
 * app's whole configuration, and so the migrator image needs this one file.
 */

/** Every variable that may be given as `<NAME>_FILE`. */
export const SECRET_FILE_VARIABLES = [
  'DATABASE_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'TOKEN_ENCRYPTION_KEY',
  'LOGO_DEV_TOKEN',
] as const;

/**
 * For each name: when `<NAME>` is unset and `<NAME>_FILE` is set, read the file
 * into `<NAME>`.
 *
 * - A set variable wins over its file, and says so once — both set is a
 *   configuration mistake, and the file being ignored would otherwise be silent.
 *   Empty counts as unset, as it does for every fallback in env.ts.
 * - One trailing newline is stripped: `echo secret > file` and most editors add
 *   one, and a JWT secret or a database URL with a newline on the end is a
 *   different value that fails far from here.
 * - A missing or unreadable file throws. Starting without the secret would fall
 *   back to a development default, which is the failure `assertProductionSecrets`
 *   exists to stop, and an error naming the path is the useful one.
 * - So does a file with nothing in it but whitespace — a Secret key created
 *   empty. As '' it would count as unset everywhere in env.ts: DATABASE_URL
 *   would quietly become the development database on localhost, and the pod
 *   would crash-loop on a connection error that names neither the file nor the
 *   variable.
 *
 * Writes into `source` (process.env by default) so that every reader, the boot
 * guard included, sees the same value. The value itself is never logged.
 */
export function loadSecretFiles(
  names: readonly string[] = SECRET_FILE_VARIABLES,
  source: NodeJS.ProcessEnv = process.env
): void {
  for (const name of names) {
    const fileVariable = `${name}_FILE`;
    const path = source[fileVariable];
    if (!path) continue;

    if (source[name]) {
      console.warn(`[env] ${name} and ${fileVariable} are both set; using ${name}`);
      continue;
    }

    let contents: string;
    try {
      contents = readFileSync(path, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      throw new Error(
        code === 'ENOENT'
          ? `${fileVariable} is ${path}, which does not exist.`
          : `${fileVariable} is ${path}, which cannot be read (${code ?? (err as Error).message}).`
      );
    }
    const value = contents.replace(/\r?\n$/, '');
    if (value.trim() === '') {
      throw new Error(`${fileVariable} is ${path}, which is empty.`);
    }
    source[name] = value;
  }
}
