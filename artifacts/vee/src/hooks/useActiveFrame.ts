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
 */
export function useActiveFrame(uid: string | undefined | null): string | null {
  const [frameId, setFrameId] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setFrameId(null);
      return;
    }

    // Real-time listener — frame grant/change/removal reflects immediately
    const unsub = onValue(ref(database, `users/${uid}/activeFrame`), (snap) => {
      const val = snap.val();
      // Frame ID is a string; null/empty means no active frame
      setFrameId(typeof val === 'string' && val.trim().length > 0 ? val.trim() : null);
    });

    return () => unsub();
  }, [uid]);

  return frameId;
}
