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

import { ref, update, remove, onValue, onChildAdded, query, limitToLast, get } from 'firebase/database';
import { database, auth } from '@/src/config/firebase';
import type { PkResultPayload } from '@/src/features/chat/types/dm';

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

/* ── Live PK totals (2026-11-11, boss: PK realtime) ────────────────
 * The optimistic bump above only helps the SENDER's own gifts. Everyone
 * else's gifts still waited for wallet → giftFeed → VPS bot → RTDB
 * (2–5s, worse in a gift storm) — so the whole room watched a stale
 * score. The gift data ALREADY arrives on the client in realtime (the
 * room chat shows each gift the instant it lands), so the PK score now
 * uses the same stream: one shared `giftFeed` listener per room totals
 * `coins` per battler the moment a gift lands, for EVERY viewer.
 *   window: [startedAt - GRACE, endsAt + GRACE], exactly the bot's
 *     window (pk.cjs GRACE = 15s) — a gift counts iff its `ts` is in it.
 *     `ts` falls back to Date.now() when it is not yet a number (the
 *     sender's own not-yet-acked write still carries the server-
 *     timestamp placeholder); the bot uses 0 for the same case, so the
 *     live total can briefly exceed the bot's — see the max() rule.
 *   dedupe: by giftFeed push key (`scores.scored` is the same key on
 *     the bot) — a gift is never counted twice, and a re-attach burst
 *     replays the last 200 keys, which the seen-set skips.
 *   reconcile: display total = max(authoritative, live) per battler —
 *     never goes backwards when the bot's total arrives, and if the
 *     live feed misses a gift (joined mid-battle, initial-burst race,
 *     a gap gift) the authoritative total fills the gap.
 *   bump eat: the sender's own gift is in BOTH the optimistic bump AND
 *     the feed — when the feed entry arrives with fromUid === me, the
 *     bump for that battler is eaten by the same coins (clamped >= 0),
 *     so it is never double-counted. (Equivalent to key-dedupe here:
 *     the bump is a per-uid total of MY gifts only; others' gifts
 *     never touch it.)
 *   batching (heat gate): live-total deliveries are coalesced through
 *     requestAnimationFrame (setTimeout(0) fallback), so a gift storm
 *     caps re-renders at ~60fps — the totals accumulate between frames
 *     and flush once. A gift storm must never cause a re-render storm.
 *   instant result: when Date.now() >= endsAt while the battle is
 *     still 'active', the delivered snapshot flips to status 'ended'
 *     with the winner/draw computed from the DISPLAY totals — the
 *     result appears the instant the timer hits 0:00 instead of
 *     waiting ~20s for the bot (grace 15s + 5s poll). A single
 *     setTimeout to endsAt re-delivers at that moment (no interval).
 *     The bot's ended node (when it arrives) is authoritative for the
 *     declared winner — it replaces the live computation and locks the
 *     result. Rule: show the live result immediately, correct it if
 *     the bot disagrees. Live totals keep updating during the grace
 *     window, so a late gift can still flip the live winner before
 *     the bot locks it. Clients NEVER write scores (live rules deny
 *     it); the bot still owns scoring and the final result. */
const PK_GRACE_MS = 15_000; // same as the VPS bot's GRACE (C:\vee-pk-bot\pk.cjs)
const PK_GIFT_FEED_LIMIT = 200;
type PkLiveEntry = {
  battleKey: string;
  totals: Record<string, number>;
  seen: Set<string>;
  unsub: (() => void) | null;
  flushPending: boolean;
};
const pkLiveByRoom = new Map<string, PkLiveEntry>();
const pkEndTimerByRoom = new Map<string, { endsAt: number; timer: ReturnType<typeof setTimeout> }>();

function clearPkEndTimer(roomId: string): void {
  const e = pkEndTimerByRoom.get(roomId);
  if (e) {
    clearTimeout(e.timer);
    pkEndTimerByRoom.delete(roomId);
  }
}

function schedulePkEnd(roomId: string, endsAt: number): void {
  const existing = pkEndTimerByRoom.get(roomId);
  if (existing && existing.endsAt === endsAt) return; // already armed for this battle
  clearPkEndTimer(roomId);
  const delay = Math.max(0, endsAt - Date.now());
  const timer = setTimeout(() => {
    pkEndTimerByRoom.delete(roomId);
    redeliverPk(roomId);
  }, delay);
  pkEndTimerByRoom.set(roomId, { endsAt, timer });
}

function clearPkLiveTotals(roomId: string): void {
  const live = pkLiveByRoom.get(roomId);
  if (live) {
    live.battleKey = '';
    live.totals = {};
    live.seen = new Set();
    live.flushPending = false;
  }
}

/** Re-deliver the last known raw PK to every subscriber (after a live
 * giftFeed change or the endsAt timeout). */
