/**
 * Wallet Service — Firebase Realtime Database (reads) + api-server (writes)
 *
 * Server contracts (api-server):
 *   POST /api/wallet/init       → { ok, balance, created }
 *     (uid is derived from the ID token — always inits the caller's own wallet)
 *   POST /api/wallet/send-gift  → { ok, newBalance, receipt }
 *     body: { toUid, giftId, idempotencyKey }
 *     400 (insufficient) → { ok: false, error }
 *   GET  /api/wallet/balance    → { balance }
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
 * All mutations go through the api-server (/wallet/init, /wallet/send-gift),
 * which verifies the caller's Firebase ID token and uses the Admin SDK to
 * make the change. This prevents a client from ever setting its own balance.
 */

import * as Crypto from 'expo-crypto';
import { ref, get, onValue, query, orderByKey, limitToLast, runTransaction } from 'firebase/database';
import { database, auth } from '@/src/config/firebase';
import { getApiBase } from '@/src/utils/platform';

async function authedFetch(
  path: string,
  opts?: { method?: 'GET' | 'POST'; body?: unknown },
): Promise<Response> {
  const user = auth.currentUser;
  if (!user) throw new GiftError('Not signed in');
  // 2026-10-18 (Sumon): FIX first-attempt "Wallet access denied".
  // getIdToken() returns the CACHED token which may be expired — the VPS
  // rejects it (401), the user sees an error, and only the SECOND attempt
  // (after the SDK auto-refreshes) succeeds. Retry once with a forced
  // refresh on 401/403 so the FIRST attempt works.
  const doFetch = async (forceRefresh: boolean): Promise<Response> => {
    const idToken = await user.getIdToken(forceRefresh);
    return fetch(`${getApiBase()}/api${path}`, {
      method: opts?.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
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
  /** Price in diamonds (from server catalog) — server is source of truth */
  price?: number;
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
/** Gift catalog prices (diamonds). Module-level so both the Firebase
 * fallback and the server-ok path in sendGift() can resolve the price
 * (P1-1, 2026-10-12: Noble XP must accrue on the server gift path too). */
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

async function sendGiftViaFirebase(
  toUid: string,
  giftId: string,
  idempotencyKey: string,
  toName?: string,
  toPhotoURL?: string,
  priceOverride?: number,
): Promise<SendGiftResult> {
  const { auth } = await import('@/src/config/firebase');
  const { ref, runTransaction, push, set, update, serverTimestamp, get, increment } = await import('firebase/database');
  const { database } = await import('@/src/config/firebase');

  const fromUid = auth.currentUser?.uid;
  if (!fromUid) throw new GiftError('Not authenticated');

  // 2026-10-17 (Sumon): Force-refresh auth token before gift transaction.
  // Expired tokens cause "Wallet access denied" — refresh proactively.
  try {
    await auth.currentUser?.getIdToken(true);
  } catch {
    // Non-critical: proceed with existing token, transaction will fail clearly if invalid
  }

  // 2026-10-16 (Sumon): PERMANENT — use server-provided price for server-driven gifts.
  // Falls back to hardcoded GIFT_PRICES for legacy gifts. This enables unlimited
  // server-driven gifts without app builds.
  const price = priceOverride ?? GIFT_PRICES[giftId];
  if (!price) throw new GiftError('Invalid gift');

  // PLATFORM COMMISSION (2026-10-12): 30% platform fee on gifts.
  // Sender pays full price; recipient receives 70%; platform keeps 30%.
  // Example: 10 diamond gift → recipient gets 7, platform keeps 3.
  const PLATFORM_COMMISSION_RATE = 0.30;
  const recipientAmount = Math.floor(price * (1 - PLATFORM_COMMISSION_RATE));
  const platformCommission = price - recipientAmount;

  const coerceBalance = (current: unknown): number => {
    if (typeof current === 'number') return current;
    if (typeof current === 'string') return parseFloat(current) || 0;
    return 0;
  };

  // Step 0: Idempotency — ATOMICALLY claim this key BEFORE debiting.
  // 2026-10-12 audit fix (CRITICAL): the old code only READ the claim here
  // and WROTE it at Step 3 (after debit). Two concurrent invocations could
  // both pass the read → both debit → double-charge. Now: runTransaction
  // claims the key atomically; if already claimed, return the replayed result.
  const claimRef = ref(database, `giftFallbackTx/${idempotencyKey}`);
  const claimResult = await runTransaction(claimRef, (current) => {
    if (current !== null) return; // Already claimed — abort, replay below
    // Claim it: mark as in-progress. newBalance filled at Step 3.
    return { fromUid, toUid, giftId, price, status: 'processing', ts: Date.now() };
  }).catch(() => null);
  if (claimResult && !claimResult.committed) {
    // Key was already claimed — fetch the record and replay.
    try {
      const existing = await get(claimRef);
      if (existing.exists()) {
        const rec = existing.val() as { fromUid?: string; newBalance?: number; status?: string };
        if (rec.fromUid === fromUid) {
          return {
            ok: true,
            newBalance: typeof rec.newBalance === 'number' ? rec.newBalance : 0,
            receipt: { via: 'firebase-direct', giftId, price, replayed: true },
          };
        }
      }
    } catch {
      // Read failed — fall through to GiftError below
    }
    throw new GiftError('Gift already processing');
  }
  if (!claimResult) {
    // Transaction itself failed (offline?) — cannot safely proceed.
    throw new GiftError('Cannot verify gift status, please retry');
  }

  // Step 1: Decrement sender's balance (atomic, validated by rules:
  // own balance may only DECREASE by a valid gift price).
  const senderBalRef = ref(database, `wallets/${fromUid}/balance`);
  let senderResult;
  try {
    senderResult = await runTransaction(senderBalRef, (current) => {
      const bal = coerceBalance(current);
      if (bal < price) return; // Abort — insufficient funds
      return bal - price;
    });
  } catch (e) {
    // 2026-10-12 audit fix (M3): distinguish transport/permission failures
    // from true insufficient funds. If the debit may have committed
    // server-side but the client saw a network error, a blind retry could
    // double-charge (C1 is fixed, but the UX must not lie).
    const msg = e instanceof Error ? e.message : '';
    if (/permission|denied/i.test(msg)) {
      throw new GiftError('Wallet access denied — please re-login');
    }
    if (/network|timeout|unavailable|offline/i.test(msg)) {
      throw new GiftError('Network error — check your balance before retrying');
    }
    throw new InsufficientFundsError('Not enough diamonds');
  }
  if (!senderResult.committed) {
    throw new InsufficientFundsError('Not enough diamonds');
  }
  const newBalance = coerceBalance(senderResult.snapshot.val());

  // Step 2: Increment recipient's balance (skip for self-gifts, net-zero).
  // FIX (2026-10-10): Use server-side increment() instead of runTransaction.
  // runTransaction must READ the current value first, but wallets/$uid/.read
  // is owner-only → cross-user gifts always failed with PERMISSION_DENIED
  // ("Could not send gift"), while self-gifts worked (own wallet readable).
  // increment() is applied server-side: no read permission needed, atomic
  // under concurrency, and validated by the existing .write rule (existing
  // balance must grow by exactly a gift price; missing balance is created
  // with exactly the gift price).
  if (toUid !== fromUid) {
    const recipientBalRef = ref(database, `wallets/${toUid}/balance`);
    try {
      // Recipient receives 70% (platform keeps 30% commission)
      await set(recipientBalRef, increment(recipientAmount));
    } catch {
      // Recipient credit failed — refund sender (best effort)
      await runTransaction(senderBalRef, (current) => {
        return coerceBalance(current) + price;
      }).catch(() => {});
      throw new GiftError('Failed to credit recipient');
    }
    // Record platform commission (best effort — gift already completed)
    try {
      const commissionRef = ref(database, `platformRevenue/giftCommission`);
      await set(commissionRef, increment(platformCommission));
    } catch {
      // Commission tracking failed — gift stands; revenue record lost
    }
  } else {
    // 2026-10-12 (Sumon's order): self-gift returns 70% (commission deducted).
    // Sender pays full price, gets back recipientAmount (70%). Net loss = 30%.
    try {
      await set(senderBalRef, increment(recipientAmount));
    } catch {
      // Self-credit failed — the debit stands; user lost full price.
      // Log but don't throw (gift was "sent" to self).
    }
    // Record platform commission on self-gifts too
    try {
      const commissionRef = ref(database, `platformRevenue/giftCommission`);
      await set(commissionRef, increment(platformCommission));
    } catch {
      // Non-critical
    }
  }

  // Step 3: Finalize idempotency record (claim was written at Step 0).
  try {
    await set(claimRef, {
      fromUid, toUid, giftId, price,
      status: 'completed',
      ts: Date.now(),
      createdAt: serverTimestamp(),
      newBalance,
    });
  } catch {
    // Non-critical — the gift completed; a retry will replay via Step 0.
  }

  // Step 3b (NOTE 10, 2026-10-11): Nobel XP — diamonds sent as gifts count
  // toward the sender's noble rank. Self-gifts are EXCLUDED (anti-farming).
  // Idempotent: replayed gifts return early at Step 0, so this runs exactly
  // once per idempotency key. Atomic under concurrency (runTransaction in
  // recordNobleXP). Non-critical — the gift itself already completed.
  // 2026-10-19 perf: FIRE-AND-FORGET — the gift already completed; XP writes
  // must not serialize behind (or block) the gift UI's return.
  if (toUid !== fromUid) {
    import('@/src/services/nobleService').then(({ recordNobleXP }) =>
      recordNobleXP(fromUid, price).catch(() => {
        // XP write failed — gift stands; noble progress for this gift is lost.
      }),
    ).catch(() => {});
    // 2026-10-16 (Sumon): Record level XP (permanent, server-stored).
    // 1 XP per diamond sent. Very slow progression; Gold slowest.
    import('@/src/services/levelService').then(({ recordLevelXP }) =>
      recordLevelXP(fromUid, price).catch(() => {
        // Level XP failed — non-critical.
      }),
    ).catch(() => {});
  }

  // Step 4: Write transaction history (best effort, fire-and-forget).
  // 2026-10-19 perf: one atomic multi-path update instead of two sequential
  // sets, and not awaited — history must never block the gift UI.
  {
    const timestamp = Date.now();
    const senderTxKey = push(ref(database, `wallets/${fromUid}/transactions`)).key ?? `tx_${timestamp}`;
    const historyUpdates: Record<string, unknown> = {
      [`wallets/${fromUid}/transactions/${senderTxKey}`]: {
        type: 'gift_sent',
        diamonds: -price,
        toUid,
        giftId,
        timestamp,
        createdAt: serverTimestamp(),
      },
    };
    if (toUid !== fromUid) {
      const recipientTxKey = push(ref(database, `wallets/${toUid}/transactions`)).key ?? `tx_${timestamp}_r`;
      historyUpdates[`wallets/${toUid}/transactions/${recipientTxKey}`] = {
        type: 'gift_received',
        diamonds: recipientAmount,
        fromUid,
        giftId,
        timestamp,
        createdAt: serverTimestamp(),
        // Platform commission info (for transparency)
        originalPrice: price,
        platformCommission,
      };
    }
    update(ref(database), historyUpdates).catch(() => {
      // History write failed — gift already completed, don't fail
    });
    // 2026-10-15 (Sumon): permanent lifetime gift count (self-gifts excluded).
    if (toUid !== fromUid) {
      recordGiftReceivedCount(toUid, giftId).catch(() => {});
    }
  }

  // Weekly leaderboard stats (best-effort, fire-and-forget; self-gifts excluded).
  // 2026-10-19 perf: not awaited — must not block the gift UI.
  {
    const me = auth.currentUser;
    if (me && toUid !== fromUid) {
      recordWeeklyLeaderboardStats({
        fromUid,
        toUid,
        price,
        recipientAmount,
        senderName: me.displayName,
        senderPhotoURL: me.photoURL,
        receiverName: toName,
        receiverPhotoURL: toPhotoURL,
      }).catch(() => {
        // Non-critical
      });
    }
  }

  // 2026-10-19 (IMO intimacy port): fire-and-forget intimacy on the fallback
  // path too. Self-gifts excluded (anti-farming).
  {
    const me = auth.currentUser;
    if (me && toUid !== fromUid && price > 0) {
      import('@/src/features/voice-room/services/intimacyService').then(({ recordIntimacy }) =>
        recordIntimacy(fromUid, toUid, price).catch(() => {}),
      ).catch(() => {});
    }
  }

  return { ok: true, newBalance, receipt: { via: 'firebase-direct', giftId, price } };
}

export async function sendGift({
  toUid,
  giftId,
  idempotencyKey,
  toName,
  toPhotoURL,
  price,
}: SendGiftArgs): Promise<SendGiftResult> {
  // Self-gifting is ALLOWED (per product requirement): the server debits and
  // credits the same account (net-zero), so the gift animation and history
  // still work for testing/showcase.
  const key = idempotencyKey ?? Crypto.randomUUID();

  // PRIMARY: VPS api-server (secure, atomic, server-authoritative catalog).
  // On ANY failure the Firebase-direct fallback below takes over — the server
  // is known-unreliable (no auto-deploy, reboot-fragile), so a narrow
  // fallback trigger silently dropped real gifts.
  // EXCEPTION: HTTP 202 "still processing" is never fallen back on — the
  // server may still complete the charge and a fallback would double-debit.
  let res: Response | null = null;
  try {
    const serverBody: Record<string, unknown> = { toUid, giftId, idempotencyKey: key };
    // 2026-10-16 (Sumon): Server catalog is source of truth for price.
    // Pass the server price so VPS charges exactly what user saw.
    if (price !== undefined) serverBody.price = price;
    res = await authedFetch('/wallet/send-gift', {
      method: 'POST',
      body: serverBody,
    });
  } catch {
    // Network failure — res stays null, fallback below takes over.
  }

  if (res && res.status === 202) {
    // Server is still processing a claimed key — do NOT fall back.
    // (Checked before res.ok because Response.ok is true for 202.)
    throw new GiftError('Gift still processing, please retry');
  }
  if (res && res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      newBalance?: number;
      receipt?: unknown;
    };
    if (data.ok) {
      // P1-1 (2026-10-12): Noble XP on the PRIMARY (VPS) gift path too.
      // The fallback path is mutually exclusive, so this runs exactly once
      // per gift. Self-gifts excluded (anti-farming), mirroring the fallback.
      const serverFromUid = auth.currentUser?.uid;
      // 2026-10-16 (Sumon): PERMANENT — use actual price (server-driven) for XP, not hardcoded map
      const serverPrice = price ?? GIFT_PRICES[giftId];
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
            recipientAmount: Math.floor(serverPrice * 0.7),
            senderName: me?.displayName,
            senderPhotoURL: me?.photoURL,
            receiverName: toName,
            receiverPhotoURL: toPhotoURL,
          }).catch(() => {
            // Non-critical
          });
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
      return {
        ok: true,
        newBalance: typeof data.newBalance === 'number' ? data.newBalance : 0,
        receipt: data.receipt,
      };
    }
    // 200-but-not-ok: the server PROCESSED the request (charged or rejected).
    // 2026-10-12 audit fix (HIGH): do NOT fall through to Firebase fallback —
    // the server may have charged already; fallback would double-charge.
    // Surface the server's failure instead.
    throw new GiftError('Gift failed on server, please retry');
  }
  // Server failed (4xx/5xx) or network failed → Firebase fallback is safe
  // (server did not process a 4xx/5xx charge; network failure means unknown,
  // but the idempotency key protects the retry).
  // InsufficientFundsError vs GiftError distinction is preserved: the
  // fallback throws InsufficientFundsError when the balance is truly low.
  try {
    const fbResult = await sendGiftViaFirebase(toUid, giftId, key, toName, toPhotoURL, price);
    if (fbResult.ok) return fbResult;
  } catch (e) {
    // Firebase fallback also failed — surface the meaningful error.
    if (e instanceof InsufficientFundsError || e instanceof GiftError) throw e;
    throw new GiftError(e instanceof Error ? e.message : 'Gift send failed');
  }
  throw new GiftError('Gift send failed');
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
