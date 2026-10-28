/**
 * Wallet Service — Firebase Realtime Database (reads) + VPS services (writes)
 *
 * Server contracts (api-server, /api prefix via authedFetch):
 *   POST /api/wallet/init       → { ok, balance, created }
 *     (uid is derived from the ID token — always inits the caller's own wallet)
 *   GET  /api/wallet/balance    → { balance }
 * Server contracts (dedicated wallet service, /wallet prefix via
 * authedWalletFetch — exposed publicly only through the Caddy /wallet/*
 * route; the service itself is loopback-only on the VPS):
 *   POST /wallet/gift/send      → { ok, newBalance, price, ... }
 *     body: { toUid, giftId, idempotencyKey } — NO client price; the
 *     service looks the price up from gift_catalog server-side.
 *     200 business outcomes: applied, replayed, insufficient,
 *     unknown_gift, self_gift_denied. 400 malformed, 401 bad token,
 *     429 rate limit, 5xx server faults only.
 *   GET  /wallet/gift/status?idempotencyKey=… → { landed, newBalance }
 *     (sender-scoped: only the caller's own rows are ever reported)
 * Auth: Authorization: Bearer <firebase id token>, base URL from
 * getApiBase() in src/utils/platform.ts.
 *
 * RTDB paths (read-only from the client):
 *   wallets/{uid}/balance          → number  (diamonds available to spend)
 *   wallets/{uid}/weeklyEarned     → number  (diamonds earned this week from gifts received)
 *   wallets/{uid}/weekStart        → number  (timestamp of current week start)
 *   wallets/{uid}/transactions/{id} → WalletTransaction
 *
 * SECURITY: balance/weeklyEarned/transactions can no longer be written
 * directly by the client — Firebase rules reject those writes outright.
 * All mutations go through VPS services that verify the caller's Firebase
 * ID token server-side. Gift sends go to the dedicated wallet service
 * (Postgres ledger, one tx per gift) — NEVER to Firebase directly.
 * The old Firebase-direct gift fallback was DELETED 2026-10-29: it broke
 * the one-writer law by design (Postgres vs Firebase balances diverged
 * on every gift-active wallet). This prevents a client from ever setting
 * its own balance.
 */

import * as Crypto from 'expo-crypto';
import { ref, get, onValue, query, orderByKey, limitToLast, runTransaction } from 'firebase/database';
import { database, auth } from '@/src/config/firebase';
import { getApiBase } from '@/src/utils/platform';

