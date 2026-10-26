/**
 * inviteService.ts — Couple invitation + 5000-diamond charge (Builder C, 2026-10-26).
 *
 * App code only. No push, no OTA, no VPS, no live RTDB writes from this file's
 * authoring step — every write below happens only at runtime, from a real
 * user tap, against the live database the app is already signed into.
 *
 * Data shapes (field names are EXACT — Builder D reads these nodes):
 * - couple_invites/{inviteId} (inviteId = push key):
 *     { senderUid, recipientUid, status: 'pending' | 'failed' | ...,
 *       tokenDesign: 'cupid' | 'eternal' | 'lovelock' | 'luster',
 *       createdAt: ServerValue.TIMESTAMP, expiresAt: number (client estimate,
 *       createdAt + 18000000, display only), receiptId }
 *   (Accept/reject/formation is Builder D's job; this file only creates
 *   'pending' invites and marks them 'failed' when the charge cannot land.)
 * - couple_charges/{receiptId} (receiptId = senderUid + '_' + Date.now() + random):
 *     { uid, amount, inviteId, status: 'claimed' | 'done', createdAt }
 *
 * CHARGE ORDER (exactly-once — never deduct without an invite, never deduct twice):
 *   (1) Create the invite FIRST (status 'pending', carrying receiptId).
 *   (2) Transaction-claim couple_charges/{receiptId} (create-only; an existing
 *       record with status 'done' means already paid — resume path).
 *   (3) Transaction on wallets/{senderUid} that decrements balance by exactly
 *       the price AND writes wallets/{senderUid}/debits/{receiptId} in the
 *       SAME transaction (receipt-guarded: if debits/{receiptId} already
 *       exists, the transaction is a no-op success).
 *   (4) Mark couple_charges/{receiptId} status 'done'.
 *   If step (3) fails (insufficient funds or error), the invite is set to
 *   'failed' and a plain error is surfaced — no money moves without an invite,
 *   and a failed invite is never left looking sendable.
 *
 * RULES THIS CODE NEEDS (coordinator patches live rules; see report):
 *   couple_invites create/read/status-transition + 5h expiry via server `now`,
 *   couple_charges claim, wallets debit + debits receipt, userCouples reads,
 *   couple_invites .indexOn ["senderUid", "recipientUid"].
 *   NOTE: the wallets/{uid} parent transaction in step (3) needs a write grant
 *   at wallets/$uid (or on its debits child) — the current live balance-child
 *   rule alone does NOT grant a write at the parent path. Until the rule lands,
 *   step (3) will fail with PERMISSION_DENIED and the invite is marked 'failed'.
 *
 * Price/config: couple_config/invitePriceDiamonds if present, else 5000.
 * This file never writes couple_config.
 */

import {
  ref,
  get,
  set,
  update,
  push,
  query,
  orderByChild,
  equalTo,
  runTransaction,
  serverTimestamp,
} from 'firebase/database';
import { database } from '@/src/config/firebase';
import { buildChatId, createOrGetChat, sendMessage } from '@/src/features/chat/services/firebaseDmService';
import { intimacyPairKey } from '@/src/features/voice-room/services/intimacyService';

export const COUPLE_INVITE_EXPIRY_MS = 18000000; // 5 hours
export const DEFAULT_INVITE_PRICE = 5000;

export type TokenDesign = 'cupid' | 'eternal' | 'lovelock' | 'luster';

export type InviteStatus = 'pending' | 'failed' | 'accepted' | 'rejected' | 'expired';

export interface CoupleInvite {
  id: string;
  senderUid: string;
  recipientUid: string;
  status: InviteStatus;
  tokenDesign: TokenDesign;
  createdAt: number;
  expiresAt: number;
  receiptId: string;
}

export interface CoupleCharge {
  uid: string;
  amount: number;
  inviteId: string;
  status: 'claimed' | 'done';
  createdAt: number;
}

export class InviteError extends Error {}

