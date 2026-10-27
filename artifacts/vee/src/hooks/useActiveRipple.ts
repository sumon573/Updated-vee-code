import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { database } from '../config/firebase';

/**
 * 2026-10-27 (boss: Sound Ripple Use must visibly work): a user's EQUIPPED
 * sound ripple in REAL-TIME — the 2026-10-15 TODO, now implemented.
 *
 * Same architecture as useActiveFrame (2026-10-14): SeatCard listens
 * DIRECTLY to users/{uid}/activeRipple + users/{uid}/ripples — no stale
 * seat copies (the old seat record carried activeRipple only as a snapshot
 * taken at join/seat time, so a mid-session Use never showed), no mapping
 * bugs. A Use tap in Decoration reflects on the seat live, no re-seat.
 *
 * Returns { id, colors } when the user has an equipped ripple, else null.
 * - colors come from the ripples collection entry (GrantedRipple.colors).
 * - an entry whose numeric validity already passed is treated as no ripple
 *   (belt + suspenders: the noble sweep + event bot also clear it).
 * - an equipped id with no collection entry still returns { id, colors: [] }
 *   so the seat treats it as equipped with fallback colors, never a crash.
 *
 * One shared ref-counted subscription set per uid, so a 10-seat room does
 * not attach duplicate listeners for the same uid.
 */

export interface ActiveRipple {
  id: string;
  colors: string[];
}

interface RippleEntry {
  value: ActiveRipple | null;
  refCount: number;
  listeners: Set<(v: ActiveRipple | null) => void>;
  unsubs: Array<() => void>;
  activeId: string | null;
  ripples: Record<string, { colors?: unknown; validity?: unknown }> | null;
}

const rippleCache = new Map<string, RippleEntry>();

function resolve(entry: RippleEntry): ActiveRipple | null {
  const id = entry.activeId;
  if (!id) return null;
  const rec = entry.ripples?.[id];
  if (rec && typeof rec.validity === 'number' && rec.validity <= Date.now()) return null;
  const colors = Array.isArray(rec?.colors)
    ? (rec!.colors as unknown[]).filter((c): c is string => typeof c === 'string' && !!c)
    : [];
  return { id, colors };
}

function ensureRippleSubscription(uid: string): RippleEntry {
  const existing = rippleCache.get(uid);
  if (existing) return existing;

  const entry: RippleEntry = {
    value: null,
    refCount: 0,
    listeners: new Set(),
    unsubs: [],
    activeId: null,
    ripples: null,
  };

  const emit = () => {
    const next = resolve(entry);
    if (JSON.stringify(next) !== JSON.stringify(entry.value)) {
      entry.value = next;
      for (const cb of entry.listeners) {
        try { cb(next); } catch { /* one bad listener must not break the rest */ }
      }
    }
  };

  entry.unsubs.push(onValue(ref(database, `users/${uid}/activeRipple`), (snap) => {
    const v = snap.val();
    entry.activeId = typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
    emit();
  }, () => {
    if (entry.activeId !== null || entry.value !== null) {
      entry.activeId = null;
      emit();
    }
  }));

  entry.unsubs.push(onValue(ref(database, `users/${uid}/ripples`), (snap) => {
    const v = snap.val();
    entry.ripples = v && typeof v === 'object' ? (v as RippleEntry['ripples']) : null;
    emit();
  }, () => {
    if (entry.ripples !== null) {
      entry.ripples = null;
      emit();
    }
  }));

  rippleCache.set(uid, entry);
  return entry;
}

/** Subscribe to a uid's equipped sound ripple. Ref-counted, change-only callbacks. */
export function subscribeActiveRipple(
  uid: string,
  cb: (ripple: ActiveRipple | null) => void,
): () => void {
  const entry = ensureRippleSubscription(uid);
  entry.refCount += 1;
  entry.listeners.add(cb);
  cb(entry.value);
  return () => {
    entry.listeners.delete(cb);
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      for (const unsub of entry.unsubs) {
        try { unsub(); } catch { /* ignore */ }
      }
      rippleCache.delete(uid);
    }
  };
}

export function useActiveRipple(uid: string | undefined | null): ActiveRipple | null {
  const [ripple, setRipple] = useState<ActiveRipple | null>(() =>
    uid ? rippleCache.get(uid)?.value ?? null : null,
  );

  useEffect(() => {
    if (!uid) {
      setRipple(null);
      return;
    }
    return subscribeActiveRipple(uid, setRipple);
  }, [uid]);

  return ripple;
}
