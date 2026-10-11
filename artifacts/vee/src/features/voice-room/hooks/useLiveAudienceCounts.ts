/**
 * useLiveAudienceCounts — real-time live audience per room.
 *
 * 2026-10-11 (Issue #1): The cached `info.memberCount`/`info.listenerCount`
 * can go stale (onDisconnect removals, swallowed write errors), so room cards
 * showed "0 members" for rooms with people, and empty rooms slipped into
 * Trending. This hook subscribes to the ACTUAL `seats` + `audience` nodes per
 * room and computes the true live count = unique seat users + audience
 * members. Sumon's rule: entering the room counts — seat NOT required.
 *
 * Dedupe: a user can briefly appear in both seats and audience during a
 * seat switch — count unique user IDs only.
 */

import { useEffect, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { database } from '@/src/config/firebase';

export function useLiveAudienceCounts(roomIds: string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Stable key so the effect only re-subscribes when the room set changes.
  const key = [...roomIds].sort().join(',');

  useEffect(() => {
    if (!key) {
      setCounts({});
      return;
    }
    const ids = key.split(',').filter(Boolean);
    const unsubs: Array<() => void> = [];
    // Per-room seat-user sets + audience counts; recompute on any change.
    const seatUsers = new Map<string, Set<string>>();
    const audCounts = new Map<string, number>();

    const recompute = () => {
      const next: Record<string, number> = {};
      for (const id of ids) {
        const seats = seatUsers.get(id);
        const aud = audCounts.get(id) ?? 0;
        // Audience members already on a seat are removed from audience by
        // takeSeat, but dedupe defensively anyway.
        next[id] = (seats ? seats.size : 0) + aud;
      }
      setCounts(next);
    };

    for (const id of ids) {
      seatUsers.set(id, new Set());
      audCounts.set(id, 0);
      const seatsRef = ref(database, `rooms/${id}/seats`);
      const audRef = ref(database, `rooms/${id}/audience`);
      unsubs.push(
        onValue(seatsRef, (snap) => {
          const users = new Set<string>();
          if (snap.exists()) {
            snap.forEach((child) => {
              const v = child.val() as { userId?: string } | null;
              if (v?.userId) users.add(v.userId);
            });
          }
          seatUsers.set(id, users);
          recompute();
        }),
        onValue(audRef, (snap) => {
          audCounts.set(id, snap.exists() ? snap.size : 0);
          recompute();
        }),
      );
    }

    recompute();

    return () => {
      for (const u of unsubs) u();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return counts;
}
