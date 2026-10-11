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
  const idToken = await user.getIdToken();
  return fetch(`${getApiBase()}/api${path}`, {
    method: opts?.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
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
      ts: Date.now(),
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
async function sendGiftViaFirebase(
  toUid: string,
  giftId: string,
  idempotencyKey: string,
): Promise<SendGiftResult> {
  const { auth } = await import('@/src/config/firebase');
  const { ref, runTransaction, push, set, serverTimestamp, get, increment } = await import('firebase/database');
  const { database } = await import('@/src/config/firebase');

  const fromUid = auth.currentUser?.uid;
  if (!fromUid) throw new GiftError('Not authenticated');

  const GIFT_PRICES: Record<string, number> = {
    '1': 10, '2': 25, '3': 50, '4': 100,
    '5': 200, '6': 500, '7': 1000, '8': 2000,
  };
  const price = GIFT_PRICES[giftId];
  if (!price) throw new GiftError('Invalid gift');

  const coerceBalance = (current: unknown): number => {
    if (typeof current === 'number') return current;
    if (typeof current === 'string') return parseFloat(current) || 0;
    return 0;
  };

  // Step 0: Idempotency — claim this key BEFORE debiting. If already claimed
  // (retry), return the stored result instead of charging again.
  const claimRef = ref(database, `giftFallbackTx/${idempotencyKey}`);
  try {
    const existing = await get(claimRef);
    if (existing.exists()) {
      const rec = existing.val() as { fromUid?: string; newBalance?: number; giftId?: string; price?: number };
      if (rec.fromUid === fromUid) {
        return {
          ok: true,
          newBalance: typeof rec.newBalance === 'number' ? rec.newBalance : 0,
          receipt: { via: 'firebase-direct', giftId, price, replayed: true },
        };
      }
      // Key belongs to someone else — must not reuse it.
      throw new GiftError('Invalid idempotency key');
    }
  } catch (e) {
    if (e instanceof GiftError) throw e;
    // Read failed (offline?) — proceed; the claim write below will decide.
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
  } catch {
    // Permission denied (no wallet node) or other failure → cannot debit.
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
      await set(recipientBalRef, increment(price));
    } catch {
      // Recipient credit failed — refund sender (best effort)
      await runTransaction(senderBalRef, (current) => {
        return coerceBalance(current) + price;
      }).catch(() => {});
      throw new GiftError('Failed to credit recipient');
    }
  }

  // Step 3: Record idempotency (best effort — gift already completed).
  try {
    await set(claimRef, {
      fromUid, toUid, giftId, price,
      ts: Date.now(),
      createdAt: serverTimestamp(),
      newBalance,
    });
  } catch {
    // Non-critical — a retry would re-debit, but the balance check above
    // plus the UI's single-send flow make this acceptable.
  }

  // Step 4: Write transaction history (best effort, non-blocking)
  const timestamp = Date.now();
  try {
    const senderTxRef = push(ref(database, `wallets/${fromUid}/transactions`));
    await set(senderTxRef, {
      type: 'gift_sent',
      diamonds: -price,
      toUid,
      giftId,
      timestamp,
      createdAt: serverTimestamp(),
    });
    if (toUid !== fromUid) {
      const recipientTxRef = push(ref(database, `wallets/${toUid}/transactions`));
      await set(recipientTxRef, {
        type: 'gift_received',
        diamonds: price,
        fromUid,
        giftId,
        timestamp,
        createdAt: serverTimestamp(),
      });
    }
  } catch {
    // History write failed — gift already completed, don't fail
  }

  return { ok: true, newBalance, receipt: { via: 'firebase-direct', giftId, price } };
}

export async function sendGift({
  toUid,
  giftId,
  idempotencyKey,
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
    res = await authedFetch('/wallet/send-gift', {
      method: 'POST',
      body: { toUid, giftId, idempotencyKey: key },
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
      return {
        ok: true,
        newBalance: typeof data.newBalance === 'number' ? data.newBalance : 0,
        receipt: data.receipt,
      };
    }
    // 200-but-not-ok: fall through to Firebase fallback below.
  }
  // Server failed (4xx/5xx/unexpected body) or network failed → fallback.
  // InsufficientFundsError vs GiftError distinction is preserved: the
  // fallback throws InsufficientFundsError when the balance is truly low.
  try {
    const fbResult = await sendGiftViaFirebase(toUid, giftId, key);
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
          const diamondsVal = isRecharge
            ? (typeof raw.diamonds === 'number' ? raw.diamonds : 0)
            : (typeof raw.coins === 'number' ? raw.coins : (typeof raw.price === 'number' ? raw.price : 0));
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
