import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSecretFiles, SECRET_FILE_VARIABLES } from './secretFiles.js';

/**
 * Secrets given as files (`X_FILE`), the way the cluster mounts them.
 *
 * What can go wrong is quiet. A file read AFTER env.ts has captured its values
 * leaves the app on its development fallbacks — a JWT secret derived from a
 * string in this repository — and nothing looks broken. A newline kept from
 * `echo secret > file` makes a different secret. A missing file that is
 * skipped instead of reported starts the app without the secret at all.
 *
 * dotenv is stubbed out so that a developer's server/.env cannot fill in a
 * variable these tests leave unset on purpose.
 */
vi.mock('dotenv', () => ({ default: { config: () => ({}) } }));
vi.mock('dotenv/config', () => ({}));

let dir: string;

/** Writes `contents` to a fresh file and returns its path. */
function secretFile(name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mailviz-secret-files-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadSecretFiles', () => {
  it('reads X from the file X_FILE names when X is unset', () => {
    const source: NodeJS.ProcessEnv = { JWT_SECRET_FILE: secretFile('jwt', 'from-the-file') };

    loadSecretFiles(['JWT_SECRET'], source);

    expect(source.JWT_SECRET).toBe('from-the-file');
  });

  it('strips one trailing newline, and only one', () => {
    // `echo secret > file` adds one; a secret with a newline on the end is a
    // different secret, and a database URL with one is a different database
    // name. A second newline was put there by somebody, so it stays.
    const source: NodeJS.ProcessEnv = {
      JWT_SECRET_FILE: secretFile('lf', 'secret\n'),
      JWT_REFRESH_SECRET_FILE: secretFile('crlf', 'refresh\r\n'),
      TOKEN_ENCRYPTION_KEY_FILE: secretFile('two', 'key\n\n'),
      GOOGLE_CLIENT_SECRET_FILE: secretFile('inner', ' spaced\nvalue '),
    };

    loadSecretFiles(
      ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'TOKEN_ENCRYPTION_KEY', 'GOOGLE_CLIENT_SECRET'],
      source
    );

    expect(source.JWT_SECRET).toBe('secret');
    expect(source.JWT_REFRESH_SECRET).toBe('refresh');
    expect(source.TOKEN_ENCRYPTION_KEY).toBe('key\n');
    expect(source.GOOGLE_CLIENT_SECRET).toBe(' spaced\nvalue ');
  });

  it('lets a set X win over X_FILE, and says so without printing either value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source: NodeJS.ProcessEnv = {
      DATABASE_URL: 'postgresql://from-the-environment',
      DATABASE_URL_FILE: secretFile('db', 'postgresql://from-the-file'),
    };

    loadSecretFiles(['DATABASE_URL'], source);

    expect(source.DATABASE_URL).toBe('postgresql://from-the-environment');
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toMatch(/DATABASE_URL and DATABASE_URL_FILE are both set/);
    expect(message).not.toMatch(/from-the/);
    warn.mockRestore();
  });

  it('treats an empty X as unset, like every fallback in env.ts', () => {
    const source: NodeJS.ProcessEnv = {
      JWT_SECRET: '',
      JWT_SECRET_FILE: secretFile('empty-env', 'from-the-file'),
    };

    loadSecretFiles(['JWT_SECRET'], source);

    expect(source.JWT_SECRET).toBe('from-the-file');
  });

  it('refuses to go on when X_FILE names a file that does not exist', () => {
    const missing = join(dir, 'not-mounted');
    const source: NodeJS.ProcessEnv = { TOKEN_ENCRYPTION_KEY_FILE: missing };

    // Going on would start the app on a fallback: plaintext token storage here.
    expect(() => loadSecretFiles(['TOKEN_ENCRYPTION_KEY'], source)).toThrow(
      `TOKEN_ENCRYPTION_KEY_FILE is ${missing}, which does not exist.`
    );
    expect(source.TOKEN_ENCRYPTION_KEY).toBeUndefined();
  });

  it('refuses a path it cannot read, and says why', () => {
    const directory = join(dir, 'a-directory');
    mkdirSync(directory);

    expect(() =>
      loadSecretFiles(['JWT_SECRET'], { JWT_SECRET_FILE: directory })
    ).toThrow(`JWT_SECRET_FILE is ${directory}, which cannot be read (EISDIR).`);
  });

  it('leaves alone a variable that is not on its list', () => {
    const source: NodeJS.ProcessEnv = { ALLOWED_EMAILS_FILE: secretFile('allowed', '@example.com') };

    loadSecretFiles(['JWT_SECRET'], source);

    expect(source.ALLOWED_EMAILS).toBeUndefined();
  });

  it('covers every secret the app reads, by default', () => {
    expect([...SECRET_FILE_VARIABLES].sort()).toEqual(
      [
        'DATABASE_URL',
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'JWT_REFRESH_SECRET',
        'JWT_SECRET',
        'LOGO_DEV_TOKEN',
        'TOKEN_ENCRYPTION_KEY',
      ].sort()
    );

    const source: NodeJS.ProcessEnv = {};
    for (const name of SECRET_FILE_VARIABLES) {
      source[`${name}_FILE`] = secretFile(`default-${name}`, `${name.toLowerCase()}-value\n`);
    }

    loadSecretFiles(undefined, source);

    for (const name of SECRET_FILE_VARIABLES) {
      expect(source[name]).toBe(`${name.toLowerCase()}-value`);
    }
  });
});

