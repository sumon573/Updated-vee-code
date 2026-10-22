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

import { useEffect, useRef, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { database } from '@/src/config/firebase';

export function useLiveAudienceCounts(roomIds: string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Stable key so the effect only re-subscribes when the room set changes.
  const key = [...roomIds].sort().join(',');
  const lastJsonRef = useRef('');

  useEffect(() => {
    if (!key) {
      if (lastJsonRef.current !== '{}') {
        lastJsonRef.current = '{}';
        setCounts({});
      }
      return;
    }
    const ids = key.split(',').filter(Boolean);
    const unsubs: Array<() => void> = [];
    // Per-room seat-user sets + LIVE audience-user sets; recompute on change.
    const seatUsers = new Map<string, Set<string>>();
    const audUsers = new Map<string, Set<string>>();

    const recompute = () => {
      const next: Record<string, number> = {};
      for (const id of ids) {
        // 2026-10-22: TRUE UNION count. Seated users now KEEP their
        // audience entry (chat access), so seats + audience must be
        // deduped by uid — a plain sum double-counts everyone seated.
        const union = new Set<string>(seatUsers.get(id) ?? []);
        for (const uid of audUsers.get(id) ?? []) union.add(uid);
        next[id] = union.size;
      }
      // Equality guard (2026-10-22 perf audit): heartbeat snapshots fire
      // constantly; only setState when a visible count actually changed,
      // so the room-home screen stops re-rendering on every heartbeat.
      const json = JSON.stringify(next);
      if (json === lastJsonRef.current) return;
      lastJsonRef.current = json;
      setCounts(next);
    };

    for (const id of ids) {
      seatUsers.set(id, new Set());
      audUsers.set(id, new Set());
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
          // 2026-10-20 (boss): count only LIVE audience — entries with a fresh
          // heartbeat (<150s). Ghosts (crashed sessions whose onDisconnect
          // never fired, pre-heartbeat entries with no ts) must not make an
          // empty room show members.
          const live = new Set<string>();
          if (snap.exists()) {
            const now = Date.now();
            snap.forEach((child) => {
              const a = child.val() as { ts?: number; userId?: string } | null;
              if (typeof a?.ts === 'number' && now - a.ts < 150_000) {
                live.add(a.userId ?? (child.key as string));
              }
            });
          }
          audUsers.set(id, live);
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