async function authedFetch(
  path: string,
  opts?: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number },
): Promise<Response> {
  const user = auth.currentUser;
  if (!user) throw new GiftError('Not signed in');
  // 2026-10-18 (Sumon): FIX first-attempt "Wallet access denied".
  // getIdToken() returns the CACHED token which may be expired — the VPS
  // rejects it (401), the user sees an error, and only the SECOND attempt
  // (after the SDK auto-refreshes) succeeds. Retry once with a forced
  // refresh on 401/403 so the FIRST attempt works.
  // 2026-10-21 (boss: gift sends felt slow): optional hard timeout — a hung
  // api-server must never stall the caller; on abort the fetch throws and
  // the caller's fallback path takes over, same as a network failure.
  const doFetch = async (forceRefresh: boolean): Promise<Response> => {
    const idToken = await user.getIdToken(forceRefresh);
    // 2026-10-26 (weak network): default 15s bound — callers that pass no
    // timeout used to hang until the OS gave up (minutes). Explicit
    // timeouts (gift send: 6s) are untouched; no retry change here —
    // money mutations keep the landed-guard pattern, never blind retry.
    const timeoutMs = opts?.timeoutMs ?? 15000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(`${getApiBase()}/api${path}`, {
        method: opts?.method ?? 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
  let res = await doFetch(false);
  if (res.status === 401 || res.status === 403) {
    // Token was stale — force refresh and retry once
    try {
      res = await doFetch(true);
    } catch {
      // Retry failed — return the original 401/403 response
    }
  }
  return res;
}

async function authedWalletFetch(
  path: string,
  opts?: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number },
): Promise<Response> {
  // 2026-10-29 (gift routing): same ID-token auth + 401-refresh retry as
  // authedFetch, but against the DEDICATED wallet service (Caddy /wallet/*
  // route) instead of the :3001 api-server (/api prefix). The wallet
  // service must never share the general API's deploy/failure blast radius.
  const user = auth.currentUser;
  if (!user) throw new GiftError('Not signed in');
  const doFetch = async (forceRefresh: boolean): Promise<Response> => {
    const idToken = await user.getIdToken(forceRefresh);
    const timeoutMs = opts?.timeoutMs ?? 15000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(`${getApiBase()}${path}`, {
        method: opts?.method ?? 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
  let res = await doFetch(false);
  if (res.status === 401 || res.status === 403) {
    try {
      res = await doFetch(true);
    } catch {
      // Retry failed — return the original 401/403 response
    }
  }
  return res;
}

/* ─── Types ─────────────────────────────────────────────────────────────── */

export type WalletTransaction = {
  id: string;
  // FIX (2026-10-10): 'recharge' = diamond top-up. Wallet screen shows ONLY
  // recharges; gift_sent/gift_received are shown on the Profile gift history.
  type: 'gift_sent' | 'gift_received' | 'recharge';
  /** Gift catalog id ('1'–'8') — written by the api-server for gift transactions */
  giftId: string;
  /** Negative for sent, positive for received/recharge */
  diamonds: number;
  emoji: string;
  giftName: string;
  counterpartUid: string;
  counterpartName: string;
  roomId: string | null;
  ts: number;
};

/**
 * Record a diamond recharge (top-up) transaction in the user's wallet history.
 * Called after a successful top-up. The wallet screen shows ONLY these.
 * FIX (2026-10-10): Sumon's order — gift transactions must not appear in the
 * wallet history; they live on the Profile gift history section instead.
 */
export async function recordRechargeTransaction(
  diamonds: number,
  newBalance: number,
): Promise<void> {
  const { auth } = await import('@/src/config/firebase');
  const { ref, push, set } = await import('firebase/database');
  const { database } = await import('@/src/config/firebase');
  const uid = auth.currentUser?.uid;
  if (!uid || !diamonds || diamonds <= 0) return;
  try {
    const txRef = push(ref(database, `wallets/${uid}/transactions`));
    await set(txRef, {
      type: 'recharge',
      giftId: '',
      diamonds,
      emoji: '💎',
      giftName: 'Diamond Recharge',
      counterpartUid: '',
      counterpartName: '',
      roomId: null,
      newBalance,
      // P0-2 (2026-10-12): must be `timestamp` — the rules require it and
      // `ts` was silently rejected, so recharge history was never recorded.
      timestamp: Date.now(),
    });
  } catch {
    // non-critical — balance was already credited by the server
  }
}

/* ─── Gift errors ───────────────────────────────────────────────────────── */

/** Base class for all gift-send failures — never swallowed by callers. */
export class GiftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GiftError';
  }
}

/** Server reported the sender can't afford this gift (HTTP 400). */
export class InsufficientFundsError extends GiftError {
  constructor(message = 'Insufficient diamonds') {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

/** The request failed before reaching the server, or the response was unusable. */
export class NetworkError extends GiftError {
  constructor(message = 'Network request failed') {
    super(message);
    this.name = 'NetworkError';
  }
}

/** Client-side guard: the sender tried to gift themselves. */
export class SelfGiftError extends GiftError {
  constructor(message = 'You cannot send a gift to yourself') {
    super(message);
    this.name = 'SelfGiftError';
  }
}

export type SendGiftArgs = {
  /** Recipient's uid (one recipient per call) */
  toUid: string;
  /** Gift catalog id, e.g. '1'–'8' */
  giftId: string;
  /**
   * Idempotency key for this (recipient, gift) attempt. The caller MUST
   * generate it up-front and reuse the SAME key across retries of the same
   * send action, so a retried network request can never charge twice.
   * Defaults to a fresh UUID when omitted.
   */
  idempotencyKey?: string;
  /** Recipient's display name (for the weekly leaderboard; optional) */
  toName?: string;
  /** Recipient's photo URL (for the weekly leaderboard; optional) */
  toPhotoURL?: string;
  /** Price in diamonds the user saw (from server catalog) — used ONLY
   * for local bookkeeping; the wallet service looks up the authoritative
   * price server-side and never accepts this value. */
  price?: number;
  /** Room the gift was sent in (for the weekly Top Rooms board; optional) */
  roomId?: string;
  /**
   * Builder D (2026-10-26): true ONLY when the gift was sent from a voice
   * room while the sender was seated. Threaded from the gift caller
   * (GiftsModal); game modals and other callers pass nothing, which means
   * no couple hearts. Gates bumpCoupleHeartsForGift — never inferred here.
   */
  seatedSender?: boolean;
};

export type SendGiftResult = {
  ok: true;
  /** Sender's balance after the charge */
  newBalance: number;
  /** Server-side receipt payload (opaque to the client) */
  receipt: unknown;
};

/* ─── Public API ─────────────────────────────────────────────────────────── */

/**
 * Initialize a wallet for a new user (500 free diamonds on first signup).
 * Idempotent — the server checks before writing. Must be called while the
 * caller is signed in as `uid` (the server derives uid from the ID token,
 * so this always inits the *caller's own* wallet).
 *
 * Errors are swallowed: wallet init is non-critical (lazy-init retries it).
 */
export async function initializeWallet(uid: string): Promise<void> {
  if (auth.currentUser?.uid !== uid) return;
  try {
    await authedFetch('/wallet/init', { method: 'POST' });
  } catch {
    // Non-critical: wallet may already be initialized; ignore all errors.
  }
}

/** One-shot read of the current diamond balance (own wallet, via api-server). */
export async function getBalance(): Promise<number> {
  let res: Response;
  try {
    res = await authedFetch('/wallet/balance', { method: 'GET' });
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : 'Balance request failed');
  }
  if (!res.ok) throw new NetworkError(`Balance request failed (HTTP ${res.status})`);
  const data = (await res.json().catch(() => ({}))) as { balance?: number };
  if (typeof data.balance !== 'number') throw new NetworkError('Invalid balance response');
  return data.balance;
}

/** One-shot read of the current diamond balance (own wallet, via RTDB). */
export async function getWalletBalance(uid: string): Promise<number> {
  const snap = await get(ref(database, `wallets/${uid}/balance`));
  if (!snap.exists()) return 0;
  const val = snap.val();
  // FIX (2026-10-09): Coerce string balances — prevents false "insufficient"
  // when the wallet was written as a string.
  return typeof val === "number" ? val : (typeof val === "string" ? parseFloat(val) || 0 : 0);
}

/**
 * Subscribe to real-time wallet balance.
 * Returns an unsubscribe function.
 * Automatically initialises the wallet to 500 diamonds on first subscription
 * if no wallet exists yet.
 */
export function subscribeWalletBalance(
  uid: string,
  callback: (balance: number) => void,
): () => void {
  const balRef = ref(database, `wallets/${uid}/balance`);
  const unsub = onValue(
    balRef,
    async (snap) => {
      if (!snap.exists()) {
        // Lazy-init: give 500 diamonds on first touch (server-side).
        // FIX (2026-10-06): Do NOT optimistically callback(500) before init
        // succeeds — that showed a "phantom 500" when init failed.
        // Instead, await init; the onValue listener will fire again with the
        // real value once the wallet is created. If init fails, report 0
        // (the true state) rather than a phantom balance.
        try {
          await initializeWallet(uid);
          // Init succeeded — onValue will fire again with the real 500.
          // Do not callback here; wait for the authoritative snapshot.
        } catch {
          // Init failed — report 0 (true state), not phantom 500.
          callback(0);
        }
      } else {
        // FIX (2026-10-10): Coerce string balances.
        const val = snap.val();
        callback(typeof val === "number" ? val : (typeof val === "string" ? parseFloat(val) || 0 : 0));
      }
    },
    () => callback(0),
  );
  return unsub;
}

/**
 * Send a gift to ONE recipient. The sender's balance is deducted and the
 * recipient credited entirely server-side (api-server /wallet/send-gift,
 * using the Admin SDK) — the client never writes balance/weeklyEarned directly.
 *
 * Throws (never returns a failure result — callers must NOT swallow):
 *   SelfGiftError          — toUid is the sender's own uid (client-side guard)
 *   InsufficientFundsError — server answered 400 (not enough diamonds)
 *   NetworkError           — fetch threw/timed out, or the response was unusable
 *   GiftError              — any other server-side failure
 *
 * Idempotency: pass a caller-generated `idempotencyKey` and reuse it across
 * retries of the same send action. Retrying with the same key is safe — the
 * server will not charge twice.
 */

/**
 * GIFT FALLBACK (2026-10-10, hardened v2): Direct Firebase gift transaction.
 * Used when the VPS api-server fails for ANY reason (network error, 5xx, 400,
 * stale/outdated server code). Previously it only triggered on 400s containing
 * "insufficient" — too narrow, so most real failures never fell back.
 *
 * Safety design:
 * - Idempotent per idempotencyKey: a giftFallbackTx record is claimed BEFORE
 *   debiting; a retry with the same key returns the stored result instead of
 *   charging again.
 * - The 202 "still processing" server response is NEVER fallen back on — the
 *   server may still complete the charge, and a fallback would double-debit.
 * - Balance coercion: string balances are parsed (matches the server fix).
 * - Recipient wallets are created when missing (rules allow creating a
 *   balance with exactly a gift price).
 * - Firebase rules constrain abuse: own balance can only DECREASE by a gift
 *   price; other balances can only INCREASE by a gift price.
 *
 * Gift prices: 1=10, 2=25, 3=50, 4=100, 5=200, 6=500, 7=1000, 8=2000
 */
/** Gift catalog prices (diamonds). Module-level so sendGift() bookkeeping
 * (noble/level XP, leaderboards) can resolve the price when the server
 * response carries none (probe-landed path). The wallet service's price
 * is authoritative — this map is only a bookkeeping fallback, never a
 * charge amount. (P1-1, 2026-10-12: Noble XP must accrue on the server
 * gift path too). */
// 2026-10-16 (Sumon): Premium + Luxury gifts added
const GIFT_PRICES: Record<string, number> = {
  '1': 10, '2': 25, '3': 50, '4': 100,
  '5': 200, '6': 500, '7': 1000, '8': 2000,
  // Premium
  '9': 5000, '10': 10000, '11': 25000, '12': 50000, '13': 75000, '14': 100000,
  // Luxury
  '15': 200000, '16': 500000, '17': 1000000, '18': 2000000,
};

/**
 * Weekly leaderboard stats (2026-10-15, Sumon) — makes the Leaderboard's
 * Top Senders / Top Receivers tabs REAL.
 *
 * Best-effort: called after a gift succeeds on EITHER path (VPS primary or
 * Firebase fallback). Writes per-ISO-week buckets so rankings reset
 * automatically every week — no reset job needed.
 *   leaderboard_senders/{weekId}/{fromUid} = { name, photoURL?, weeklySent }
 *   leaderboard/{weekId}/{toUid}           = { name, photoURL?, weeklyEarned }
 *
 * Self-gifts are excluded (anti-farming, mirrors Noble XP). The database
 * rules constrain each write's delta to a valid gift amount, so stats can
 * only grow by real gift-sized increments.
 */
export async function recordWeeklyLeaderboardStats(args: {
  fromUid: string;
  toUid: string;
  price: number;
  recipientAmount: number;
  senderName?: string | null;
  senderPhotoURL?: string | null;
  receiverName?: string | null;
  receiverPhotoURL?: string | null;
}): Promise<void> {
  const { fromUid, toUid, price, recipientAmount } = args;
  if (!fromUid || !toUid || fromUid === toUid) return;
  if (!(price > 0) || !(recipientAmount > 0)) return;
  try {
    const { getCurrentWeekId } = await import('@/src/utils/weekId');
    const { ref, update, increment, runTransaction } = await import('firebase/database');
    const { database } = await import('@/src/config/firebase');
    const weekId = getCurrentWeekId();
    const sBase = `leaderboard_senders/${weekId}/${fromUid}`;
    const rBase = `leaderboard/${weekId}/${toUid}`;
    // 2026-10-20 FIX (boss: leaderboard must be REAL + realtime): the old
    // ensureIdentity created the node as { name } ONLY — no counter. The
    // database rules compute the counter delta as new − old, and with the
    // old counter MISSING the expression errors → the increment write was
    // DENIED forever, so live gifts NEVER landed on the boards (only
    // server-side backfill data ever showed). ensureNode now guarantees the
    // node exists WITH its counter field (initialised to 0 when missing),
    // still without overwriting an existing name/photo or counter: the
    // sender's cached copy of the receiver's identity may be stale, so
    // identity fields are only filled when absent.
    const ensureNode = (
      base: string,
      counterKey: 'weeklySent' | 'weeklyEarned',
      name?: string | null,
      photoURL?: string | null,
    ) =>
      runTransaction(ref(database, base), (cur) => {
        const existing = (cur ?? null) as Record<string, unknown> | null;
        if (
          existing &&
          typeof existing.name === 'string' &&
          typeof existing[counterKey] === 'number'
        ) {
          return; // node complete — never overwrite identity or counter
        }
        const v: Record<string, unknown> = { ...(existing ?? {}) };
        if (typeof v.name !== 'string' || !v.name) v.name = name || 'Vee User';
        if (photoURL && typeof v.photoURL !== 'string') v.photoURL = photoURL;
        if (typeof v[counterKey] !== 'number') v[counterKey] = 0;
        return v;
      }).catch(() => {});
    await Promise.all([
      ensureNode(sBase, 'weeklySent', args.senderName, args.senderPhotoURL),
      ensureNode(rBase, 'weeklyEarned', args.receiverName, args.receiverPhotoURL),
    ]);
    // 2026-10-20 FIX: the two increments used to ride in ONE atomic root
    // update() — a rules denial on either side (e.g. an obsolete delta cap)
    // silently killed BOTH stats. They are independent writes now, each
    // with its own failure boundary.
    try {
      await update(ref(database), { [`${sBase}/weeklySent`]: increment(price) });
    } catch { /* best-effort — gift already succeeded */ }
    try {
      await update(ref(database), { [`${rBase}/weeklyEarned`]: increment(recipientAmount) });
    } catch { /* best-effort — gift already succeeded */ }
  } catch {
    // Best-effort — the gift already succeeded; leaderboard stats are non-critical.
  }
}

/**
 * Weekly Top Rooms stat — 2026-10-21 (boss's choice: "Top Rooms weekly
 * gift দিয়ে বানাও"). Every gift sent inside a room adds its full price to
 * the room's weekly total:
 *   leaderboard_rooms/{weekId}/{roomId} = { weeklyReceived }
 * Unlike the user boards, SELF-gifts DO count here: the room board
 * measures room activity, and a self-gift still burns the platform
 * commission, so it cannot be farmed for free. Best-effort, fire-and-
 * forget — a failed stat write never touches the completed gift.
 */
export async function recordWeeklyRoomGiftStat(args: {
  roomId: string;
  price: number;
}): Promise<void> {
  const { roomId, price } = args;
  if (!roomId || !(price > 0)) return;
  try {
    const { getCurrentWeekId } = await import('@/src/utils/weekId');
    const { ref, update, increment, runTransaction } = await import('firebase/database');
    const { database } = await import('@/src/config/firebase');
    const weekId = getCurrentWeekId();
    const base = `leaderboard_rooms/${weekId}/${roomId}`;
    // Same ensure-then-increment discipline as the user boards: the rules
    // compute the delta against the existing counter, so the node must
    // exist WITH its counter (initialised to 0) before the increment.
    await runTransaction(ref(database, base), (cur) => {
      const existing = (cur ?? null) as Record<string, unknown> | null;
      if (existing && typeof existing.weeklyReceived === 'number') return;
      const v: Record<string, unknown> = { ...(existing ?? {}) };
      if (typeof v.weeklyReceived !== 'number') v.weeklyReceived = 0;
      return v;
    }).catch(() => {});
    try {
      await update(ref(database), { [`${base}/weeklyReceived`]: increment(price) });
    } catch { /* best-effort — gift already succeeded */ }
  } catch {
    // Best-effort — the gift already succeeded; room stats are non-critical.
  }
}

/**
 * 2026-10-15 (Sumon): PERMANENT gift count aggregate — lifetime per-gift
 * received counts at wallets/{uid}/giftCounts/{giftId}. Incremented via
 * transaction on EVERY gift received (both VPS primary and Firebase fallback
 * paths; self-gifts excluded). The Gift Display screen reads this (not the
 * 50-transaction history limit), so counts stay accurate forever — even with
 * crores of gifts.
 */
export async function recordGiftReceivedCount(toUid: string, giftId: string): Promise<void> {
  if (!toUid || !giftId) return;
  try {
    const { runTransaction } = await import('firebase/database');
    const countRef = ref(database, `wallets/${toUid}/giftCounts/${giftId}`);
    await runTransaction(countRef, (cur) => {
      const n = typeof cur === 'number' ? cur : 0;
      return n + 1;
    });
  } catch {
    // Non-critical — gift already completed; count syncs on next gift.
  }
}

/** Subscribe to lifetime gift counts (for Gift Display screen). */
export function subscribeGiftCounts(
  uid: string,
  callback: (counts: Record<string, number>) => void,
): () => void {
  const countsRef = ref(database, `wallets/${uid}/giftCounts`);
  return onValue(countsRef, (snap) => {
    const counts: Record<string, number> = {};
    if (snap.exists()) {
      snap.forEach((child) => {
        const n = child.val();
        if (typeof n === 'number' && n > 0) counts[child.key as string] = n;
      });
    }
    callback(counts);
  }, () => {
    callback({});
  });
}

/* ── 2026-10-16 (Sumon): Heal gift counts from transaction history ──
 * Ensures wallets/{uid}/giftCounts is the PERMANENT server source of truth.
 * Backfills from transaction history for users whose counts were never
 * recorded (e.g., gifts received before the counter existed). Runs once —
 * counts only grow via recordGiftReceivedCount, never overwritten.
 * This guarantees app updates never lose gift counts (server-sourced). */
export async function healGiftCounts(uid: string): Promise<void> {
  if (!uid) return;
  try {
    const { get } = await import('firebase/database');
    // 2026-10-16 (Sumon): Check per-gift — don't skip if SOME counts exist.
    const countsSnap = await get(ref(database, `wallets/${uid}/giftCounts`));
    const existing: Record<string, number> = countsSnap.exists() ? (countsSnap.val() || {}) : {};
    // Backfill from transaction history
    const txSnap = await get(ref(database, `wallets/${uid}/transactions`));
    if (!txSnap.exists()) return;
    const counts: Record<string, number> = {};
    txSnap.forEach((child) => {
      const tx = child.val();
      if (tx && tx.type === 'gift_received' && typeof tx.giftId === 'string' && tx.giftId.length > 0) {
        counts[tx.giftId] = (counts[tx.giftId] ?? 0) + 1;
      }
    });
    if (Object.keys(counts).length === 0) return;
    // Write to server — only for gifts MISSING from server (never overwrite)
    const { runTransaction } = await import('firebase/database');
    for (const [giftId, count] of Object.entries(counts)) {
      if (typeof existing[giftId] === 'number' && existing[giftId] > 0) continue;
      const countRef = ref(database, `wallets/${uid}/giftCounts/${giftId}`);
      await runTransaction(countRef, (cur) => {
        // Only set if not exists — never overwrite existing counts
        if (typeof cur === 'number' && cur > 0) return cur;
        return count;
      }).catch(() => {});
    }
  } catch {
    // Non-critical — counts will heal on next gift
  }
}

/**
 * Ledger probe (2026-10-29 gift routing): after a timeout/abort or a 5xx,
 * the gift outcome is UNKNOWN — the wallet service may have committed the
 * charge while its response was lost. The service's probe endpoint reads
 * the Postgres ledger directly for this idempotency key (sender-scoped:
 * it only reports rows belonging to the caller's own uid). Finding a
 * landed row proves the charge — the app must NOT re-send with a fresh
 * key. Returns the post-charge balance when confirmed, null when no row
 * appears within ~4 s. NEVER falls back to a direct Firebase wallet write.
 */
async function confirmGiftLanded(
  idempotencyKey: string,
): Promise<{ newBalance: number } | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await authedWalletFetch(
        `/wallet/gift/status?idempotencyKey=${encodeURIComponent(idempotencyKey)}`,
        { method: 'GET', timeoutMs: 5000 },
      );
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          landed?: boolean;
          newBalance?: number;
        };
        if (data.landed) {
          return { newBalance: typeof data.newBalance === 'number' ? data.newBalance : 0 };
        }
      }
    } catch {
      // Probe failed (offline/timeout) — keep polling briefly; a miss after
      // the full window is treated as "not landed" by the caller.
    }
    if (attempt < 4) await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

/* 2026-10-24 (Sumon): self-gift is ADMIN-ONLY. Regular users can no longer
 * send gifts to their own account; admins (boss's test accounts) still can,
 * for testing. Identified by users/{uid}/adminRole or /role in RTDB —
 * the same markers the admin system uses. Cached per app session. */
let selfSendAllowedCache: Promise<boolean> | null = null;
export function canSelfSend(uid: string): Promise<boolean> {
  if (!selfSendAllowedCache) {
    selfSendAllowedCache = (async () => {
      try {
        const [a, b] = await Promise.all([
          get(ref(database, `users/${uid}/adminRole`)).catch(() => null),
          get(ref(database, `users/${uid}/role`)).catch(() => null),
        ]);
        const role = String(a?.val() ?? b?.val() ?? '');
        return role === 'admin' || role === 'superAdmin';
      } catch {
        return false;
      }
    })();
  }
  return selfSendAllowedCache;
}

export async function sendGift({
  toUid,
  giftId,
  idempotencyKey,
  toName,
  toPhotoURL,
  price,
  roomId,
  seatedSender,
}: SendGiftArgs): Promise<SendGiftResult> {
  // 2026-10-24 (Sumon): self-gift guard — enforced here so EVERY send path
  // (VPS server + Firebase fallback) is covered. The API server enforces
  // the same rule independently. Admins are exempt (testing).
  const senderUid = auth.currentUser?.uid;
  if (senderUid && toUid === senderUid) {
    const allowed = await canSelfSend(senderUid);
    if (!allowed) {
      throw new GiftError('You cannot send gifts to your own account');
    }
  }
  const key = idempotencyKey ?? Crypto.randomUUID();

  // Shared post-success bookkeeping for the server path (noble XP, level
  // XP, gift counts, weekly boards, intimacy) — runs exactly once per gift,
  // whether the success came back in the HTTP response or was confirmed
  // afterwards by the double-debit guard.
  const handleServerSuccess = (newBalance: number, receipt: unknown, priceOverride?: number): SendGiftResult => {
    // P1-1 (2026-10-12): Noble XP on the PRIMARY (VPS) gift path too.
    // The fallback path is mutually exclusive, so this runs exactly once
    // per gift. Self-gifts excluded (anti-farming), mirroring the fallback.
    const serverFromUid = auth.currentUser?.uid;
    // 2026-10-16 (Sumon): PERMANENT — use actual price (server-driven) for XP, not hardcoded map
    const serverPrice = priceOverride ?? price ?? GIFT_PRICES[giftId];
    if (serverFromUid && serverPrice && toUid !== serverFromUid) {
      // 2026-10-19 perf: FIRE-AND-FORGET bookkeeping — the gift already
      // completed on the server; XP/leaderboard writes must not serialize
      // behind (or block) the gift UI's return.
      import('@/src/services/nobleService').then(({ recordNobleXP }) =>
        recordNobleXP(serverFromUid, serverPrice).catch(() => {
          // XP write failed — gift stands; noble progress for this gift is lost.
        }),
      ).catch(() => {});
      // 2026-10-16 (Sumon): Record level XP (permanent, server-stored).
      import('@/src/services/levelService').then(({ recordLevelXP }) =>
        recordLevelXP(serverFromUid, serverPrice).catch(() => {
          // Level XP failed — non-critical.
        }),
      ).catch(() => {});
      // 2026-10-15 (Sumon): permanent lifetime gift count (VPS primary path).
      recordGiftReceivedCount(toUid, giftId).catch(() => {});
      // Weekly leaderboard stats (best-effort, fire-and-forget; self-gifts excluded).
      {
        const me = auth.currentUser;
        recordWeeklyLeaderboardStats({
          fromUid: serverFromUid,
          toUid,
          price: serverPrice,
          recipientAmount: Math.floor(serverPrice * 0.4),
          senderName: me?.displayName,
          senderPhotoURL: me?.photoURL,
          receiverName: toName,
          receiverPhotoURL: toPhotoURL,
        }).catch(() => {
          // Non-critical
        });
      }
      // Weekly Top Rooms stat (server path) — self-gifts count for rooms.
      if (roomId) {
        recordWeeklyRoomGiftStat({ roomId, price: serverPrice }).catch(() => {});
      }
    }
    // 2026-10-19 (IMO intimacy port): fire-and-forget intimacy — gift already
    // completed on the server; must not block the gift UI's return. Self-gifts
    // excluded (anti-farming), mirroring noble XP.
    if (serverFromUid && toUid !== serverFromUid && serverPrice) {
      import('@/src/features/voice-room/services/intimacyService').then(({ recordIntimacy }) =>
        recordIntimacy(serverFromUid, toUid, serverPrice).catch(() => {}),
      ).catch(() => {});
    }
    // Builder D (2026-10-26): couple hearts, server path — exactly once per
    // gift, beside recordIntimacy above. Fire-and-forget: a failed bump
    // never fails a gift that already succeeded. Only fires when the caller
    // proved the sender was seated (seatedSender === true); the bump itself
    // additionally requires the pair to be coupled to each other.
    if (serverFromUid && toUid !== serverFromUid && serverPrice && seatedSender === true) {
      import('@/src/features/intimacy/coupleService').then(({ bumpCoupleHeartsForGift }) =>
        bumpCoupleHeartsForGift({
          senderUid: serverFromUid, recipientUid: toUid,
          diamonds: serverPrice, seatedSender: true,
        }).catch(() => {}),
      ).catch(() => {});
    }
    return {
      ok: true,
      newBalance: newBalance,
      receipt,
    };
  };


  // GIFT ROUTING (2026-10-29): the ONLY money path is the dedicated wallet
  // service (Postgres ledger, one tx per gift). The old Firebase-direct
  // fallback is DELETED — it broke the one-writer law (H1) by design.
  // Unknown outcomes (network failure/abort → res null, 5xx, or a 200 with
  // an unrecognized body) are resolved by probing the ledger with the SAME
  // key, then retrying the POST with the SAME key (up to 2 more attempts,
  // each followed by a probe). A committed gift is visible to the probe
  // immediately, so a re-tap after all retries fail is safe — the probe
  // proved the key never landed. FINAL outcomes (insufficient /
  // unknown_gift / self_gift_denied / malformed / auth) are never retried:
  // the tx rolled back and wrote no rows.
  const attemptSend = async (): Promise<Response | null> => {
    try {
      return await authedWalletFetch('/wallet/gift/send', {
        method: 'POST',
        body: { toUid, giftId, idempotencyKey: key },
        // 2026-10-21: cap the wait at 6 s (unchanged from the old primary) —
        // a hung service must never freeze the gift UI.
        timeoutMs: 6000,
      });
    } catch (e) {
      console.warn(
        '[wallet] wallet gift send failed',
        key,
        (e as Error)?.name ?? '',
        (e as Error)?.message ?? String(e),
      );
      return null;
    }
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await attemptSend();
    if (res) {
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          newBalance?: number;
          price?: number;
          code?: string;
          error?: string;
        };
        if (data.ok) {
          return handleServerSuccess(
            typeof data.newBalance === 'number' ? data.newBalance : 0,
            { via: 'wallet-service', giftId, price: data.price },
            typeof data.price === 'number' ? data.price : undefined,
          );
        }
        if (data.code === 'insufficient') throw new InsufficientFundsError('Insufficient diamonds');
        if (typeof data.code === 'string' && data.code.length > 0) {
          // Known business rejection — final, nothing was charged.
          throw new GiftError(data.error ?? 'Gift failed on server, please retry');
        }
        // 200 with an unrecognized body: outcome unknown → probe below.
      } else if (res.status === 429) {
        throw new GiftError('Sending too fast — please wait a moment and try again');
      } else if (res.status < 500) {
        // Decided rejections (400 malformed, 401/403 auth, 404): final,
        // the service wrote nothing.
        throw new GiftError('Gift failed on server, please retry');
      }
      // 5xx → unknown outcome → probe below.
    }
    // Unknown outcome (null res, 5xx, or unrecognized 200 body): probe the
    // ledger before any retry. A landed row means the gift succeeded.
    const landed = await confirmGiftLanded(key).catch(() => null);
    if (landed) {
      console.warn('[wallet] gift confirmed landed after unknown outcome', key);
      return handleServerSuccess(landed.newBalance, { via: 'wallet-service', giftId, price });
    }
    // Not landed — loop retries the POST with the SAME key.
  }
  throw new NetworkError('Gift status unknown — check your balance before retrying');
}

