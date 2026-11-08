/**
 * roomPkService.ts — 1v1 PK (2026-10-25, boss concept).
 *
 * Two room users battle head-to-head; the audience sends diamonds (gifts)
 * and the diamond value is the score — higher score wins when the timer
 * ends. Scoring is authoritative: a VPS scorer (C:\vee-pk-bot\pk.cjs,
 * task VeePk) watches the room's giftFeed and totals `coins` per battler
 * inside the PK window (idempotent per gift key, so restarts never
 * double-count). Clients never write scores (live rules deny it).
 *
 * RTDB — roomPk/{roomId}:
 *   status: 'challenge' | 'active' | 'ended'
 *   challenger / opponent: { uid, name }
 *   createdAt, challengedAt, startedAt?, endsAt?
 *   scores: { totals: { uid: number }, scored: { giftKey: true },
 *     donors: { uid: { name, photoURL?, total } } } (bot-only)
 *   winnerUid?: string | null, draw?: boolean (bot-only)
 * One PK per room at a time (rules: create only when no node exists).
 * Challenge expires after 60s, ended nodes are cleaned up by the scorer.
 */

import { ref, update, remove, onValue, get } from 'firebase/database';
import { database, auth } from '@/src/config/firebase';

export const PK_DURATION_MS = 5 * 60 * 1000;
/** Host-pickable battle lengths (minutes) — the host sets it at start. */
export const PK_DURATION_OPTIONS_MIN = [3, 5, 10];
export const PK_DURATION_MIN_MS = 60 * 1000;
export const PK_DURATION_MAX_MS = 10 * 60 * 1000;
export const PK_CHALLENGE_TIMEOUT_MS = 60 * 1000;

export interface PkUser {
  uid: string;
  name: string;
}

export interface PkDonor {
  uid: string;
  name: string;
  photoURL?: string | null;
  total: number;
}

export interface PkScores {
  totals: Record<string, number>;
  /** Bot-written per-donor totals (from giftFeed fromUid/fromName/fromAvatar). */
  donors?: Record<string, { name: string; photoURL?: string | null; total: number }>;
}

export interface RoomPk {
  status: 'challenge' | 'active' | 'ended';
  challenger: PkUser;
  opponent: PkUser;
  createdAt: number;
  challengedAt: number;
  startedAt: number;
  endsAt: number;
  /** Host-chosen battle length (ms); 0 = legacy node (treated as 5 min). */
  durationMs: number;
  scores: PkScores | null;
  winnerUid: string | null;
  draw: boolean;
}

/* ── Optimistic PK scores (2026-11-08, PK realtime polish) ──────────
 * The gift you send plays instantly, but the authoritative score only
 * moves after wallet → giftFeed → VPS bot → RTDB (2–5s, worse in a gift
 * storm). That gap is exactly why PK felt fake/slow: the gift flies and
 * the bar sits still. So a gift you just sent successfully to a battler
 * bumps the DISPLAYED totals immediately, and the bump is reconciled
 * away as the bot's authoritative totals catch up (each authoritative
 * increase eats the same amount of bump — never double-counted, never a
 * visible jump down). Bumps are display-only: the bot still owns scores
 * and the winner. A bump only lives while its battle is active, is
 * keyed to that battle (rematch resets it), and ages out after 30s if
 * the bot never confirms it (bot down / out-of-window gift). */
const PK_BUMP_MAX_AGE_MS = 30_000;
type PkBumpEntry = { battleKey: string; bumps: Array<{ uid: string; coins: number; at: number }> };
const pkBumpsByRoom = new Map<string, PkBumpEntry>();
const pkLastTotalsByRoom = new Map<string, { battleKey: string; totals: Record<string, number> }>();
const pkLastRawByRoom = new Map<string, RoomPk | null>();
const pkDeliverersByRoom = new Map<string, Set<(raw: RoomPk | null) => void>>();

function pkBattleKey(pk: RoomPk): string {
  return `${pk.startedAt}:${pk.endsAt}:${pk.challenger.uid}:${pk.opponent.uid}`;
}

