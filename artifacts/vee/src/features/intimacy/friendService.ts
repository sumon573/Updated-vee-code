/**
 * friendService.ts — Explicit friendships (2026-10-27, boss correction).
 *
 * Boss order (2026-10-27 05:06): Friend tiles must NOT auto-fill from
 * intimacy pairs. Friendship is a SEPARATE explicit relationship, MAX 5
 * people, starting EMPTY like the Couple (+) slot. Existing intimacy
 * pairs stay as intimacy data only (Intimacy tab + couple-invite ranking)
 * and never appear as friends.
 *
 * Formation flow (boss referenced "couple-এর মতো" but never specified
 * mechanics — this mirror is a REPORTED DEFAULT, not a boss spec):
 *   Friend (+) → detail Friend tab → "Send Friend Invitation" →
 *   invitation list (inbox + intimacy > 0, ranked DESC, TOP 20 — the
 *   couple-invite mirror) → send → recipient's CHAT LIST gets a system
 *   card with Accept + Reject (mirror CoupleInviteCard).
 * Max-5 is enforced client-side at send AND at accept (RTDB rules have
 * no child-count function, so rules-grade max-5 is impossible — the
 * rules below enforce pair-membership + create-only instead).
 * NO charge, NO expiry: the boss specified neither, so none is invented.
 * No unfriend in v1 (no delete rule, no UI) — removal is a future order.
 *
 * RTDB shapes:
 *   friend_invites/{inviteId} = {
 *     senderUid, recipientUid,
 *     status: 'pending' | 'accepted' | 'rejected',
 *     createdAt (client ms; rules window now-1h .. now+5min) }
 *   userFriends/{uid}/{friendUid} = { createdAt (client ms) }
 *
 * App code only; no push, no OTA, no VPS, no RTDB writes outside this
 * service's own functions.
 */

import {
  ref, get, onValue, query, orderByChild, equalTo, update, push,
} from 'firebase/database';
import { database } from '@/src/config/firebase';

/** Boss cap: at most 5 explicit friends per user. */
export const MAX_FRIENDS = 5;

export type FriendInviteStatus = 'pending' | 'accepted' | 'rejected';

export type FriendInvite = {
  id: string;
  senderUid: string;
  recipientUid: string;
  status: FriendInviteStatus;
  createdAt?: number;
};

export type FriendEntry = {
  uid: string;
  createdAt: number;
};

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function parseInvite(id: string, raw: Record<string, unknown>): FriendInvite {
  return {
    id,
    senderUid: typeof raw.senderUid === 'string' ? raw.senderUid : '',
    recipientUid: typeof raw.recipientUid === 'string' ? raw.recipientUid : '',
    status: (typeof raw.status === 'string' ? raw.status : 'pending') as FriendInviteStatus,
    createdAt: asNumber(raw.createdAt),
  };
}

// ─── Reads ────────────────────────────────────────────────────────────────

/**
 * Live explicit friends for one uid, oldest first (formed order).
 * Requires no index: userFriends/{uid} is read as a whole map.
 */
export function subscribeUserFriends(
  uid: string,
  cb: (friends: FriendEntry[]) => void,
): () => void {
  if (!uid) { cb([]); return () => {}; }
  return onValue(
    ref(database, `userFriends/${uid}`),
    (snap) => {
      const out: FriendEntry[] = [];
      if (snap.exists()) {
        snap.forEach((child) => {
          const raw = child.val() as Record<string, unknown> | null;
          out.push({
            uid: child.key ?? '',
            createdAt: raw && typeof raw.createdAt === 'number' ? raw.createdAt : 0,
          });
        });
      }
      out.sort((a, b) => a.createdAt - b.createdAt);
      cb(out.filter((f) => !!f.uid));
    },
    () => cb([]),
  );
}

/** One-shot friend uids for one user (used by max/already-friends checks). */
export async function fetchFriendUids(uid: string): Promise<string[]> {
  if (!uid) return [];
  const snap = await get(ref(database, `userFriends/${uid}`));
  if (!snap.exists()) return [];
  const out: string[] = [];
  snap.forEach((child) => {
    if (child.key) out.push(child.key);
  });
  return out;
}

