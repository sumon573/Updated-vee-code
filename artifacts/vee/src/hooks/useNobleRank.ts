import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { database } from '../config/firebase';

/**
 * 2026-11-01 (batch55, boss: King names gold + shimmer in voice rooms):
 * Hook to read ANOTHER user's noble rank in REAL-TIME.
 *
 * Same direct-subscription architecture as useActiveFrame (2026-10-14):
 * SeatCard / chat items listen DIRECTLY to users/{uid}/noble/rankIndex —
 * no stale copies in seat/chat data, rank changes reflect live.
 *
 * Same ref-counted subscription cache as useActiveFrame (perf audit
 * 2026-10-22): one shared onValue per uid no matter how many seats or
 * chat rows render that user; subscribers are notified only when the
 * value actually changes.
 *
 * Rules allow this read: users/$uid has ".read": "auth != null".
 * Returns the rankIndex number, or null when the user has no noble rank.
 */

function parseRank(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return Math.floor(val);
  if (typeof val === 'string' && /^\d+$/.test(val.trim())) return parseInt(val.trim(), 10);
  return null;
}

interface RankEntry {
  value: number | null;
  refCount: number;
  listeners: Set<(v: number | null) => void>;
  unsub: (() => void) | null;
}

const rankCache = new Map<string, RankEntry>();

function ensureRankSubscription(uid: string): RankEntry {
  const existing = rankCache.get(uid);
  if (existing) return existing;

  const entry: RankEntry = {
    value: null,
    refCount: 0,
    listeners: new Set(),
    unsub: null,
  };

  entry.unsub = onValue(ref(database, `users/${uid}/noble/rankIndex`), (snap) => {
    const next = parseRank(snap.val());
    if (next !== entry.value) {
      entry.value = next;
      for (const cb of entry.listeners) {
        try { cb(next); } catch { /* one bad listener must not break the rest */ }
      }
    }
  }, () => {
    // Fall back to no rank instead of a silently dead listener.
    if (entry.value !== null) {
      entry.value = null;
      for (const cb of entry.listeners) {
        try { cb(null); } catch { /* ignore */ }
      }
    }
  });

  rankCache.set(uid, entry);
  return entry;
}

/** Subscribe to a uid's noble rankIndex. Ref-counted, change-only callbacks. */
export function subscribeNobleRank(
  uid: string,
  cb: (rankIndex: number | null) => void,
): () => void {
  const entry = ensureRankSubscription(uid);
  entry.refCount += 1;
  entry.listeners.add(cb);
  cb(entry.value);
  return () => {
    entry.listeners.delete(cb);
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      try { entry.unsub?.(); } catch { /* ignore */ }
      rankCache.delete(uid);
    }
  };
}

export function useNobleRank(uid: string | undefined | null): number | null {
  const [rankIndex, setRankIndex] = useState<number | null>(() =>
    uid ? rankCache.get(uid)?.value ?? null : null,
  );

  useEffect(() => {
    if (!uid) {
      setRankIndex(null);
      return;
    }
    return subscribeNobleRank(uid, setRankIndex);
  }, [uid]);

  return rankIndex;
}

/** King-only gate (rank exclusivity, boss 2026-10-31): rankIndex 6 only. */
export function useIsKing(uid: string | undefined | null): boolean {
  return useNobleRank(uid) === 6;
}