/**
 * The wiring: a file is only useful if it is read before anything reads the
 * variable. env.ts captures every value when it is first imported, and the boot
 * guard reads process.env.
 */
describe('secret files at startup', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    vi.resetModules();
  });

  /** process.env with these secrets given only as files. */
  function environmentWithFiles(files: Record<string, string>, extra: NodeJS.ProcessEnv = {}) {
    process.env = { ...saved, ...extra };
    for (const [name, contents] of Object.entries(files)) {
      delete process.env[name];
      process.env[`${name}_FILE`] = secretFile(`startup-${name}`, contents);
    }
  }

  it('env.ts holds the values from the files, not its development fallbacks', async () => {
    environmentWithFiles({
      DATABASE_URL: 'postgresql://app:pw@db.internal:5432/app_db\n',
      JWT_SECRET: 'jwt-from-a-file\n',
      GOOGLE_CLIENT_SECRET: 'google-from-a-file\n',
    });
    vi.resetModules();

    const { env } = await import('./env.js');

    expect(env.DATABASE_URL).toBe('postgresql://app:pw@db.internal:5432/app_db');
    expect(env.JWT_SECRET).toBe('jwt-from-a-file');
    expect(env.GOOGLE_CLIENT_SECRET).toBe('google-from-a-file');
  });

  it('satisfies the production boot guard with every secret given as a file', async () => {
    environmentWithFiles(
      {
        JWT_SECRET: 'a-real-secret\n',
        JWT_REFRESH_SECRET: 'a-different-real-secret\n',
        TOKEN_ENCRYPTION_KEY: `${'ff'.repeat(32)}\n`,
      },
      { NODE_ENV: 'production' }
    );
    vi.resetModules();

    const { assertProductionSecrets } = await import('./env.js');

    expect(() => assertProductionSecrets()).not.toThrow();
  });

  it('fails the import, naming the variable, when a mounted file is missing', async () => {
    process.env = { ...saved, JWT_SECRET_FILE: join(dir, 'never-mounted') };
    delete process.env.JWT_SECRET;
    vi.resetModules();

    await expect(import('./env.js')).rejects.toThrow(/JWT_SECRET_FILE is .*never-mounted, which does not exist/);
  });

  it('prisma.config.ts reads DATABASE_URL_FILE, for the migrator', async () => {
    environmentWithFiles({ DATABASE_URL: 'postgresql://owner:pw@db.internal:5432/app_db\n' });
    vi.resetModules();

    // Outside src/, so outside tsconfig's rootDir: imported by URL, untyped.
    const configUrl = new URL('../../prisma.config.ts', import.meta.url).href;
    const { default: config } = await import(/* @vite-ignore */ configUrl);

    expect(config.datasource.url).toBe('postgresql://owner:pw@db.internal:5432/app_db');
  });
});
