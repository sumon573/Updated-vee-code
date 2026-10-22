import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { database } from '../config/firebase';

/**
 * 2026-10-14 (Sumon): Hook to get a user's active frame ID in REAL-TIME.
 *
 * BETTER ARCHITECTURE (vs copying frame to seat data):
 * - SeatCard listens DIRECTLY to users/{uid}/activeFrame
 * - No stale copies, no mapping bugs (the fbSeatToParticipant bug can't happen)
 * - Admin changes reflect LIVE in voice room (no rejoin needed)
 * - Any future frame automatically works (just an ID lookup)
 * - Perfect fit guaranteed: frame renders from the same source everywhere
 *
 * Returns the frame ID string, or null if no active frame.
 *
 * 2026-10-22 (perf audit): module-level ref-counted subscription cache —
 * the same pattern as useLiveUserProfile (2026-10-19). Previously EVERY
 * seat card attached its own onValue for the same uid (a full 10-seat
 * room = 10 frame listeners + 10 mic-sticker listeners). Now one shared
 * subscription per uid; subscribers are notified only when the value
 * actually changes.
 */

function parseFrame(val: unknown): string | null {
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;
}

interface FrameEntry {
  value: string | null;
  refCount: number;
  listeners: Set<(v: string | null) => void>;
  unsub: (() => void) | null;
}

const frameCache = new Map<string, FrameEntry>();

function ensureFrameSubscription(uid: string): FrameEntry {
  const existing = frameCache.get(uid);
  if (existing) return existing;

  const entry: FrameEntry = {
    value: null,
    refCount: 0,
    listeners: new Set(),
    unsub: null,
  };

  entry.unsub = onValue(ref(database, `users/${uid}/activeFrame`), (snap) => {
    const next = parseFrame(snap.val());
    if (next !== entry.value) {
      entry.value = next;
      for (const cb of entry.listeners) {
        try { cb(next); } catch { /* one bad listener must not break the rest */ }
      }
    }
  }, () => {
    // Fall back to no frame instead of a silently dead listener.
    if (entry.value !== null) {
      entry.value = null;
      for (const cb of entry.listeners) {
        try { cb(null); } catch { /* ignore */ }
      }
    }
  });

  frameCache.set(uid, entry);
  return entry;
}

/** Subscribe to a uid's active frame. Ref-counted, change-only callbacks. */
export function subscribeActiveFrame(
  uid: string,
  cb: (frameId: string | null) => void,
): () => void {
  const entry = ensureFrameSubscription(uid);
  entry.refCount += 1;
  entry.listeners.add(cb);
  cb(entry.value);
  return () => {
    entry.listeners.delete(cb);
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      try { entry.unsub?.(); } catch { /* ignore */ }
      frameCache.delete(uid);
    }
  };
}

export function useActiveFrame(uid: string | undefined | null): string | null {
  const [frameId, setFrameId] = useState<string | null>(() =>
    uid ? frameCache.get(uid)?.value ?? null : null,
  );

  useEffect(() => {
    if (!uid) {
      setFrameId(null);
      return;
    }
    return subscribeActiveFrame(uid, setFrameId);
  }, [uid]);

  return frameId;
}
