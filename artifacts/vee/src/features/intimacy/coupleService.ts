/**
 * coupleService.ts — Couple invitations, formation, and couple hearts.
 * Builder D (2026-10-26). App code only; no push, no OTA, no VPS, no RTDB
 * writes outside this service's own functions.
 *
 * RTDB shapes (Builder C writes invites with exactly these field names):
 *   couple_invites/{inviteId} = {
 *     senderUid, recipientUid,
 *     status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'failed',
 *     tokenDesign, createdAt (server timestamp), expiresAt, receiptId }
 *   couples/{pairKey} = {
 *     partners: [uidA, uidB], tokenDesign,
 *     hearts, giftHearts, togetherHearts, pkHearts, formedAt }
 *     where pairKey = two uids sorted + '_' (same as intimacyPairKey).
 *   userCouples/{uid} = { pairKey, inviteId } — the one-person pointer
 *   (object form so rules can validate it against the pending invite).
 *
 * Couple level is computed client-side from total hearts by Builder B's
 * display (src/features/intimacy/coupleLevels.ts, present in the tree).
 * This file deliberately does NOT import it: formation and hearts need no
 * level math, and the gift path must never break on a display module.
 * Compatibility verified: Builder B's subscribeCoupleState accepts a plain
 * string userCouples pointer (= pairKey) and derives the partner from the
 * pairKey split when no uidA/uidB/members field is present, so the
 * partners-array record written here reads back correctly.
 *
 * Expiry: 5 hours from send. No writer marks expiry: the card derives it
 * from createdAt + 5h (or expiresAt when present) and accept is refused
 * client-side on an expired invite. This service does NOT flip a pending
 * invite to 'expired' — whether the recipient may make that transition is
 * a rules question for the coordinator (see the rules list at the bottom
 * of this file); until the rules allow it, display + accept-refusal carry
 * expiry, and the stored status stays 'pending'.
 */

import {
  ref, get, onValue, query, orderByChild, equalTo, update, runTransaction,
  serverTimestamp,
} from 'firebase/database';
import { database } from '@/src/config/firebase';
import { intimacyPairKey } from '@/src/features/voice-room/services/intimacyService';

/** 5 hours in ms — the couple-invitation lifetime (coordinator decision). */
export const COUPLE_INVITE_EXPIRY_MS = 5 * 60 * 60 * 1000; // 18000000

export type CoupleInviteStatus = 'pending' | 'accepted' | 'rejected' | 'expired' | 'failed';

export type CoupleInvite = {
  id: string;
  senderUid: string;
  recipientUid: string;
  status: CoupleInviteStatus;
  tokenDesign?: string;
  /** Server timestamp, resolved to ms on read. May be absent on a fresh write. */
  createdAt?: number;
  expiresAt?: number;
  receiptId?: string;
};

export type CoupleRecord = {
  partners: [string, string];
  tokenDesign?: string;
  inviteId?: string;
  hearts: number;
  giftHearts: number;
  togetherHearts: number;
  pkHearts: number;
  formedAt: number | object;
};

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function parseInvite(id: string, raw: Record<string, unknown>): CoupleInvite {
  return {
    id,
    senderUid: typeof raw.senderUid === 'string' ? raw.senderUid : '',
    recipientUid: typeof raw.recipientUid === 'string' ? raw.recipientUid : '',
    status: (typeof raw.status === 'string' ? raw.status : 'pending') as CoupleInviteStatus,
    tokenDesign: typeof raw.tokenDesign === 'string' ? raw.tokenDesign : undefined,
    createdAt: asNumber(raw.createdAt),
    expiresAt: asNumber(raw.expiresAt),
    receiptId: typeof raw.receiptId === 'string' ? raw.receiptId : undefined,
  };
}

/** Expiry instant for an invite: expiresAt when present, else createdAt + 5h. */
export function coupleInviteExpiresAt(invite: CoupleInvite): number | null {
  if (typeof invite.expiresAt === 'number') return invite.expiresAt;
  if (typeof invite.createdAt === 'number') return invite.createdAt + COUPLE_INVITE_EXPIRY_MS;
  return null;
}

/** True when the invite is past its 5h lifetime. Unknown timestamps = not expired. */
export function isCoupleInviteExpired(invite: CoupleInvite, now = Date.now()): boolean {
  const exp = coupleInviteExpiresAt(invite);
  if (exp === null) return false;
  // Rules enforce accept only while now <= createdAt + 5h; mirror it here.
  if (typeof invite.createdAt === 'number' && now > invite.createdAt + COUPLE_INVITE_EXPIRY_MS) return true;
  return now > exp;
}

/** Remaining ms until expiry, or null when unknowable. Never negative. */
export function coupleInviteRemainingMs(invite: CoupleInvite, now = Date.now()): number | null {
  const exp = coupleInviteExpiresAt(invite);
  if (exp === null) return null;
  return Math.max(0, exp - now);
}

// ─── Reads ────────────────────────────────────────────────────────────────