function applyPkBumps(roomId: string, raw: RoomPk | null): RoomPk | null {
  if (!raw || raw.status !== 'active') {
    pkBumpsByRoom.delete(roomId);
    pkLastTotalsByRoom.delete(roomId);
    return raw;
  }
  const key = pkBattleKey(raw);
  const authTotals: Record<string, number> = { ...(raw.scores?.totals ?? {}) };
  const prev = pkLastTotalsByRoom.get(roomId);
  const entry = pkBumpsByRoom.get(roomId);
  // Reconcile: authoritative increases eat the same amount of bump
  // (one bump entry per uid — notePkGiftSent merges — so a single eat).
  if (prev && prev.battleKey === key && entry && entry.battleKey === key) {
    for (const uid of Object.keys(authTotals)) {
      const delta = (authTotals[uid] || 0) - (prev.totals[uid] || 0);
      if (delta <= 0) continue;
      const b = entry.bumps.find((x) => x.uid === uid);
      if (b) b.coins = Math.max(0, b.coins - delta);
    }
    entry.bumps = entry.bumps.filter((b) => b.coins > 0);
    if (entry.bumps.length === 0) pkBumpsByRoom.delete(roomId);
  }
  pkLastTotalsByRoom.set(roomId, { battleKey: key, totals: { ...authTotals } });
  if (!entry || entry.battleKey !== key) return raw;
  // Age out bumps the bot never confirmed (bot down / out-of-window).
  const now = Date.now();
  const live = entry.bumps.filter((b) => b.coins > 0 && now - b.at <= PK_BUMP_MAX_AGE_MS);
  if (live.length === 0) {
    pkBumpsByRoom.delete(roomId);
    return raw;
  }
  entry.bumps = live;
  const totals = { ...authTotals };
  for (const b of live) totals[b.uid] = (totals[b.uid] || 0) + b.coins;
  return { ...raw, scores: { ...(raw.scores ?? { totals: {} }), totals } };
}

/** Call after a gift to a battler has been charged + written to giftFeed
 * (GiftsModal onGiftSent — succeeded recipients only). The bot will score
 * it; this just makes the sender's own score move NOW. No-ops when no
 * battle is active, the recipient is not a battler, or the amount is 0. */
export function notePkGiftSent(roomId: string, toUid: string, coins: number): void {
  if (!roomId || !toUid || !(coins > 0)) return;
  const raw = pkLastRawByRoom.get(roomId);
  if (!raw || raw.status !== 'active') return;
  if (toUid !== raw.challenger.uid && toUid !== raw.opponent.uid) return;
  const key = pkBattleKey(raw);
  let entry = pkBumpsByRoom.get(roomId);
  if (!entry || entry.battleKey !== key) {
    entry = { battleKey: key, bumps: [] };
    pkBumpsByRoom.set(roomId, entry);
  }
  const now = Date.now();
  const existing = entry.bumps.find((b) => b.uid === toUid);
  if (existing) {
    existing.coins += coins;
    existing.at = now;
  } else {
    entry.bumps.push({ uid: toUid, coins, at: now });
  }
  // Re-deliver immediately so the banner/modal move on this frame.
  const deliverers = pkDeliverersByRoom.get(roomId);
  if (deliverers) {
    for (const deliver of [...deliverers]) deliver(raw);
  }
}

function pkRef(roomId: string) {
  return ref(database, `roomPk/${roomId}`);
}

/** Live PK state for a room (null when no PK).
 * Delivered totals include the sender's optimistic bumps (see
 * notePkGiftSent) — display-only, reconciled against authoritative
 * totals on every delivery. */
