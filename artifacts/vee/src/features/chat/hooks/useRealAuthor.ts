import { useEffect, useState } from 'react';
import { get, ref } from 'firebase/database';
import { database } from '@/src/config/firebase';

// Cache to avoid refetching the same user repeatedly.
const authorCache = new Map<string, { name: string; avatar?: string }>();

const PLACEHOLDER_NAMES = new Set(['Vee User', 'You', '', 'Vee user', 'vee user']);

/**
 * Resolve the real author name/avatar for a story.
 * Falls back to RTDB users/{uid} when the stored name is a placeholder
 * (old stories published before the 2026-10-11 publishing fix).
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
    if (!userId) return;
    // Already have a real name — no fetch needed.
    if (!PLACEHOLDER_NAMES.has(fallbackName)) {
      setResolved({ name: fallbackName, avatar: fallbackAvatar });
      return;
    }
    // Check cache.
    const cached = authorCache.get(userId);
    if (cached) {
      setResolved(cached);
      return;
    }
    // Fetch real name/avatar from RTDB.
    let cancelled = false;
    (async () => {
      try {
        const [nameSnap, avatarSnap] = await Promise.all([
          get(ref(database, `users/${userId}/name`)),
          get(ref(database, `users/${userId}/photoURL`)),
        ]);
        if (cancelled) return;
        const name = nameSnap.exists() && nameSnap.val() ? (nameSnap.val() as string) : fallbackName;
        const avatar = avatarSnap.exists() && avatarSnap.val() ? (avatarSnap.val() as string) : fallbackAvatar;
        const result = { name, avatar };
        authorCache.set(userId, result);
        setResolved(result);
      } catch {
        // Keep fallback on error.
      }
    })();
    return () => { cancelled = true; };
  }, [userId, fallbackName, fallbackAvatar]);

  return resolved;
}

/** Clear the author cache (e.g. after profile update). */
export function clearAuthorCache(userId?: string): void {
  if (userId) authorCache.delete(userId);
  else authorCache.clear();
}
