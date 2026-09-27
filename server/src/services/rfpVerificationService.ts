import { Prisma } from '../lib/prismaClient.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { canAccessRfp, isRfpOwner } from '../utils/accessControl.js';
import type { RfpVerificationDecision } from '../utils/rfpComposition.js';

type Tx = Prisma.TransactionClient;

/**
 * Who checks a tender's response, and what they decided.
 *
 * The rule this file exists to hold in one place: **with verifiers, a piece
 * that has a file is Ready exactly when every verifier has approved its
 * current version.** Anything that can change either side of that — a new
 * version, a deleted one, a decision, a verifier added or removed — ends in
 * `syncItemStatus`, so the status can never disagree with the approvals.
 *
 * Without verifiers, and for a piece with no file (a cautionnement handed
 * in on paper), the status stays the user's to set, as it always was.
 */

/** The version a verifier is asked about: the highest-numbered file. */
export async function currentVersionOf(tx: Tx, itemId: string) {
  return tx.rfpDocument.findFirst({ where: { itemId }, orderBy: { version: 'desc' }, select: { id: true, version: true } });
}

/**
 * Whether every verifier has approved the current version.
 *
 * `null` when the rule does not apply — no verifiers, or nothing uploaded —
 * which is different from `false`: the status is then left alone.
 */
async function allApproved(tx: Tx, rfpId: string, itemId: string): Promise<boolean | null> {
  const [verifiers, current] = await Promise.all([
    tx.rfpVerifier.findMany({ where: { rfpId }, select: { userId: true } }),
    currentVersionOf(tx, itemId),
  ]);
  if (verifiers.length === 0 || !current) return null;
  const approvals = await tx.rfpItemVerification.count({
    where: {
      itemId,
      documentId: current.id,
      decision: 'APPROVED',
      userId: { in: verifiers.map((v) => v.userId) },
    },
  });
  return approvals === verifiers.length;
}

/** Bring one piece's status in line with its approvals. */
export async function syncItemStatus(tx: Tx, rfpId: string, itemId: string) {
  const item = await tx.rfpFolderItem.findUnique({ where: { id: itemId }, select: { status: true } });
  // Not applicable is a decision about the tender, not about a file.
  if (!item || item.status === 'NOT_APPLICABLE') return;
  const approved = await allApproved(tx, rfpId, itemId);
  if (approved === null) return;
  const next = approved ? 'READY' : item.status === 'READY' ? 'IN_PROGRESS' : item.status;
  if (next !== item.status) await tx.rfpFolderItem.update({ where: { id: itemId }, data: { status: next } });
}

/** The same, for every piece of a tender — after its verifiers change. */
export async function syncRfpItems(tx: Tx, rfpId: string) {
  const items = await tx.rfpFolderItem.findMany({ where: { folder: { rfpId } }, select: { id: true } });
  for (const { id } of items) await syncItemStatus(tx, rfpId, id);
}

/**
 * Refuse a manual Ready that the verifiers have not given.
 *
 * Only where the rule applies: with no verifiers, or nothing uploaded, the
 * user still marks a piece ready themselves.
 */
export async function assertReadyAllowed(tx: Tx, rfpId: string, itemId: string) {
  if ((await allApproved(tx, rfpId, itemId)) === false) {
    throw new AppError(409, 'VERIFICATION_PENDING', 'Every verifier must approve the current version first');
  }
}

/**
 * Take someone off a tender's verifiers, and their decisions with them.
 *
 * Their approvals must stop counting at once — otherwise removing a
 * verifier who had approved would leave pieces Ready on the word of someone
 * who no longer has a say. Used when unsharing, too.
 */
export async function removeVerifiers(tx: Tx, rfpId: string, userIds: string[]) {
  if (userIds.length === 0) return;
  await tx.rfpVerifier.deleteMany({ where: { rfpId, userId: { in: userIds } } });
  await tx.rfpItemVerification.deleteMany({ where: { userId: { in: userIds }, item: { folder: { rfpId } } } });
}

