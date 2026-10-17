/**
 * Loads client references from an extraction manifest — the one-time import
 * of the consolidated attestations PDF, each attestation already split into
 * its own file.
 *
 *     node dist/scripts/importClientReferences.js --user=me@powerm.ma --dir=/data/import/references          # dry run
 *     node dist/scripts/importClientReferences.js --user=me@powerm.ma --dir=/data/import/references --apply
 *
 * `<dir>/manifest.json` lists the references; `<dir>/files/` holds their
 * documents. The manifest is not in the repository: it is the customers'
 * confidential data, and it reaches the container by `railway ssh`.
 *
 * Idempotent by `importKey`: a reference already imported is left alone —
 * including whatever the user has corrected since — and only a missing
 * document is added. Companies are linked by domain, among the importing
 * user's own; one that is not found is left unlinked and reported, never
 * created, because a company row also drives mail filing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../lib/prisma.js';
import { clientReferenceService } from '../services/clientReferenceService.js';
import { writeStoredFile } from '../services/rfpStorage.js';
import { createClientReferenceSchema } from '../validators/clientReferenceValidator.js';

export interface ManifestEntry {
  importKey: string;
  /** The file under `files/`, if the reference has one. */
  file?: string | null;
  /** Domains of the issuing company, most likely first. */
  customerDomains?: string[];
  /** The reference, in the API's create shape. */
  input: Record<string, unknown>;
}

interface Options {
  userEmail: string;
  dir: string;
  apply: boolean;
  log?: (line: string) => void;
}

export interface ImportResult {
  apply: boolean;
  total: number;
  created: number;
  skipped: number;
  documentsAdded: number;
  invalid: Array<{ importKey: string; error: string }>;
  unlinked: string[];
}

async function companyFor(userId: string, domains: string[] = []): Promise<string | null> {
  if (domains.length === 0) return null;
  const found = await prisma.customer.findMany({
    where: { userId, domain: { in: domains }, status: { not: 'IGNORED' } },
    select: { id: true, domain: true, status: true },
  });
  // The first listed domain wins; an account over a mere sender.
  for (const d of domains) {
    const hits = found.filter((c) => c.domain === d);
    const best = hits.find((c) => c.status === 'ACCOUNT') ?? hits[0];
    if (best) return best.id;
  }
  return null;
}

export async function importClientReferences({ userEmail, dir, apply, log = console.log }: Options): Promise<ImportResult> {
  const user = await prisma.user.findUnique({ where: { email: userEmail }, select: { id: true } });
  if (!user) throw new Error(`No user ${userEmail}`);
  const manifest: ManifestEntry[] = JSON.parse(await fs.promises.readFile(path.join(dir, 'manifest.json'), 'utf8'));

  const result: ImportResult = { apply, total: manifest.length, created: 0, skipped: 0, documentsAdded: 0, invalid: [], unlinked: [] };

  for (const entry of manifest) {
    const parsed = createClientReferenceSchema.safeParse(entry.input);
    if (!parsed.success) {
      result.invalid.push({ importKey: entry.importKey, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      continue;
    }
    const filePath = entry.file ? path.join(dir, 'files', path.basename(entry.file)) : null;
    if (filePath && !fs.existsSync(filePath)) {
      result.invalid.push({ importKey: entry.importKey, error: `missing file ${entry.file}` });
      continue;
    }

    const existing = await prisma.clientReference.findFirst({
      where: { userId: user.id, importKey: entry.importKey },
      select: { id: true, documentStorageKey: true },
    });
    const customerId = await companyFor(user.id, entry.customerDomains);
    if (!customerId) result.unlinked.push(`${entry.importKey} ${String(entry.input.customerName)}`);

    if (existing) {
      result.skipped++;
      if (filePath && !existing.documentStorageKey) {
        result.documentsAdded++;
        if (apply) await attach(user.id, existing.id, filePath);
      }
      continue;
    }

    result.created++;
    if (filePath) result.documentsAdded++;
    if (!apply) continue;
    const created = await clientReferenceService.create(user.id, { ...parsed.data, customerId }, { importKey: entry.importKey });
    if (filePath) await attach(user.id, created.id, filePath);
    log(`${entry.importKey}  ${created.customerName}`);
  }
  return result;
}

async function attach(userId: string, referenceId: string, filePath: string) {
  const data = await fs.promises.readFile(filePath);
  const mimeType = filePath.toLowerCase().endsWith('.pdf') ? 'application/pdf' : filePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  const storageKey = await writeStoredFile(userId, mimeType, data);
  await clientReferenceService.replaceDocument(userId, referenceId, { filename: path.basename(filePath), mimeType, size: data.length, storageKey });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const apply = process.argv.includes('--apply');
  const userEmail = arg('user');
  const dir = arg('dir');
  if (!userEmail || !dir) {
    console.error('Usage: importClientReferences --user=<email> --dir=<manifest dir> [--apply]');
    process.exitCode = 1;
  } else {
    importClientReferences({ userEmail, dir, apply })
      .then((r) => console.log(JSON.stringify(r, null, 2), apply ? '' : '\n(dry run — re-run with --apply)'))
      .catch((err) => {
        console.error(err);
        process.exitCode = 1;
      })
      .finally(() => prisma.$disconnect());
  }
}