function redeliverPk(roomId: string): void {
  const raw = pkLastRawByRoom.get(roomId);
  if (raw === undefined) return;
  const deliverers = pkDeliverersByRoom.get(roomId);
  if (!deliverers) return;
  for (const deliver of [...deliverers]) deliver(raw);
}

/** Coalesce re-delivers through one animation frame (gift-storm guard). */
function schedulePkDeliver(roomId: string): void {
  const live = pkLiveByRoom.get(roomId);
  if (!live) return;
  if (live.flushPending) return;
  live.flushPending = true;
  const flush = () => {
    live.flushPending = false;
    redeliverPk(roomId);
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(flush);
  } else {
    setTimeout(flush, 0);
  }
}

/** One giftFeed entry: count it into the live totals if it belongs to
 * this battle (battler + window), idempotent by push key. */
function onPkGiftFeedChild(roomId: string, giftKey: string, g: any): void {
  const raw = pkLastRawByRoom.get(roomId);
  if (!raw || raw.status !== 'active') return;
  const toUid = typeof g?.toUid === 'string' ? g.toUid : '';
  if (toUid !== raw.challenger.uid && toUid !== raw.opponent.uid) return;
  const coins = typeof g?.coins === 'number' && g.coins > 0 ? Math.floor(g.coins) : 0;
  if (coins <= 0) return;
  const key = pkBattleKey(raw);
  let live = pkLiveByRoom.get(roomId);
  if (!live || live.battleKey !== key) {
    const unsub = live?.unsub ?? null;
    live = { battleKey: key, totals: {}, seen: new Set(), unsub, flushPending: false };
    pkLiveByRoom.set(roomId, live);
  }
  if (live.seen.has(giftKey)) return; // already counted — never double-count
  const ts = typeof g?.ts === 'number' ? g.ts : Date.now();
  if (ts < raw.startedAt - PK_GRACE_MS || ts > raw.endsAt + PK_GRACE_MS) return;
  live.seen.add(giftKey);
  live.totals[toUid] = (live.totals[toUid] || 0) + coins;
  // My own gift is in BOTH the optimistic bump and the feed — eat the
  // bump by the same coins so it is never double-counted.
  if (typeof g?.fromUid === 'string' && g.fromUid === currentUid()) {
    const entry = pkBumpsByRoom.get(roomId);
    if (entry && entry.battleKey === key) {
      const b = entry.bumps.find((x) => x.uid === toUid);
      if (b) b.coins = Math.max(0, b.coins - coins);
      entry.bumps = entry.bumps.filter((x) => x.coins > 0);
      if (entry.bumps.length === 0) pkBumpsByRoom.delete(roomId);
    }
  }
  schedulePkDeliver(roomId);
}

function attachPkGiftFeed(roomId: string): void {
  if (pkLiveByRoom.get(roomId)?.unsub) return;
  const q = query(ref(database, `rooms/${roomId}/giftFeed`), limitToLast(PK_GIFT_FEED_LIMIT));
  const unsub = onChildAdded(q, (snap) => {
    onPkGiftFeedChild(roomId, snap.key ?? '', snap.val());
  });
  const live = pkLiveByRoom.get(roomId);
  if (!live) {
    pkLiveByRoom.set(roomId, { battleKey: '', totals: {}, seen: new Set(), unsub, flushPending: false });
  } else {
    live.unsub = unsub;
  }
}

function detachPkGiftFeed(roomId: string): void {
  const live = pkLiveByRoom.get(roomId);
  if (live?.unsub) live.unsub();
  pkLiveByRoom.delete(roomId);
}