/**
 * Live incoming invites for one recipient, newest first. Returns ALL
 * statuses (not just pending): the chat list filters to pending + invites
 * acted on in this session, so accepted/rejected cards can show their
 * terminal text ("Accepted" / "Declined") instead of vanishing mid-tap.
 * Requires a rules `.indexOn: ["recipientUid"]` on couple_invites.
 */
export function subscribeIncomingCoupleInvites(
  recipientUid: string,
  cb: (invites: CoupleInvite[]) => void,
): () => void {
  if (!recipientUid) { cb([]); return () => {}; }
  const q = query(
    ref(database, 'couple_invites'),
    orderByChild('recipientUid'),
    equalTo(recipientUid),
  );
  return onValue(
    q,
    (snap) => {
      const out: CoupleInvite[] = [];
      if (snap.exists()) {
        snap.forEach((child) => {
          const raw = child.val() as Record<string, unknown> | null;
          if (raw) out.push(parseInvite(child.key ?? '', raw));
        });
      }
      out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      cb(out);
    },
    () => cb([]),
  );
}

/** One-shot read of a single invite (used by the accept/reject pre-checks). */
export async function fetchCoupleInvite(inviteId: string): Promise<CoupleInvite | null> {
  if (!inviteId) return null;
  const snap = await get(ref(database, `couple_invites/${inviteId}`));
  if (!snap.exists()) return null;
  return parseInvite(inviteId, snap.val() as Record<string, unknown>);
}

// ─── Accept / formation ───────────────────────────────────────────────────

/**
 * Accept an incoming couple invitation (recipient only) and form the couple.
 *
 * Pre-checks (client-side, before any write — all failures throw a plain
 * message, nothing is written):
 *   1. The invite exists and its recipient is the caller.
 *   2. Its status is still 'pending'.
 *   3. It is not expired: now <= createdAt + 5h (and <= expiresAt when set).
 *      An expired accept throws 'This invitation has expired' and the card
 *      flips to its Expired display; the stored status is left untouched.
 *   4. NEITHER side already has a userCouples entry. If either is coupled,
 *      this throws and never overwrites, never creates a second couple.
 *
 * The write is ONE atomic multi-path update, so it either all lands or
 * all fails — exactly the paths the rules allow, nothing extra:
 *   couples/{pairKey}                = full record, hearts all 0
 *   userCouples/{senderUid}          = { pairKey, inviteId }
 *   userCouples/{recipientUid}       = { pairKey, inviteId }
 *   couple_invites/{inviteId}/status = 'accepted'
 *
 * Love House unlock needs no code here: the detail page hides its lock
 * when a couple exists (Builder B's display); this formation write is
 * what unlocks it.
 */
export async function acceptCoupleInvite(inviteId: string, myUid: string): Promise<string> {
  if (!inviteId || !myUid) throw new Error('Invalid invitation.');
  const invite = await fetchCoupleInvite(inviteId);
  if (!invite) throw new Error('This invitation no longer exists.');
  if (invite.recipientUid !== myUid) throw new Error('This invitation is not for you.');
  if (invite.status !== 'pending') throw new Error('This invitation is no longer pending.');
  if (isCoupleInviteExpired(invite)) throw new Error('This invitation has expired.');
  if (!invite.senderUid || invite.senderUid === myUid) throw new Error('Invalid invitation.');

  const pairKey = intimacyPairKey(invite.senderUid, myUid);
  const [senderCoupleSnap, recipientCoupleSnap] = await Promise.all([
    get(ref(database, `userCouples/${invite.senderUid}`)),
    get(ref(database, `userCouples/${myUid}`)),
  ]);
  if (senderCoupleSnap.exists() || recipientCoupleSnap.exists()) {
    throw new Error('One of you is already in a couple.');
  }

  const [uidA, uidB] = [invite.senderUid, myUid].sort();
  const couple: CoupleRecord = {
    partners: [uidA, uidB],
    tokenDesign: invite.tokenDesign,
    inviteId: inviteId,
    hearts: 0,
    giftHearts: 0,
    togetherHearts: 0,
    pkHearts: 0,
    formedAt: serverTimestamp(),
  };
  await update(ref(database), {
    [`couples/${pairKey}`]: couple,
    [`userCouples/${invite.senderUid}`]: { pairKey, inviteId: inviteId },
    [`userCouples/${myUid}`]: { pairKey, inviteId: inviteId },
    [`couple_invites/${inviteId}/status`]: 'accepted',
  });
  return pairKey;
}

// ─── Reject ─────────────────────────────────────────────────────────────────

/**
 * Reject an incoming invitation (recipient only): a single write flipping
 * status pending → 'rejected'. The card then shows "Declined".
 * No refund: the 5000 diamonds were charged at send and are never refunded
 * on reject (or on expiry) — the card/result text says so honestly and
 * never promises a refund. The sender may later send a fresh invite, which
 * is a new invite with a new charge; no code is needed for that beyond
 * the normal send path.
 */