/**
 * Live incoming friend invites for one recipient, newest first. Returns
 * ALL statuses: the chat list filters to pending + invites acted on in
 * this session, so accepted/rejected cards can show terminal text.
 * Requires a rules `.indexOn: ["recipientUid"]` on friend_invites.
 */
export function subscribeIncomingFriendInvites(
  recipientUid: string,
  cb: (invites: FriendInvite[]) => void,
): () => void {
  if (!recipientUid) { cb([]); return () => {}; }
  const q = query(
    ref(database, 'friend_invites'),
    orderByChild('recipientUid'),
    equalTo(recipientUid),
  );
  return onValue(
    q,
    (snap) => {
      const out: FriendInvite[] = [];
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
export async function fetchFriendInvite(inviteId: string): Promise<FriendInvite | null> {
  if (!inviteId) return null;
  const snap = await get(ref(database, `friend_invites/${inviteId}`));
  if (!snap.exists()) return null;
  return parseInvite(inviteId, snap.val() as Record<string, unknown>);
}

/** ALL pending outgoing invites from one sender, newest first. */
export async function findPendingOutgoingFriendInvites(
  senderUid: string,
): Promise<FriendInvite[]> {
  if (!senderUid) return [];
  const q = query(
    ref(database, 'friend_invites'),
    orderByChild('senderUid'),
    equalTo(senderUid),
  );
  const snap = await get(q);
  if (!snap.exists()) return [];
  const pendings: FriendInvite[] = [];
  snap.forEach((child) => {
    const raw = child.val() as Record<string, unknown> | null;
    if (raw) {
      const inv = parseInvite(child.key ?? '', raw);
      if (inv.status === 'pending') pendings.push(inv);
    }
  });
  pendings.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return pendings;
}

/** Newest pending outgoing invite from one sender, or null. */
export async function findPendingOutgoingFriendInvite(
  senderUid: string,
): Promise<FriendInvite | null> {
  const all = await findPendingOutgoingFriendInvites(senderUid);
  return all[0] ?? null;
}

// ─── Send ─────────────────────────────────────────────────────────────────

/**
 * Send a friend invitation (sender only, no charge, no expiry).
 *
 * Pre-checks (client-side, before any write — all failures throw a plain
 * message, nothing is written):
 *   1. Sender != recipient, both uids present.
 *   2. Not already friends (either direction's userFriends map).
 *   3. No pending invite between the pair in EITHER direction.
 *   4. Sender has fewer than MAX_FRIENDS friends.
 *   5. Recipient has fewer than MAX_FRIENDS friends.
 *
 * The write is one push: friend_invites/{newId} = pending record.
 * createdAt uses client ms (Date.now) — the rules window (now-1h ..
 * now+5min) absorbs ordinary clock skew, and this avoids the
 * serverTimestamp-placeholder question in rules validation.
 */
export async function sendFriendInvitation(
  senderUid: string,
  recipientUid: string,
): Promise<string> {
  if (!senderUid || !recipientUid) throw new Error('Invalid invitation.');
  if (senderUid === recipientUid) throw new Error('You cannot add yourself as a friend.');
  const [senderFriends, recipientFriends, outgoingList, incomingList] = await Promise.all([
    fetchFriendUids(senderUid),
    fetchFriendUids(recipientUid),
    findPendingOutgoingFriendInvites(senderUid),
    findPendingOutgoingFriendInvites(recipientUid),
  ]);
  if (senderFriends.includes(recipientUid) || recipientFriends.includes(senderUid)) {
    throw new Error('You are already friends.');
  }
  const hasPendingBetween =
    outgoingList.some((inv) => inv.recipientUid === recipientUid) ||
    incomingList.some((inv) => inv.recipientUid === senderUid);
  if (hasPendingBetween) {
    throw new Error('You already have a pending invitation with this person.');
  }
  if (senderFriends.length >= MAX_FRIENDS) {
    throw new Error(`You already have ${MAX_FRIENDS} friends — the maximum.`);
  }
  if (recipientFriends.length >= MAX_FRIENDS) {
    throw new Error(`This person already has ${MAX_FRIENDS} friends.`);
  }
  const newRef = push(ref(database, 'friend_invites'));
  await update(newRef, {
    senderUid,
    recipientUid,
    status: 'pending',
    createdAt: Date.now(),
  });
  return newRef.key ?? '';
}

// ─── Accept / formation ───────────────────────────────────────────────────

/**
 * Accept an incoming friend invitation (recipient only) and form the
 * friendship (both directions).
 *
 * Pre-checks (client-side, before any write):
 *   1. The invite exists and its recipient is the caller.
 *   2. Its status is still 'pending'.
 *   3. Not already friends.
 *   4. NEITHER side is already at MAX_FRIENDS (re-checked at accept, so
 *      a sender who filled up after sending cannot push a 6th friend).
 *
 * The write is ONE atomic multi-path update:
 *   friend_invites/{inviteId}/status = 'accepted'
 *   userFriends/{senderUid}/{recipientUid} = { createdAt }
 *   userFriends/{recipientUid}/{senderUid} = { createdAt }
 * No charge, no expiry, no Love-House-style unlock — friendship is only
 * the tile + tab membership.
 */
export async function acceptFriendInvitation(inviteId: string, myUid: string): Promise<void> {
  if (!inviteId || !myUid) throw new Error('Invalid invitation.');
  const invite = await fetchFriendInvite(inviteId);
  if (!invite) throw new Error('This invitation no longer exists.');
  if (invite.recipientUid !== myUid) throw new Error('This invitation is not for you.');
  if (invite.status !== 'pending') throw new Error('This invitation is no longer pending.');
  if (!invite.senderUid || invite.senderUid === myUid) throw new Error('Invalid invitation.');
  const [senderFriends, recipientFriends] = await Promise.all([
    fetchFriendUids(invite.senderUid),
    fetchFriendUids(myUid),
  ]);
  if (senderFriends.includes(myUid) || recipientFriends.includes(invite.senderUid)) {
    throw new Error('You are already friends.');
  }
  if (senderFriends.length >= MAX_FRIENDS) {
    throw new Error(`This person already has ${MAX_FRIENDS} friends.`);
  }
  if (recipientFriends.length >= MAX_FRIENDS) {
    throw new Error(`You already have ${MAX_FRIENDS} friends — the maximum.`);
  }
  const now = Date.now();
  await update(ref(database), {
    [`friend_invites/${inviteId}/status`]: 'accepted',
    [`userFriends/${invite.senderUid}/${myUid}`]: { createdAt: now },
    [`userFriends/${myUid}/${invite.senderUid}`]: { createdAt: now },
  });
}

// ─── Reject ─────────────────────────────────────────────────────────────────

/** Reject an incoming invitation (recipient only): pending → 'rejected'. */
export async function rejectFriendInvitation(inviteId: string, myUid: string): Promise<void> {
  if (!inviteId || !myUid) throw new Error('Invalid invitation.');
  const invite = await fetchFriendInvite(inviteId);
  if (!invite) throw new Error('This invitation no longer exists.');
  if (invite.recipientUid !== myUid) throw new Error('This invitation is not for you.');
  if (invite.status !== 'pending') throw new Error('This invitation is no longer pending.');
  await update(ref(database, `friend_invites/${inviteId}`), { status: 'rejected' });
}

/**
 * RULES THIS CODE NEEDS (for the rules patch — client code is written to
 * succeed under exactly these, nothing broader):
 *   friend_invites:
 *     .indexOn: ["senderUid", "recipientUid"]  (both list subscriptions)
 *     .read: query-scoped by senderUid/recipientUid === auth.uid, plus
 *       $inviteId read for sender/recipient.
 *     $inviteId .write: create = sender-only, pending, not self,
 *       createdAt within [now-1h, now+5min], exactly the four fields;
 *       transitions pending → 'accepted' / 'rejected' by the recipient
 *       only, all other fields pinned. NO expiry transitions (no expiry).
 *   userFriends:
 *     .read: any authed user (the detail page shows OTHER users' friends
 *       view-only, mirroring userCouples).
 *     $uid/$friendUid .write: create-only (!data.exists()), writer is
 *       $uid or $friendUid, $uid !== $friendUid, value is exactly
 *       { createdAt: number }. No delete rule in v1 (no unfriend).
 *   Max-5 is NOT rules-enforced: RTDB rules have no child-count
 *   function. The client enforces it at send AND at accept; the rules
 *   enforce pair-membership + create-only, so the worst forgery is a
 *   6th friend entry for oneself — display-only, no money, no access.
 */