function computeDisplayPk(roomId: string, raw: RoomPk | null): RoomPk | null {
  if (!raw) {
    pkBumpsByRoom.delete(roomId);
    pkLastTotalsByRoom.delete(roomId);
    clearPkLiveTotals(roomId);
    clearPkEndTimer(roomId);
    return null;
  }
  if (raw.status === 'challenge') {
    pkBumpsByRoom.delete(roomId);
    pkLastTotalsByRoom.delete(roomId);
    clearPkEndTimer(roomId);
    return raw;
  }
  if (raw.status === 'ended') {
    // Bot is authoritative for the winner/draw — but the displayed
    // scores never go backwards: max(bot totals, live totals).
    const live = pkLiveByRoom.get(roomId);
    const key = pkBattleKey(raw);
    const totals = { ...(raw.scores?.totals ?? {}) };
    if (live && live.battleKey === key) {
      for (const uid of Object.keys(live.totals)) {
        totals[uid] = Math.max(totals[uid] || 0, live.totals[uid] || 0);
      }
    }
    clearPkEndTimer(roomId);
    pkBumpsByRoom.delete(roomId);
    pkLastTotalsByRoom.delete(roomId);
    return { ...raw, scores: { ...(raw.scores ?? { totals: {} }), totals } };
  }
  // Active battle: display = max(authoritative, live) + optimistic bump.
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
  const totals = { ...authTotals };
  const live = pkLiveByRoom.get(roomId);
  if (live && live.battleKey === key) {
    for (const uid of Object.keys(live.totals)) {
      totals[uid] = Math.max(totals[uid] || 0, live.totals[uid] || 0);
    }
  }
  const bumpEntry = pkBumpsByRoom.get(roomId);
  if (bumpEntry && bumpEntry.battleKey === key) {
    // Age out bumps the bot never confirmed (bot down / out-of-window).
    const now = Date.now();
    const liveBumps = bumpEntry.bumps.filter((b) => b.coins > 0 && now - b.at <= PK_BUMP_MAX_AGE_MS);
    if (liveBumps.length === 0) {
      pkBumpsByRoom.delete(roomId);
    } else {
      bumpEntry.bumps = liveBumps;
      for (const b of liveBumps) totals[b.uid] = (totals[b.uid] || 0) + b.coins;
    }
  }
  const display: RoomPk = {
    ...raw,
    scores: { ...(raw.scores ?? { totals: {} }), totals },
  };
  // Instant result: the clock has passed endsAt — deliver the battle as
  // ended NOW from the display totals instead of waiting ~20s for the
  // bot (grace 15s + 5s poll). The bot's ended node, when it arrives,
  // replaces this and locks the declared winner.
  if (Date.now() >= raw.endsAt) {
    const c = totals[raw.challenger.uid] || 0;
    const o = totals[raw.opponent.uid] || 0;
    return {
      ...display,
      status: 'ended',
      winnerUid: c === o ? null : c > o ? raw.challenger.uid : raw.opponent.uid,
      draw: c === o,
    };
  }
  schedulePkEnd(roomId, raw.endsAt);
  return display;
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
 * Delivered totals are the DISPLAY totals — max(authoritative bot
 * total, live giftFeed total) + the sender's optimistic bump, reconciled
 * on every delivery so they never go backwards. When the clock passes
 * endsAt while the battle is still 'active', the delivered snapshot is
 * locally 'ended' (winner/draw from the display totals) so the result
 * appears instantly; the bot's ended node replaces it when it arrives. */
export function subscribeRoomPk(roomId: string, cb: (pk: RoomPk | null) => void): () => void {
  const deliver = (raw: RoomPk | null) => {
    cb(computeDisplayPk(roomId, raw));
  };
  let deliverers = pkDeliverersByRoom.get(roomId);
  if (!deliverers) {
    deliverers = new Set();
    pkDeliverersByRoom.set(roomId, deliverers);
  }
  deliverers.add(deliver);
  // One shared giftFeed listener per room (all subscribers share it) —
  // it feeds the live totals that make every gift count instantly.
  attachPkGiftFeed(roomId);
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
    if (deliverers!.size === 0) {
      pkDeliverersByRoom.delete(roomId);
      detachPkGiftFeed(roomId);
      clearPkEndTimer(roomId);
      pkBumpsByRoom.delete(roomId);
      pkLastTotalsByRoom.delete(roomId);
    }
  };
}

/** Host-only rule (2026-11-11, boss): a PK can only be set WITH the Host —
 * one of the two participants must be the Host (the person on the Host
 * seat, seat 0; `hostUid` is seats[0]?.id ?? ownerId, computed by the
 * caller from live room state). The Host may challenge anyone; anyone may
 * challenge the Host; two non-host users may never PK. Rejects (throws
 * PK_HOST_ONLY_ERROR) when neither participant is the Host — the caller
 * shows the host-only message. The old 2026-10-25 peer-PK rule (any seated
 * user could challenge any seated user) is SUPERSEDED by this rule. */
export const PK_HOST_ONLY_ERROR = 'PK_HOST_ONLY';

/** True when the Host is one of the two PK participants. */
export function isHostParticipant(challengerUid: string, opponentUid: string, hostUid: string): boolean {
  return hostUid !== '' && (challengerUid === hostUid || opponentUid === hostUid);
}

/** Send a PK challenge (fails if a PK already exists — rules backstop).
 * durationMs is the host-chosen battle length (clamped 1–10 min).
 * `hostUid` is REQUIRED (fail-closed): the challenge is rejected unless
 * the Host is one of the two participants. */
