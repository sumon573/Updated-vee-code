/**
 * svipPointsService — Vee SVIP Points (integral) system (2026-10-19).
 *
 * IMO model (from decompiled APK):
 * - SvipUserIntegralData: rest_integral (balance), pre_expired_integral,
 *   integral_next_expiration_time — POINTS EXPIRE.
 * - Kick-out costs points (cost_svip_point); "Insufficient SVIP points".
 * - Privileges exchanged with points (exchange_points).
 *
 * RTDB model `svipPoints/{uid}`:
 *   { balance: number, expiresAt: number (ms epoch), lastEarnedAt: number,
 *     history: { {pushId}: { amount, reason, ts } } }
 *
 * - Points are granted on SVIP purchase (proportional to tier).
 * - Points EXPIRE 30 days after last earn (checked on every read; expired
 *   balance is zeroed on read).
 * - Spends use a transaction (race-safe deduct).
 */
import { getErrorCause } from '@/src/utils/errorDisplay';

/** Points expire this long after the last earn (IMO: monthly cycle). */
export const SVIP_POINTS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SvipPointsState {
  balance: number;
  expiresAt: number;
  lastEarnedAt: number;
}

export interface SvipPointsHistoryEntry {
  amount: number; // +earn / -spend
  reason: string;
  ts: number;
}

function normalize(raw: any): SvipPointsState {
  const now = Date.now();
  const balance = typeof raw?.balance === 'number' ? raw.balance : 0;
  const expiresAt = typeof raw?.expiresAt === 'number' ? raw.expiresAt : 0;
  // Expired points read as zero (IMO: pre_expired_integral).
  if (expiresAt > 0 && expiresAt <= now) {
    return { balance: 0, expiresAt: 0, lastEarnedAt: 0 };
  }
  return {
    balance: Math.max(0, balance),
    expiresAt,
    lastEarnedAt: typeof raw?.lastEarnedAt === 'number' ? raw.lastEarnedAt : 0,
  };
}

async function db() {
  const { database } = await import('@/src/config/firebase');
  return database;
}

/** Live subscription to points (expiry applied on every snapshot). */
export function subscribeSvipPoints(
  uid: string,
  cb: (s: SvipPointsState) => void,
  onError?: (e: unknown) => void,
): () => void {
  let detach: (() => void) | null = null;
  let cancelled = false;
  (async () => {
    try {
      const { ref, onValue } = await import('firebase/database');
      const database = await db();
      if (cancelled) return;
      detach = onValue(
        ref(database, `svipPoints/${uid}`),
        (snap) => cb(normalize(snap.val())),
        (e) => onError?.(e),
      );
    } catch (e) {
      if (!cancelled) onError?.(e);
    }
  })();
  return () => {
    cancelled = true;
    try { detach?.(); } catch { /* non-critical */ }
  };
}

/** One-time read (expiry applied). */
export async function getSvipPoints(uid: string): Promise<SvipPointsState> {
  const { ref, get } = await import('firebase/database');
  const database = await db();
  try {
    const snap = await get(ref(database, `svipPoints/${uid}`));
    return normalize(snap.val());
  } catch (e) {
    throw new Error(getErrorCause(e));
  }
}

/**
 * Grant points (e.g. on SVIP purchase). Refreshes the 30-day expiry window
 * from now. Appends to history (capped server-side by rules to last 50).
 */
export async function earnSvipPoints(
  uid: string,
  amount: number,
  reason: string,
): Promise<void> {
  if (!uid || amount <= 0) return;
  const { ref, runTransaction, push, set, serverTimestamp } = await import('firebase/database');
  const database = await db();
  try {
    await runTransaction(ref(database, `svipPoints/${uid}`), (cur: any) => {
      const s = normalize(cur);
      const now = Date.now();
      return {
        balance: s.balance + amount,
        expiresAt: now + SVIP_POINTS_TTL_MS,
        lastEarnedAt: now,
        history: cur?.history || null,
      };
    });
    const hRef = push(ref(database, `svipPoints/${uid}/history`));
    await set(hRef, { amount, reason: String(reason || 'earn').slice(0, 80), ts: serverTimestamp() });
  } catch (e) {
    throw new Error(getErrorCause(e));
  }
}

/**
 * Spend points (transaction-safe). Throws Error('INSUFFICIENT_POINTS')
 * when the balance is too low — callers map this to the IMO message
 * "Insufficient SVIP points".
 */
export async function spendSvipPoints(
  uid: string,
  amount: number,
  reason: string,
): Promise<void> {
  if (!uid || amount <= 0) return;
  const { ref, runTransaction, push, set, serverTimestamp } = await import('firebase/database');
  const database = await db();
  try {
    const res = await runTransaction(ref(database, `svipPoints/${uid}`), (cur: any) => {
      const s = normalize(cur);
      if (s.balance < amount) return; // abort
      return {
        balance: s.balance - amount,
        expiresAt: s.expiresAt,
        lastEarnedAt: s.lastEarnedAt,
        history: cur?.history || null,
      };
    });
    if (!res.committed) {
      throw new Error('INSUFFICIENT_POINTS');
    }
    const hRef = push(ref(database, `svipPoints/${uid}/history`));
    await set(hRef, { amount: -amount, reason: String(reason || 'spend').slice(0, 80), ts: serverTimestamp() });
  } catch (e) {
    if (e instanceof Error && e.message === 'INSUFFICIENT_POINTS') throw e;
    throw new Error(getErrorCause(e));
  }
}

/** Points history, newest first (up to 50). */
export async function getSvipPointsHistory(uid: string): Promise<SvipPointsHistoryEntry[]> {
  const { ref, get, query, orderByChild, limitToLast } = await import('firebase/database');
  const database = await db();
  try {
    const q = query(ref(database, `svipPoints/${uid}/history`), orderByChild('ts'), limitToLast(50));
    const snap = await get(q);
    const out: SvipPointsHistoryEntry[] = [];
    if (snap.exists()) {
      snap.forEach((c) => {
        const v = c.val();
        out.push({
          amount: typeof v?.amount === 'number' ? v.amount : 0,
          reason: String(v?.reason || ''),
          ts: typeof v?.ts === 'number' ? v.ts : 0,
        });
      });
    }
    return out.reverse();
  } catch (e) {
    throw new Error(getErrorCause(e));
  }
}

/** Human-readable expiry, e.g. "12 days left". */
export function formatPointsExpiry(expiresAt: number): string {
  if (!expiresAt) return '—';
  const days = Math.max(0, Math.ceil((expiresAt - Date.now()) / 86400000));
  if (days <= 0) return 'Expired';
  return days === 1 ? '1 day left' : `${days} days left`;
}
