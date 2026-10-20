/**
 * micHandshakeService — the pair-design layer for Mic Handshakes
 * (2026-10-20, Sumon).
 *
 * RTDB `micHandshakes/{pairKey}` = { designKey, itemId, buyerUid,
 * purchasedAt, expiresAt } — written by purchaseHandshakeForPair
 * (storeService) after a REAL diamond debit. The room reads it live; an
 * expired record simply stops applying (the pair falls back to the free
 * basic design while their intimacy relation lasts).
 */
import { ref, onValue, off } from 'firebase/database';
import { database } from '@/src/config/firebase';

export interface PairHandshake {
  designKey: string;
  expiresAt: number;
}

export function subscribePairHandshake(
  pairKey: string,
  callback: (hs: PairHandshake | null) => void,
): () => void {
  const r = ref(database, `micHandshakes/${pairKey}`);
  const handler = (snap: any) => {
    const v = snap.val();
    if (!v || typeof v.expiresAt !== 'number' || v.expiresAt <= Date.now() || !v.designKey) {
      callback(null);
      return;
    }
    callback({ designKey: String(v.designKey), expiresAt: v.expiresAt });
  };
  onValue(r, handler, () => callback(null));
  return () => off(r, 'value', handler);
}
