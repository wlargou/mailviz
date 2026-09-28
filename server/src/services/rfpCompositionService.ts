import { Prisma } from '../lib/prismaClient.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { canAccessRfp } from '../utils/accessControl.js';
import { removeStoredFile } from './rfpStorage.js';
import { assertReadyAllowed, syncItemStatus } from './rfpVerificationService.js';
import {
  RFP_FOLDER_DEFAULT_ITEMS,
  RFP_FOLDER_KINDS,
  RFP_FOLDER_LABELS,
  folderPosition,
  isPerLotKind,
  type RfpFolderKind,
  type RfpItemStatus,
} from '../utils/rfpComposition.js';

type Tx = Prisma.TransactionClient;

/**
 * Lots, dossiers and pieces — what a tender response is made of.
 *
 * Everything here hangs off a tender and follows its access: the owner and
 * anyone it was shared with may work on it. A recipient preparing the
 * technical offer is the whole reason the tender was shared.
 */
async function assertAccess(userId: string, rfpId: string) {
  if (!(await canAccessRfp(rfpId, userId))) throw new AppError(404, 'RFP_NOT_FOUND', 'RFP not found');
}

const decimal = (value: number | null | undefined) =>
  value === null || value === undefined ? null : new Prisma.Decimal(value);

/**
 * The tender's budget is the total of its lots'.
 *
 * Denormalised onto `rfps.budget` so the register can sort by it, and
 * therefore recomputed by every path that changes a lot — this function is
 * the only writer of that column. No lot with a budget means no budget, not
 * zero: "the buyer published nothing" and "the buyer published 0 DH" are
 * different facts.
 */
export async function recomputeBudget(tx: Tx, rfpId: string) {
  const agg = await tx.rfpLot.aggregate({ where: { rfpId, budget: { not: null } }, _sum: { budget: true }, _count: { budget: true } });
  await tx.rfp.update({ where: { id: rfpId }, data: { budget: agg._count.budget > 0 ? agg._sum.budget : null } });
}

/** A folder of `kind`, with the standard pieces if asked for. */
async function createFolderRow(
  tx: Tx,
  rfpId: string,
  kind: RfpFolderKind,
  lot: { id: string; number: number } | null,
  opts: { title?: string; prefill: boolean }
) {
  const base = opts.title ?? RFP_FOLDER_LABELS[kind];
  const title = lot && !opts.title ? `${base} — Lot ${lot.number}` : base;
  const folder = await tx.rfpFolder.create({
    data: { rfpId, kind, lotId: lot?.id ?? null, title, position: folderPosition(kind, lot?.number ?? null) },
  });
  if (opts.prefill && RFP_FOLDER_DEFAULT_ITEMS[kind].length > 0) {
    await tx.rfpFolderItem.createMany({
      data: RFP_FOLDER_DEFAULT_ITEMS[kind].map((itemTitle, position) => ({ folderId: folder.id, title: itemTitle, position })),
    });
  }
  return folder;
}

/**
 * The lots and dossiers a new tender starts with — called inside the
 * create's transaction, so a tender never exists without its lots.
 */
export async function buildInitialComposition(
  tx: Tx,
  rfpId: string,
  lots: Array<{ title: string; budget?: number | null }> | undefined,
  composition: { kinds: RfpFolderKind[]; prefill: boolean } | undefined
) {
  const lotInputs = lots && lots.length > 0 ? lots : [{ title: 'Lot unique', budget: null }];
  const created = [];
  for (const [i, lot] of lotInputs.entries()) {
    created.push(await tx.rfpLot.create({ data: { rfpId, number: i + 1, title: lot.title, budget: decimal(lot.budget) } }));
  }

  // Each kind once, in the catalogue's order, whatever order they arrived in.
  const kinds = RFP_FOLDER_KINDS.filter((k) => composition?.kinds.includes(k));
  for (const kind of kinds) {
    if (isPerLotKind(kind)) {
      for (const lot of created) await createFolderRow(tx, rfpId, kind, lot, { prefill: composition!.prefill });
    } else {
      await createFolderRow(tx, rfpId, kind, null, { prefill: composition!.prefill });
    }
  }

  await recomputeBudget(tx, rfpId);
}

/** Files to unlink once the rows that own them are gone. */
async function storageKeysUnder(where: Prisma.RfpDocumentWhereInput) {
  return (await prisma.rfpDocument.findMany({ where, select: { storageKey: true } })).map((d) => d.storageKey);
}

async function unlinkAll(keys: string[]) {
  await Promise.all(keys.map((k) => removeStoredFile(k)));
}