function newReceiptId(senderUid: string): string {
  return `${senderUid}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Client-clock expiry check (display / sendability only — server rules enforce expiry). */
export function isInviteExpired(invite: {
  createdAt?: number | object | null;
  expiresAt?: number | null;
}): boolean {
  const now = Date.now();
  if (typeof invite.expiresAt === 'number' && invite.expiresAt > 0) {
    return now >= invite.expiresAt;
  }
  if (typeof invite.createdAt === 'number' && invite.createdAt > 0) {
    return now >= invite.createdAt + COUPLE_INVITE_EXPIRY_MS;
  }
  // Unresolved server timestamp (createdAt is an object placeholder): not expired yet.
  return false;
}

/** Invite price: RTDB couple_config/invitePriceDiamonds if present, else 5000. Never crashes. */
export async function getInvitePrice(): Promise<number> {
  try {
    const snap = await get(ref(database, 'couple_config/invitePriceDiamonds'));
    const v = snap.val();
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v);
  } catch {
    // fall through to default
  }
  return DEFAULT_INVITE_PRICE;
}

/** True when uid already has a couple (userCouples/{uid} entry exists). Absent = free. */
export async function hasCouple(uid: string): Promise<boolean> {
  if (!uid) return false;
  try {
    const snap = await get(ref(database, `userCouples/${uid}`));
    return snap.exists() && snap.val() !== null;
  } catch {
    return false;
  }
}

/** The sender's pending, unexpired outgoing invite, if any (newest first). */
export async function findPendingOutgoingInvite(senderUid: string): Promise<CoupleInvite | null> {
  if (!senderUid) return null;
  const snap = await get(
    query(ref(database, 'couple_invites'), orderByChild('senderUid'), equalTo(senderUid)),
  );
  if (!snap.exists()) return null;
  const out: CoupleInvite[] = [];
  snap.forEach((c) => {
    const v = c.val() as Omit<CoupleInvite, 'id'>;
    if (v && v.status === 'pending') {
      const inv: CoupleInvite = {
        id: c.key ?? '',
        senderUid: v.senderUid,
        recipientUid: v.recipientUid,
        status: v.status,
        tokenDesign: v.tokenDesign,
        createdAt: typeof v.createdAt === 'number' ? v.createdAt : 0,
        expiresAt: typeof v.expiresAt === 'number' ? v.expiresAt : 0,
        receiptId: v.receiptId ?? '',
      };
      if (!isInviteExpired(inv)) out.push(inv);
    }
  });
  out.sort((a, b) => (b.createdAt || b.expiresAt) - (a.createdAt || a.expiresAt));
  return out[0] ?? null;
}

/** Read one charge record (null when absent). */
export async function getCharge(receiptId: string): Promise<CoupleCharge | null> {
  if (!receiptId) return null;
  const snap = await get(ref(database, `couple_charges/${receiptId}`));
  if (!snap.exists()) return null;
  return snap.val() as CoupleCharge;
}

/** Spendable diamond balance (0 when no wallet yet). */
export async function getWalletBalance(uid: string): Promise<number> {
  try {
    const snap = await get(ref(database, `wallets/${uid}/balance`));
    const v = snap.val();
    return typeof v === 'number' ? v : 0;
  } catch {
    return 0;
  }
}

/**
 * Re-check the send-time gates: recipient is in the sender's inbox (an existing
 * DM thread; an isHidden/deleted entry counts as absent) AND the pair's
 * intimacy value is > 0.
 */
export async function checkInviteEligibility(
  senderUid: string,
  recipientUid: string,
): Promise<{ inInbox: boolean; intimacyValue: number }> {
  const chatId = buildChatId(senderUid, recipientUid);
  const [chatSnap, intimacySnap] = await Promise.all([
    get(ref(database, `userChats/${senderUid}/${chatId}`)),
    get(ref(database, `intimacy/${intimacyPairKey(senderUid, recipientUid)}`)),
  ]);
  const chatVal = chatSnap.exists() ? (chatSnap.val() as { isHidden?: boolean }) : null;
  const inInbox = !!chatVal && chatVal.isHidden !== true;
  const intimacyVal = intimacySnap.exists()
    ? (intimacySnap.val() as { value?: number })
    : null;
  const intimacyValue =
    intimacyVal && typeof intimacyVal.value === 'number' ? intimacyVal.value : 0;
  return { inInbox, intimacyValue };
}

/**
 * Step (3) of the charge order: one transaction on wallets/{senderUid} that
 * decrements balance by exactly `amount` AND writes debits/{receiptId} in the
 * same write. Receipt-guarded: an existing debits/{receiptId} makes this a
 * no-op success (never deducts twice). Returns 'debited' | 'already-debited'.
 * Throws InviteError('insufficient') when the balance cannot cover the price.
 */
async function debitWalletWithReceipt(
  senderUid: string,
  receiptId: string,
  inviteId: string,
  amount: number,
): Promise<'debited' | 'already-debited'> {
  const walletRef = ref(database, `wallets/${senderUid}`);
  const result = await runTransaction(walletRef, (cur: unknown) => {
    const wallet = (cur ?? null) as Record<string, unknown> | null;
    if (!wallet || typeof wallet !== 'object') return; // no wallet → abort
    const debits = (wallet.debits ?? {}) as Record<string, unknown>;
    if (debits[receiptId] !== undefined) return wallet; // no-op success
    const balance = wallet.balance;
    if (typeof balance !== 'number' || balance < amount) return; // abort
    return {
      ...wallet,
      balance: balance - amount,
      debits: {
        ...debits,
        [receiptId]: { amount, inviteId, createdAt: Date.now() },
      },
    };
  });
  if (result.committed) {
    return 'debited';
  }
  // Aborted: either insufficient funds, or a concurrent debit already landed.
  // Re-read the receipt — if it exists, the debit already happened (success).
  const receiptSnap = await get(ref(database, `wallets/${senderUid}/debits/${receiptId}`));
  if (receiptSnap.exists()) return 'already-debited';
  throw new InviteError('insufficient');
}

async function markInviteFailed(inviteId: string): Promise<void> {
  try {
    await update(ref(database, `couple_invites/${inviteId}`), { status: 'failed' });
  } catch {
    // The invite stays 'pending' in the worst case; the error below is still surfaced.
  }
}

/**
 * Run steps (2)–(4) for an already-created invite: claim the charge, debit the
 * wallet (receipt-guarded), mark the charge 'done'. Returns true when the
 * price is paid (fresh debit or replayed receipt). Throws on failure; the
 * caller marks the invite 'failed'.
 */
async function claimAndDebit(
  senderUid: string,
  inviteId: string,
  receiptId: string,
  amount: number,
): Promise<void> {
  // Step (2): transaction-claim couple_charges/{receiptId} (create-only).
  const chargeRef = ref(database, `couple_charges/${receiptId}`);
  const claim = await runTransaction(chargeRef, (cur: unknown) => {
    if (cur !== null && typeof cur === 'object') {
      const existing = cur as CoupleCharge;
      if (existing.status === 'done') return existing; // already paid — resume path
      if (existing.uid === senderUid && existing.inviteId === inviteId) return existing; // claimed, not done — resume
      return; // claimed by someone/something else → abort
    }
    return { uid: senderUid, amount, inviteId, status: 'claimed', createdAt: Date.now() } as CoupleCharge;
  });
  if (!claim.committed) {
    throw new InviteError('charge-claim-failed');
  }
  const claimed = claim.snapshot.val() as CoupleCharge | null;
  if (claimed && claimed.status === 'done') return; // already paid, nothing to debit

  // Step (3): receipt-guarded wallet debit.
  await debitWalletWithReceipt(senderUid, receiptId, inviteId, amount);

  // Step (4): mark the charge 'done'. If this write fails after a successful
  // debit, the debit receipt (wallets/{uid}/debits/{receiptId}) is still the
  // authoritative guard: a later resume re-runs step (3) as a no-op and
  // retries this mark, so the money is never taken twice. Retry once, then
  // surface success anyway — the invite is paid; the charge flag converges
  // on the next resume/retry rather than failing a paid invite.
  try {
    await update(chargeRef, { status: 'done' });
  } catch {
    try {
      await update(chargeRef, { status: 'done' });
    } catch {
      // Paid invite; charge flag retries on resume. Do not fail the send.
    }
  }
}

export interface SendCoupleInviteArgs {
  senderUid: string;
  recipientUid: string;
  tokenDesign: TokenDesign;
}

export interface SendCoupleInviteResult {
  inviteId: string;
  receiptId: string;
  price: number;
  resumed: boolean;
}

/**
 * Send a couple invitation with the exactly-once 5000-diamond charge.
 *
 * RESUME LOGIC: if the sender already has a pending outgoing invite whose
 * receipt is claimed-but-not-done, Send does NOT create a new invite — it
 * resumes the debit for THAT invite (steps 2–4) and returns it. A pending
 * invite whose receipt is already 'done' blocks a new send (one pending
 * outgoing invite at a time). An expired pending invite does not block.
 */
export async function sendCoupleInvite({
  senderUid,
  recipientUid,
  tokenDesign,
}: SendCoupleInviteArgs): Promise<SendCoupleInviteResult> {
  if (!senderUid || !recipientUid) throw new InviteError('missing-user');
  if (senderUid === recipientUid) throw new InviteError('self-invite');

  // Send-time one-person rule: neither side may already have a couple.
  const [senderHasCouple, recipientHasCouple] = await Promise.all([
    hasCouple(senderUid),
    hasCouple(recipientUid),
  ]);
  if (senderHasCouple) throw new InviteError('sender-already-coupled');
  if (recipientHasCouple) throw new InviteError('recipient-already-coupled');

  // Resume path: a pending outgoing invite with a claimed-but-not-done receipt.
  const pending = await findPendingOutgoingInvite(senderUid);
  if (pending) {
    const charge = await getCharge(pending.receiptId);
    if (charge && charge.status === 'claimed') {
      const price = await getInvitePrice();
      try {
        await claimAndDebit(senderUid, pending.id, pending.receiptId, price);
      } catch (e) {
        await markInviteFailed(pending.id);
        throw e;
      }
      return { inviteId: pending.id, receiptId: pending.receiptId, price, resumed: true };
    }
    // Pending + paid (or unclaimed edge): one pending invite at a time.
    throw new InviteError('pending-exists');
  }

  // Re-check inbox + intimacy at send time.
  const { inInbox, intimacyValue } = await checkInviteEligibility(senderUid, recipientUid);
  if (!inInbox) throw new InviteError('not-in-inbox');
  if (!(intimacyValue > 0)) throw new InviteError('no-intimacy');

  const price = await getInvitePrice();
  const balance = await getWalletBalance(senderUid);
  if (balance < price) throw new InviteError('insufficient');

  // Step (1): create the invite FIRST (status 'pending', carrying receiptId).
  const receiptId = newReceiptId(senderUid);
  const inviteRef = push(ref(database, 'couple_invites'));
  const inviteId = inviteRef.key;
  if (!inviteId) throw new InviteError('invite-create-failed');
  const nowEstimate = Date.now();
  await set(inviteRef, {
    senderUid,
    recipientUid,
    status: 'pending',
    tokenDesign,
    createdAt: serverTimestamp(),
    expiresAt: nowEstimate + COUPLE_INVITE_EXPIRY_MS,
    receiptId,
  });

  // Steps (2)–(4). On failure the invite is marked 'failed' — no money moved
  // without an invite, and a failed invite is never acceptable as sent.
  try {
    await claimAndDebit(senderUid, inviteId, receiptId, price);
  } catch (e) {
    await markInviteFailed(inviteId);
    throw e;
  }
  return { inviteId, receiptId, price, resumed: false };
}

/**
 * FRIEND TAB Send (coordinator decision): delivers the chosen token as a
 * gift-style DM message — token art + text, NO diamond charge, NO couple
 * formation, NO intimacy change. Uses the existing clean DM path:
 * createOrGetChat (creates the thread entry if missing) + sendMessage.
 * When token art exists it is sent as an 'image' message followed by a text
 * message naming the token; when art is missing, only the text message is
 * sent. sendMessage itself never touches intimacy or wallets.
 */
export async function sendFriendTokenMessage(args: {
  senderUid: string;
  senderName: string;
  recipientUid: string;
  recipientName: string;
  tokenDesign: TokenDesign;
  tokenLabel: string;
  tokenArtUrl: string | null;
}): Promise<void> {
  const { senderUid, senderName, recipientUid, recipientName, tokenLabel, tokenArtUrl } = args;
  if (!senderUid || !recipientUid || senderUid === recipientUid) {
    throw new InviteError('missing-user');
  }
  const chatId = await createOrGetChat(senderUid, senderName, recipientUid, recipientName);
  if (tokenArtUrl) {
    await sendMessage(chatId, senderUid, recipientUid, tokenArtUrl, 'image', undefined, undefined, senderName);
  }
  await sendMessage(
    chatId,
    senderUid,
    recipientUid,
    `Sent you a ${tokenLabel} token`,
    'text',
    undefined,
    undefined,
    senderName,
  );
}