export function subscribeRoomPk(roomId: string, cb: (pk: RoomPk | null) => void): () => void {
  const deliver = (raw: RoomPk | null) => {
    cb(applyPkBumps(roomId, raw));
  };
  let deliverers = pkDeliverersByRoom.get(roomId);
  if (!deliverers) {
    deliverers = new Set();
    pkDeliverersByRoom.set(roomId, deliverers);
  }
  deliverers.add(deliver);
  const unsub = onValue(pkRef(roomId), (snap) => {
    if (!snap.exists()) {
      pkLastRawByRoom.set(roomId, null);
      deliver(null);
      return;
    }
    const v = snap.val() as any;
    if (!v || typeof v.status !== 'string' || !v.challenger || !v.opponent) {
      pkLastRawByRoom.set(roomId, null);
      deliver(null);
      return;
    }
    const raw: RoomPk = {
      status: v.status,
      challenger: v.challenger,
      opponent: v.opponent,
      createdAt: typeof v.createdAt === 'number' ? v.createdAt : 0,
      challengedAt: typeof v.challengedAt === 'number' ? v.challengedAt : 0,
      startedAt: typeof v.startedAt === 'number' ? v.startedAt : 0,
      endsAt: typeof v.endsAt === 'number' ? v.endsAt : 0,
      durationMs: typeof v.durationMs === 'number' ? v.durationMs : 0,
      scores: (v.scores as PkScores) || null,
      winnerUid: typeof v.winnerUid === 'string' ? v.winnerUid : null,
      draw: v.draw === true,
    };
    pkLastRawByRoom.set(roomId, raw);
    deliver(raw);
  });
  return () => {
    unsub();
    deliverers!.delete(deliver);
    if (deliverers!.size === 0) pkDeliverersByRoom.delete(roomId);
  };
}

/** Send a PK challenge (fails if a PK already exists — rules backstop).
 * durationMs is the host-chosen battle length (clamped 1–10 min). */
export async function challengeToPk(
  roomId: string,
  challenger: PkUser,
  opponent: PkUser,
  durationMs: number,
): Promise<void> {
  const now = Date.now();
  const dur = Math.min(PK_DURATION_MAX_MS, Math.max(PK_DURATION_MIN_MS, durationMs || PK_DURATION_MS));
  await update(pkRef(roomId), {
    status: 'challenge',
    challenger,
    opponent,
    createdAt: now,
    challengedAt: now,
    durationMs: dur,
  });
}

/** Opponent accepts: the battle starts for the host-chosen duration. */
export async function acceptPk(roomId: string): Promise<void> {
  const now = Date.now();
  const snap = await get(pkRef(roomId));
  const stored = snap.val()?.durationMs as number | undefined;
  const dur = Math.min(
    PK_DURATION_MAX_MS,
    Math.max(PK_DURATION_MIN_MS, typeof stored === 'number' && stored > 0 ? stored : PK_DURATION_MS),
  );
  await update(pkRef(roomId), {
    status: 'active',
    startedAt: now,
    endsAt: now + dur,
  });
}

/** Decline a challenge / cancel your own / owner-admin clear. */
export async function removePk(roomId: string): Promise<void> {
  await remove(pkRef(roomId));
}

/** Current signed-in user as a PK participant. */
export function myPkUser(myUid: string, myName: string): PkUser {
  return { uid: myUid, name: myName };
}

export function pkScoreOf(pk: RoomPk | null, uid: string): number {
  return pk?.scores?.totals?.[uid] ?? 0;
}

/** Top donor across both sides (bot-written donors map), or null. */
export function pkTopDonor(pk: RoomPk | null): PkDonor | null {
  const donors = pk?.scores?.donors;
  if (!donors) return null;
  let best: PkDonor | null = null;
  for (const uid of Object.keys(donors)) {
    const d = donors[uid];
    if (!d || typeof d.total !== 'number') continue;
    if (!best || d.total > best.total) {
      best = { uid, name: d.name || '', photoURL: d.photoURL ?? null, total: d.total };
    }
  }
  return best && best.total > 0 ? best : null;
}

/** Rematch: clear the ended node FIRST, then challenge the same pair.
 * Ordering matters — the one-PK-per-room rules backstop rejects a
 * challenge while the ended node still exists, so the remove must
 * complete before the challenge is written. */
export async function rematchPk(
  roomId: string,
  challenger: PkUser,
  opponent: PkUser,
  durationMs: number,
): Promise<void> {
  await removePk(roomId);
  await challengeToPk(roomId, challenger, opponent, durationMs);
}

/** Compact diamond count, matching the gift cards (1.2k / 1.5k). */
export function formatPkScore(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

/** Battle length label, e.g. 5 min (legacy nodes read as 5 min). */
export function formatPkDuration(pk: RoomPk | null): string {
  const ms = pk && pk.durationMs > 0 ? pk.durationMs : PK_DURATION_MS;
  return `${Math.round(ms / 60000)} min`;
}

export function currentUid(): string {
  return auth.currentUser?.uid ?? 'anonymous';
}