export async function rejectCoupleInvite(inviteId: string, myUid: string): Promise<void> {
  if (!inviteId || !myUid) throw new Error('Invalid invitation.');
  const invite = await fetchCoupleInvite(inviteId);
  if (!invite) throw new Error('This invitation no longer exists.');
  if (invite.recipientUid !== myUid) throw new Error('This invitation is not for you.');
  if (invite.status !== 'pending') throw new Error('This invitation is no longer pending.');
  await update(ref(database, `couple_invites/${inviteId}`), { status: 'rejected' });
}

// ─── Couple hearts from gifts ───────────────────────────────────────────────

/**
 * Gift-path couple hearts (coordinator weight: floor(diamonds / 10)).
 * Proceeds ONLY when:
 *   - seatedSender is true (the gift was sent from a voice room while the
 *     sender was seated — threaded from the gift caller; game modals and
 *     other callers pass nothing, which means no hearts), and
 *   - userCouples/{senderUid} and userCouples/{recipientUid} both exist
 *     AND point to the SAME pairKey (they are coupled to each other).
 * Then one transaction increments couples/{pairKey}/giftHearts by
 * floor(diamonds/10) and keeps hearts in sync in the same transaction:
 *   hearts = giftHearts + togetherHearts + pkHearts.
 *
 * togetherHearts / pkHearts are SERVER-written only and are only READ here
 * (0-defaults): a future bot loop, like the event bot, over LiveKit
 * participants + seats would credit time-together at +1 heart/min while
 * both are seated, and PK battles at +100 per battle joined +100 extra on
 * a win. That bot is NOT implemented in this build.
 *
 * Fire-and-forget by design: callers swallow all errors — a failed bump
 * must never fail a gift that already succeeded.
 */
export async function bumpCoupleHeartsForGift(args: {
  senderUid: string;
  recipientUid: string;
  diamonds: number;
  seatedSender?: boolean;
}): Promise<void> {
  const { senderUid, recipientUid, diamonds, seatedSender } = args;
  if (!seatedSender) return;
  if (!senderUid || !recipientUid || senderUid === recipientUid) return;
  if (!(diamonds > 0)) return;
  const delta = Math.floor(diamonds / 10);
  if (delta <= 0) return;
  try {
    const [senderSnap, recipientSnap] = await Promise.all([
      get(ref(database, `userCouples/${senderUid}`)),
      get(ref(database, `userCouples/${recipientUid}`)),
    ]);
    const toPairKey = (v: unknown): string | null =>
      typeof v === 'string' ? v :
      (v && typeof v === 'object' && typeof (v as Record<string, unknown>).pairKey === 'string'
        ? (v as Record<string, unknown>).pairKey as string : null);
    const senderPair = toPairKey(senderSnap.exists() ? senderSnap.val() : null);
    const recipientPair = toPairKey(recipientSnap.exists() ? recipientSnap.val() : null);
    if (!senderPair || senderPair !== recipientPair) return;
    const pairKey = senderPair;
    await runTransaction(ref(database, `couples/${pairKey}`), (cur: unknown) => {
      if (!cur || typeof cur !== 'object') return; // never create a couple from the gift path
      const rec = cur as Record<string, unknown>;
      const prevGift = typeof rec.giftHearts === 'number' ? rec.giftHearts : 0;
      const together = typeof rec.togetherHearts === 'number' ? rec.togetherHearts : 0;
      const pk = typeof rec.pkHearts === 'number' ? rec.pkHearts : 0;
      const nextGift = prevGift + delta;
      return {
        ...rec,
        giftHearts: nextGift,
        hearts: nextGift + together + pk,
      };
    });
  } catch {
    // Fire-and-forget: the gift stands; hearts for this gift are lost.
  }
}

/**
 * RULES THIS CODE NEEDS (for the coordinator's rules patch — client code is
 * written to succeed under exactly these, nothing broader):
 *   couple_invites:
 *     .indexOn: ["recipientUid"]  (the list subscription queries by it)
 *     .read: recipient (or sender) may read their own invites
 *     $inviteId/status .write: recipient-only transition
 *       pending → 'accepted' only while now <= createdAt + 18000000 (5h)
 *       pending → 'rejected' (recipient only, any time while pending)
 *       (pending → 'expired' by the recipient is NOT used by this build;
 *        if the rules grant it, a future client change may mark expiry —
 *        until then display + accept-refusal carry expiry.)
 *     other invite fields: recipient-readable; sender-writable on create
 *       only (Builder C's send path).
 *   couples/$pairKey:
 *     .write: create-only (no overwrite of an existing couple), writers
 *       limited to the two partners; hearts fields only-grow
 *       (new hearts/giftHearts/togetherHearts/pkHearts >= old values).
 *   userCouples/$uid:
 *     .write: create-only-if-absent (!data.exists()), value must equal the
 *       pairKey of a couple containing that uid; the accept update writes
 *       both sides at once, so the rule must permit the recipient to write
 *       the SENDER's pointer as part of formation (or formation fails).
 *   couples hearts client writes:
 *     giftHearts + hearts: partner-only, only-grow, in the same transaction
 *       (the bump transaction); togetherHearts/pkHearts: CLIENT-WRITE DENY
 *       (server/bot only) — the client only reads them as 0-defaults.
 */