async function lotOf(rfpId: string, lotId: string) {
  const lot = await prisma.rfpLot.findFirst({ where: { id: lotId, rfpId } });
  if (!lot) throw new AppError(404, 'RFP_LOT_NOT_FOUND', 'Lot not found');
  return lot;
}

async function folderOf(rfpId: string, folderId: string) {
  const folder = await prisma.rfpFolder.findFirst({ where: { id: folderId, rfpId } });
  if (!folder) throw new AppError(404, 'RFP_FOLDER_NOT_FOUND', 'Folder not found');
  return folder;
}

async function itemOf(rfpId: string, itemId: string) {
  const item = await prisma.rfpFolderItem.findFirst({ where: { id: itemId, folder: { rfpId } } });
  if (!item) throw new AppError(404, 'RFP_ITEM_NOT_FOUND', 'Piece not found');
  return item;
}

export const rfpCompositionService = {
  /** The dossier kinds and the pieces each starts with, for the wizard. */
  catalogue() {
    return RFP_FOLDER_KINDS.map((kind) => ({
      kind,
      label: RFP_FOLDER_LABELS[kind],
      perLot: isPerLotKind(kind),
      defaultItems: [...RFP_FOLDER_DEFAULT_ITEMS[kind]],
    }));
  },

  // ── Lots ────────────────────────────────────────────────────────────────

  /**
   * Add a lot. It takes the next number, and gets its own copy of every
   * per-lot dossier the tender already prepares: a new lot on a tender that
   * has financial offers needs a financial offer too.
   */
  async createLot(userId: string, rfpId: string, data: { title: string; budget?: number | null }) {
    await assertAccess(userId, rfpId);
    return prisma.$transaction(async (tx) => {
      const last = await tx.rfpLot.findFirst({ where: { rfpId }, orderBy: { number: 'desc' }, select: { number: true } });
      const lot = await tx.rfpLot.create({
        data: { rfpId, number: (last?.number ?? 0) + 1, title: data.title, budget: decimal(data.budget) },
      });
      const perLotKinds = await tx.rfpFolder.findMany({
        where: { rfpId, lotId: { not: null } },
        distinct: ['kind'],
        select: { kind: true },
      });
      for (const { kind } of perLotKinds) {
        await createFolderRow(tx, rfpId, kind as RfpFolderKind, lot, { prefill: true });
      }
      await recomputeBudget(tx, rfpId);
      return lot;
    });
  },

  async updateLot(userId: string, rfpId: string, lotId: string, data: { title?: string; budget?: number | null }) {
    await assertAccess(userId, rfpId);
    await lotOf(rfpId, lotId);
    return prisma.$transaction(async (tx) => {
      const lot = await tx.rfpLot.update({
        where: { id: lotId },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.budget !== undefined ? { budget: decimal(data.budget) } : {}),
        },
      });
      await recomputeBudget(tx, rfpId);
      return lot;
    });
  },

  /**
   * Remove a lot, its offers and their pieces' files. Never the last one: a
   * tender with no lot has nothing to bid on, and "Lot unique" is a lot.
   */
  async deleteLot(userId: string, rfpId: string, lotId: string) {
    await assertAccess(userId, rfpId);
    await lotOf(rfpId, lotId);
    if ((await prisma.rfpLot.count({ where: { rfpId } })) <= 1) {
      throw new AppError(400, 'LAST_LOT', 'A tender keeps at least one lot');
    }
    const keys = await storageKeysUnder({ item: { folder: { lotId } } });
    await prisma.$transaction(async (tx) => {
      await tx.rfpLot.delete({ where: { id: lotId } });
      await recomputeBudget(tx, rfpId);
    });
    await unlinkAll(keys);
  },

  // ── Folders ─────────────────────────────────────────────────────────────

  async createFolder(
    userId: string,
    rfpId: string,
    data: { kind: RfpFolderKind; lotId?: string | null; title?: string; prefill?: boolean }
  ) {
    await assertAccess(userId, rfpId);
    // The offers belong to a lot; the dossiers belong to the tender. "Autre"
    // may be either.
    if (isPerLotKind(data.kind) && !data.lotId) {
      throw new AppError(400, 'LOT_REQUIRED', `${RFP_FOLDER_LABELS[data.kind]} is prepared per lot`);
    }
    if (data.lotId && !isPerLotKind(data.kind) && data.kind !== 'OTHER') {
      throw new AppError(400, 'LOT_NOT_ALLOWED', `${RFP_FOLDER_LABELS[data.kind]} is prepared once per tender`);
    }
    const lot = data.lotId ? await lotOf(rfpId, data.lotId) : null;
    return prisma.$transaction((tx) => createFolderRow(tx, rfpId, data.kind, lot, { title: data.title, prefill: data.prefill ?? true }));
  },

  async updateFolder(userId: string, rfpId: string, folderId: string, data: { title: string }) {
    await assertAccess(userId, rfpId);
    await folderOf(rfpId, folderId);
    return prisma.rfpFolder.update({ where: { id: folderId }, data: { title: data.title } });
  },

  async deleteFolder(userId: string, rfpId: string, folderId: string) {
    await assertAccess(userId, rfpId);
    await folderOf(rfpId, folderId);
    const keys = await storageKeysUnder({ item: { folderId } });
    await prisma.rfpFolder.delete({ where: { id: folderId } });
    await unlinkAll(keys);
  },

  // ── Pieces ──────────────────────────────────────────────────────────────

  async createItem(userId: string, rfpId: string, folderId: string, data: { title: string }) {
    await assertAccess(userId, rfpId);
    await folderOf(rfpId, folderId);
    const last = await prisma.rfpFolderItem.findFirst({ where: { folderId }, orderBy: { position: 'desc' }, select: { position: true } });
    return prisma.rfpFolderItem.create({
      data: { folderId, title: data.title, position: (last?.position ?? -1) + 1 },
      include: { documents: true },
    });
  },

  async updateItem(
    userId: string,
    rfpId: string,
    itemId: string,
    data: { title?: string; status?: RfpItemStatus; notes?: string | null; assigneeId?: string | null; dueDate?: string | null }
  ) {
    await assertAccess(userId, rfpId);
    await itemOf(rfpId, itemId);
    // Only someone who can open the tender can prepare a piece of it.
    if (data.assigneeId && !(await canAccessRfp(rfpId, data.assigneeId))) {
      throw new AppError(400, 'ASSIGNEE_WITHOUT_ACCESS', 'Assign the piece to the owner or someone the RFP is shared with');
    }
    return prisma.$transaction(async (tx) => {
      // With verifiers, Ready is theirs to give; see rfpVerificationService.
      if (data.status === 'READY') await assertReadyAllowed(tx, rfpId, itemId);
      return tx.rfpFolderItem.update({
        where: { id: itemId },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
          ...(data.assigneeId !== undefined ? { assigneeId: data.assigneeId } : {}),
          ...(data.dueDate !== undefined ? { dueDate: data.dueDate ? new Date(data.dueDate) : null } : {}),
        },
        include: { documents: true },
      });
    });
  },

  async deleteItem(userId: string, rfpId: string, itemId: string) {
    await assertAccess(userId, rfpId);
    await itemOf(rfpId, itemId);
    const keys = await storageKeysUnder({ itemId });
    await prisma.rfpFolderItem.delete({ where: { id: itemId } });
    await unlinkAll(keys);
  },

  /**
   * A new version of a piece: the next number, who uploaded it, and the
   * piece back to In progress.
   *
   * Back to In progress whatever it was — even Ready, even N/A. A new file is
   * a new thing to check, and the approvals were given on the old one.
   *
   * Numbered inside the transaction and guarded by `@@unique([itemId,
   * version])`: two uploads racing for the same number make one of them
   * fail and retry, rather than both becoming "v3".
   */
  async addItemDocument(
    userId: string,
    rfpId: string,
    itemId: string,
    file: { filename: string; mimeType: string; size: number; storageKey: string }
  ) {
    await assertAccess(userId, rfpId);
    await itemOf(rfpId, itemId);
    for (let attempt = 0; ; attempt++) {
      try {
        return await prisma.$transaction(async (tx) => {
          const last = await tx.rfpDocument.findFirst({ where: { itemId }, orderBy: { version: 'desc' }, select: { version: true } });
          const doc = await tx.rfpDocument.create({
            data: {
              rfpId,
              itemId,
              kind: 'OTHER',
              filename: file.filename,
              mimeType: file.mimeType,
              size: file.size,
              storageKey: file.storageKey,
              version: (last?.version ?? 0) + 1,
              uploadedById: userId,
            },
          });
          await tx.rfpFolderItem.update({ where: { id: itemId }, data: { status: 'IN_PROGRESS' } });
          await syncItemStatus(tx, rfpId, itemId);
          return doc;
        });
      } catch (err) {
        const raced = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        if (!raced || attempt >= 2) throw err;
      }
    }
  },
};