/**
 * Subscribe to the 50 most recent wallet transactions, sorted newest-first.
 *
 * RC8-B2: Uses limitToLast(50) query directly in Firebase instead of downloading
 * all transactions and slicing client-side. This reduces data transfer from
 * O(all_transactions) to O(50) regardless of transaction history length.
 */
export function subscribeTransactionHistory(
  uid: string,
  callback: (txs: WalletTransaction[]) => void,
): () => void {
  // orderByKey() returns transactions in push-key order (chronological).
  // limitToLast(50) fetches only the 50 most recent from Firebase itself.
  const txQuery = query(
    ref(database, `wallets/${uid}/transactions`),
    orderByKey(),
    limitToLast(50),
  );
  // Gift catalog for mapping giftId -> emoji/name (mirrors server catalog)
  const GIFT_MAP: Record<string, { emoji: string; name: string }> = {
    '1': { emoji: '💝', name: 'Heart' },
    '2': { emoji: '🌹', name: 'Rose' },
    '3': { emoji: '🎁', name: 'Gift' },
    '4': { emoji: '💎', name: 'Diamond' },
    '5': { emoji: '🏆', name: 'Trophy' },
    '6': { emoji: '🚀', name: 'Rocket' },
    '7': { emoji: '👑', name: 'Crown' },
    '8': { emoji: '🎆', name: 'Firework' },
  };
  return onValue(
    txQuery,
    (snap) => {
      const txs: WalletTransaction[] = [];
      if (snap.exists()) {
        snap.forEach((child) => {
          const raw = child.val() as Record<string, unknown>;
          // C9 FIX: Map server schema to client schema.
          // Server writes: { type, giftId, coins, toUid/fromUid, ts }
          // Client expects: { type, giftId, diamonds, counterpartUid, giftName, emoji, ts }
          const giftId = String(raw.giftId ?? '');
          const giftMeta = GIFT_MAP[giftId] ?? { emoji: '🎁', name: 'Gift' };
          const isSent = raw.type === 'gift_sent';
          const counterpartUid = String(raw.toUid ?? raw.fromUid ?? '');
          // Handle non-gift transaction types (e.g., short_id_purchase)
          // FIX (2026-10-10): Preserve 'recharge' type — wallet screen shows
          // ONLY recharges; previously it would have been mapped to gift_received.
          const rawType = String(raw.type ?? '');
          const txType = rawType === 'recharge' ? 'recharge'
            : rawType === 'short_id_purchase' ? 'gift_sent'
            : (isSent ? 'gift_sent' : 'gift_received');
          // FIX (2026-10-10): Map recharge fields (diamonds/emoji/giftName)
          // — recharge records use diamonds directly, not the gift catalog.
          const isRecharge = txType === 'recharge';
          // P2-7 (2026-10-12): the Firebase fallback writes `diamonds`
          // (never `coins`/`price`), so read it FIRST — otherwise fallback
          // gift history always showed 0.
          const diamondsVal = isRecharge
            ? (typeof raw.diamonds === 'number' ? raw.diamonds : 0)
            : (typeof raw.diamonds === 'number' ? raw.diamonds
              : (typeof raw.coins === 'number' ? raw.coins
                : (typeof raw.price === 'number' ? raw.price : 0)));
          txs.push({
            id: child.key!,
            type: txType as WalletTransaction['type'],
            giftId,
            diamonds: diamondsVal,
            emoji: isRecharge ? '💎' : giftMeta.emoji,
            giftName: isRecharge ? 'Diamond Recharge' : (raw.type === 'short_id_purchase' ? 'Short ID' : giftMeta.name),
            counterpartUid,
            counterpartName: counterpartUid.slice(0, 8),
            roomId: null,
            ts: typeof raw.ts === 'number' ? raw.ts : (typeof raw.timestamp === 'number' ? raw.timestamp : Date.now()),
          });
        });
        // Sort newest-first (push keys are chronological, so reverse)
        txs.sort((a, b) => b.ts - a.ts);
      }
      callback(txs);
    },
    () => callback([]),
  );
}

/**
 * Debit diamonds from own wallet via Firebase transaction (for self-gifts).
 * Uses a transaction for atomicity. Throws InsufficientFundsError if balance
 * is too low.
 */
export async function debitOwnWallet(uid: string, amount: number): Promise<number> {
  if (!uid || amount <= 0) throw new Error('Invalid debit parameters');
  const balRef = ref(database, `wallets/${uid}/balance`);
  const result = await runTransaction(balRef, (current) => {
    const bal = typeof current === 'number' ? current : 0;
    if (bal < amount) return; // abort transaction
    return bal - amount;
  });
  if (!result.committed) {
    throw new InsufficientFundsError('Insufficient diamonds');
  }
  return result.snapshot.val() as number;
}
