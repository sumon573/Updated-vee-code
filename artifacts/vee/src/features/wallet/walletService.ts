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
  type: 'gift_sent' | 'gift_received';
  /** Negative for sent, positive for received */
  diamonds: number;
  emoji: string;
  giftName: string;
  counterpartUid: string;
  counterpartName: string;
  roomId: string | null;
  ts: number;
};

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
  return snap.exists() ? (snap.val() as number) : 0;
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
        // background: safe to swallow — retried on every balance touch until it succeeds
        await initializeWallet(uid).catch(() => {});
        callback(500);
      } else {
        callback(snap.val() as number);
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
export async function sendGift({
  toUid,
  giftId,
  idempotencyKey,
}: SendGiftArgs): Promise<SendGiftResult> {
  // Self-gifting is ALLOWED (per product requirement): the server debits and
  // credits the same account (net-zero), so the gift animation and history
  // still work for testing/showcase.
  const key = idempotencyKey ?? Crypto.randomUUID();

  let res: Response;
  try {
    res = await authedFetch('/wallet/send-gift', {
      method: 'POST',
      body: { toUid, giftId, idempotencyKey: key },
    });
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : 'Gift request failed');
  }

  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new InsufficientFundsError(body.error ?? 'Insufficient diamonds');
  }
  if (!res.ok) {
    throw new GiftError(`Gift send failed (HTTP ${res.status})`);
  }

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    newBalance?: number;
    receipt?: unknown;
  };
  if (!data.ok) {
    throw new GiftError('Gift send failed');
  }
  return {
    ok: true,
    newBalance: typeof data.newBalance === 'number' ? data.newBalance : 0,
    receipt: data.receipt,
  };
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
  return onValue(
    txQuery,
    (snap) => {
      const txs: WalletTransaction[] = [];
      if (snap.exists()) {
        snap.forEach((child) => {
          txs.push({ id: child.key!, ...(child.val() as Omit<WalletTransaction, 'id'>) });
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
