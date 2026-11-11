import { useEffect, useState } from 'react';
import { subscribeLiveUserProfile } from '@/src/hooks/useLiveUserProfile';

// 2026-11-11 (boss: photo change shows EVERYWHERE): the story author
// name/avatar is LIVE now, not a publish-time snapshot. The old hook only
// fetched users/{uid} when the stored name was a placeholder — and even
// then it cached the result for 10 minutes — so an author who changed
// their photo kept showing the OLD photo in the story viewer (and Planet)
// until the story expired. Now the ref-counted live hub
// (subscribeLiveUserProfile, one shared RTDB listener per uid) pushes
// every name/photo change instantly; the stored snapshot stays ONLY as
// the first-paint fallback until the live value arrives (the hub fires
// nulls first when no listener exists yet, so nulls never overwrite it).
const PLACEHOLDER_NAMES = new Set(['Vee User', 'You', '', 'Vee user', 'vee user']);

/**
 * Resolve the real author name/avatar for a story.
 * Falls back to the stored snapshot (old stories published before the
 * 2026-10-11 publishing fix) until the live profile arrives; the live
 * RTDB users/{uid} name/photo then win, and keep winning on every change.
 */
export function useRealAuthor(
  userId: string | undefined,
  fallbackName: string,
  fallbackAvatar?: string,
): { name: string; avatar?: string } {
  const [resolved, setResolved] = useState<{ name: string; avatar?: string }>({
    name: fallbackName,
    avatar: fallbackAvatar,
  });

  useEffect(() => {
    // Stored snapshot is the first paint — never a blank while live loads.
    setResolved({ name: fallbackName, avatar: fallbackAvatar });
    if (!userId) return;
    return subscribeLiveUserProfile(userId, (live) => {
      setResolved({
        // Live name wins when real; a placeholder stored name must never
        // overwrite it, and a null live name must never blank the stored one.
        name: (live.name && !PLACEHOLDER_NAMES.has(live.name)) ? live.name : fallbackName,
        avatar: live.avatar ?? fallbackAvatar,
      });
    });
  }, [userId, fallbackName, fallbackAvatar]);

  return resolved;
}

/** Kept for import compatibility — the live hub owns invalidation now. */
export function clearAuthorCache(_userId?: string): void {}