async function assertAccess(userId: string, rfpId: string) {
  if (!(await canAccessRfp(rfpId, userId))) throw new AppError(404, 'RFP_NOT_FOUND', 'RFP not found');
}

async function itemOf(rfpId: string, itemId: string) {
  const item = await prisma.rfpFolderItem.findFirst({ where: { id: itemId, folder: { rfpId } }, select: { id: true } });
  if (!item) throw new AppError(404, 'ITEM_NOT_FOUND', 'Piece not found');
  return item;
}

export const rfpVerificationService = {
  /**
   * Replace the verifiers with exactly these people.
   *
   * The owner's to decide, like sharing. Everyone named must already be able
   * to open the tender — the owner or a recipient — because a verifier who
   * cannot see the documents cannot verify them.
   */
  async setVerifiers(userId: string, rfpId: string, userIds: string[]) {
    if (!(await isRfpOwner(rfpId, userId))) throw new AppError(404, 'RFP_NOT_FOUND', 'RFP not found');
    const wanted = [...new Set(userIds)];

    const shares = await prisma.rfpShare.findMany({ where: { rfpId }, select: { sharedWithUserId: true } });
    const eligible = new Set([userId, ...shares.map((s) => s.sharedWithUserId)]);
    const outsiders = wanted.filter((id) => !eligible.has(id));
    if (outsiders.length > 0) {
      throw new AppError(400, 'VERIFIER_WITHOUT_ACCESS', 'A verifier must be the owner or someone the RFP is shared with');
    }

    await prisma.$transaction(async (tx) => {
      const current = await tx.rfpVerifier.findMany({ where: { rfpId }, select: { userId: true } });
      const removed = current.map((v) => v.userId).filter((id) => !wanted.includes(id));
      await removeVerifiers(tx, rfpId, removed);
      await tx.rfpVerifier.createMany({ data: wanted.map((id) => ({ rfpId, userId: id })), skipDuplicates: true });
      // A new verifier un-readies what they have not seen; a removed one may
      // have been the last approval missing.
      await syncRfpItems(tx, rfpId);
    });

    return prisma.rfpVerifier.findMany({
      where: { rfpId },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      orderBy: { createdAt: 'asc' },
    });
  },

  /**
   * Record the caller's decision on the piece's current version.
   *
   * Always on the current version: deciding on a draft that has since been
   * replaced would approve something nobody will submit.
   */
  async decide(
    userId: string,
    rfpId: string,
    itemId: string,
    data: { decision: RfpVerificationDecision; comment?: string | null }
  ) {
    await assertAccess(userId, rfpId);
    await itemOf(rfpId, itemId);
    const verifier = await prisma.rfpVerifier.findUnique({ where: { rfpId_userId: { rfpId, userId } } });
    if (!verifier) throw new AppError(403, 'NOT_A_VERIFIER', 'You are not a verifier of this RFP');

    return prisma.$transaction(async (tx) => {
      const current = await currentVersionOf(tx, itemId);
      if (!current) throw new AppError(409, 'NOTHING_TO_VERIFY', 'This piece has no file to verify');
      const comment = data.comment?.trim() || null;
      const verification = await tx.rfpItemVerification.upsert({
        where: { itemId_userId: { itemId, userId } },
        create: { itemId, userId, documentId: current.id, decision: data.decision, comment },
        update: { documentId: current.id, decision: data.decision, comment },
      });
      await syncItemStatus(tx, rfpId, itemId);
      return verification;
    });
  },

  /** Take back the caller's own decision. */
  async withdraw(userId: string, rfpId: string, itemId: string) {
    await assertAccess(userId, rfpId);
    await itemOf(rfpId, itemId);
    await prisma.$transaction(async (tx) => {
      await tx.rfpItemVerification.deleteMany({ where: { itemId, userId } });
      await syncItemStatus(tx, rfpId, itemId);
    });
  },
};