export async function challengeToPk(
  roomId: string,
  challenger: PkUser,
  opponent: PkUser,
  durationMs: number,
  hostUid: string,
): Promise<void> {
  if (!isHostParticipant(challenger.uid, opponent.uid, hostUid)) {
    throw new Error(PK_HOST_ONLY_ERROR);
  }
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

/** Opponent accepts: the battle starts for the host-chosen duration.
 * `hostUid` is REQUIRED (fail-closed, same host-only rule): if neither
 * participant is the Host anymore (the Host left/changed while the
 * challenge was pending), the stale challenge is CANCELLED (removed) and
 * the accept is rejected with PK_HOST_ONLY_ERROR. Also rejects when the
 * node is missing or no longer a pending challenge. */
export async function acceptPk(roomId: string, hostUid: string): Promise<void> {
  const now = Date.now();
  const snap = await get(pkRef(roomId));
  const v = snap.val();
  if (!v || v.status !== 'challenge' || !v.challenger || !v.opponent) {
    throw new Error('PK_NOT_PENDING');
  }
  if (!isHostParticipant(v.challenger.uid, v.opponent.uid, hostUid)) {
    await remove(pkRef(roomId));
    throw new Error(PK_HOST_ONLY_ERROR);
  }
  const stored = v.durationMs as number | undefined;
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

/** Margin — by how many diamonds the winner beat the loser (0 = draw). */
export function pkMarginOf(pk: RoomPk | null): number {
  if (!pk) return 0;
  return Math.abs(pkScoreOf(pk, pk.challenger.uid) - pkScoreOf(pk, pk.opponent.uid));
}

/** Full-number format with separators, e.g. 753,500 (for the margin row). */
export function formatPkFull(n: number): string {
  return Math.floor(n).toLocaleString('en-US');
}

/** The PK result as a shareable text message — winner, scores, margin,
 * top donor, room. Used by the result popup's Share sheet (inbox + system
 * share) so the outcome travels with the message, never a bare link. */
export function formatPkResultMessage(pk: RoomPk | null, roomName?: string): string {
  if (!pk) return '';
  const c = pkScoreOf(pk, pk.challenger.uid);
  const o = pkScoreOf(pk, pk.opponent.uid);
  const where = roomName ? ` — ${roomName}` : '';
  const scoreLine = `${pk.challenger.name} ${formatPkScore(c)} vs ${formatPkScore(o)} ${pk.opponent.name}`;
  const donor = pkTopDonor(pk);
  const donorLine = donor ? `\nTop donor: ${donor.name} (${formatPkScore(donor.total)})` : '';
  if (pk.draw) {
    return `PK Result${where}\n${scoreLine}\nIt's a draw!${donorLine}`;
  }
  const winnerName = pk.winnerUid === pk.challenger.uid ? pk.challenger.name : pk.opponent.name;
  const margin = Math.abs(c - o);
  return `PK Result${where}\n${winnerName} won! ${scoreLine}\nMargin: ${formatPkFull(margin)} diamonds${donorLine}`;
}

/** Build the PK result card payload for the inbox share — winner,
 * scores, margin, top donor, room, battle length, and the battlers'
 * photos (resolved by the caller via usePkBattlerPhotos: seat photo,
 * else users/{uid}/photoURL). Pure function; scoring untouched (the VPS
 * bot stays authoritative). Returns null when there is no PK. */
export function buildPkResultPayload(
  pk: RoomPk | null,
  roomName: string | undefined,
  challengerPhotoURL: string | null | undefined,
  opponentPhotoURL: string | null | undefined,
): PkResultPayload | null {
  if (!pk) return null;
  const donor = pkTopDonor(pk);
  return {
    challenger: { uid: pk.challenger.uid, name: pk.challenger.name, photoURL: challengerPhotoURL ?? null },
    opponent: { uid: pk.opponent.uid, name: pk.opponent.name, photoURL: opponentPhotoURL ?? null },
    challengerScore: pkScoreOf(pk, pk.challenger.uid),
    opponentScore: pkScoreOf(pk, pk.opponent.uid),
    winnerUid: pk.draw ? null : pk.winnerUid,
    draw: pk.draw === true,
    margin: pkMarginOf(pk),
    topDonor: donor ? { uid: donor.uid, name: donor.name, photoURL: donor.photoURL ?? null, total: donor.total } : null,
    roomName: roomName || undefined,
    durationLabel: formatPkDuration(pk),
    endedAt: Date.now(),
  };
}

/** Rematch: clear the ended node FIRST, then challenge the same pair.
 * Ordering matters — the one-PK-per-room rules backstop rejects a
 * challenge while the ended node still exists, so the remove must
 * complete before the challenge is written. The host-only rule applies
 * here too (`hostUid` is passed through to challengeToPk): a rematch
 * whose pair no longer includes the Host is rejected. */
export async function rematchPk(
  roomId: string,
  challenger: PkUser,
  opponent: PkUser,
  durationMs: number,
  hostUid: string,
): Promise<void> {
  await removePk(roomId);
  await challengeToPk(roomId, challenger, opponent, durationMs, hostUid);
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
