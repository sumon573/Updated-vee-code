/**
 * Wallet service (web port of the native `walletService`).
 *
 * Reads:  RTDB `wallets/{uid}/balance` (live subscription), transactions.
 * Writes: api-server only (POST /wallet/init, POST /wallet/send-gift,
 *         POST /wallet/topup-crypto). The client never writes balances —
 *         the RTDB rules reject such writes outright.
 */

import { get, limitToLast, onValue, orderByKey, query, ref } from 'firebase/database';
import { rtdb } from '../../lib/firebase';
import { apiFetch } from '../../lib/api';

export type WalletTransaction = {
  id: string;
  type: 'gift_sent' | 'gift_received';
  /** Negative for sent, positive for received. */
  diamonds: number;
  emoji: string;
  giftName: string;
  counterpartUid: string;
  counterpartName: string;
  roomId: string | null;
  ts: number;
};

export type SendGiftResult = {
  ok: true;
  newBalance: number | null;
  receipt: unknown;
  replayed?: boolean;
};

export type TopupPackage = {
  id: string;
  diamonds: number;
  usdt: number;
};

export type TopupConfig = {
  usdtTrc20Address: string;
  packages: TopupPackage[];
};

export type TopupCryptoResult = {
  ok: true;
  diamonds: number;
  newBalance: number;
};

/** Idempotently create the caller's wallet (500 diamonds on first call). */
export async function initWallet(): Promise<{ balance: number; created: boolean }> {
  return apiFetch<{ balance: number; created: boolean }>('/api/wallet/init', {
    method: 'POST',
  });
}

/** One-shot balance read (never auto-creates). */
export async function getBalance(): Promise<number> {
  const data = await apiFetch<{ balance: number }>('/api/wallet/balance', {
    method: 'GET',
  });
  return typeof data.balance === 'number' ? data.balance : 0;
}

/**
 * Live balance subscription. Lazily initializes the wallet (500 diamonds)
 * when the node is absent — same behavior as the native app.
 */
export function subscribeBalance(uid: string, callback: (balance: number) => void): () => void {
  return onValue(
    ref(rtdb, `wallets/${uid}/balance`),
    (snap) => {
      if (!snap.exists()) {
        void initWallet()
          .then((r) => callback(r.balance))
          .catch(() => callback(0));
        return;
      }
      callback(typeof snap.val() === 'number' ? (snap.val() as number) : 0);
    },
    () => callback(0),
  );
}

/** Recent wallet transactions (newest last, up to 50). */
export async function getTransactions(uid: string): Promise<WalletTransaction[]> {
  const q = query(ref(rtdb, `wallets/${uid}/transactions`), orderByKey(), limitToLast(50));
  const snap = await get(q);
  if (!snap.exists()) return [];
  const out: WalletTransaction[] = [];
  snap.forEach((child) => {
    const v = child.val() as Partial<WalletTransaction>;
    out.push({
      id: child.key ?? '',
      type: v.type === 'gift_received' ? 'gift_received' : 'gift_sent',
      diamonds: typeof v.diamonds === 'number' ? v.diamonds : 0,
      emoji: typeof v.emoji === 'string' ? v.emoji : '🎁',
      giftName: typeof v.giftName === 'string' ? v.giftName : 'Gift',
      counterpartUid: typeof v.counterpartUid === 'string' ? v.counterpartUid : '',
      counterpartName: typeof v.counterpartName === 'string' ? v.counterpartName : '',
      roomId: typeof v.roomId === 'string' ? v.roomId : null,
      ts: typeof v.ts === 'number' ? v.ts : 0,
    });
  });
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

/**
 * Send a gift to ONE recipient. The server charges the sender and credits
 * the recipient; the coin cost comes from the server catalog only.
 *
 * Pass a caller-generated `idempotencyKey` (reuse it across retries of the
 * same send action — a retry never re-charges).
 */
export async function sendGift(
  toUid: string,
  giftId: string,
  idempotencyKey: string,
): Promise<SendGiftResult> {
  const data = await apiFetch<{
    ok: boolean;
    newBalance: number | null;
    receipt: unknown;
    replayed?: boolean;
  }>('/api/wallet/send-gift', {
    method: 'POST',
    body: { toUid, giftId, idempotencyKey },
  });
  return {
    ok: true,
    newBalance: typeof data.newBalance === 'number' ? data.newBalance : null,
    receipt: data.receipt,
    replayed: data.replayed === true,
  };
}

/** Server-owned crypto top-up config: deposit address + exact USDT amounts. */
export async function getTopupConfig(): Promise<TopupConfig> {
  const data = await apiFetch<TopupConfig>('/api/wallet/topup-config', { method: 'GET' });
  return data;
}

/**
 * Submit a USDT (TRC20) top-up for server-side on-chain verification.
 * Throws ApiError with the server's message on 400 (underpaid, unconfirmed,
 * wrong recipient, already used, …).
 */
export async function topupCrypto(txHash: string, packageId: string): Promise<TopupCryptoResult> {
  return apiFetch<TopupCryptoResult>('/api/wallet/topup-crypto', {
    method: 'POST',
    body: { txHash: txHash.trim(), network: 'TRC20', packageId },
  });
}
