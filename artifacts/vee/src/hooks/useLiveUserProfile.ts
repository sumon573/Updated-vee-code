import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { database } from '../config/firebase';

export interface LiveUserProfile {
  name: string | null;
  avatar: string | null;
}

/**
 * 2026-10-14 (Sumon): Hook to get a user's LIVE name and avatar.
 * 
 * PERMANENT FIX for "Unknown" name + missing DP:
 * - Listens DIRECTLY to users/{uid} in real-time
 * - If ID has a name set → shows THAT name (never "Unknown", never "Vee User")
 * - If ID has a DP → shows THAT DP
 * - Only falls back to "Vee User" if the user genuinely has no name
 * - Updates LIVE if user changes their name/DP (no stale cache)
 * 
 * This replaces the one-time refresh logic that could fail silently.
 */
export function useLiveUserProfile(uid: string | undefined | null): LiveUserProfile {
  const [profile, setProfile] = useState<LiveUserProfile>({ name: null, avatar: null });

  useEffect(() => {
    if (!uid) {
      setProfile({ name: null, avatar: null });
      return;
    }

    // Real-time listener on the user's profile
    const unsub = onValue(ref(database, `users/${uid}`), (snap) => {
      if (!snap.exists()) {
        setProfile({ name: null, avatar: null });
        return;
      }
      const u = snap.val();
      // Use || (not ??) — database can hold empty-string names
      const name = (u.name || u.displayName || '').trim() || null;
      const avatar = u.photoURL || u.avatar || u.dp || null;
      setProfile({ name, avatar });
    });

    return () => unsub();
  }, [uid]);

  return profile;
}

/**
 * Returns the display name: live name if available, "Vee User" as fallback.
 * Use this in chat lists, contacts, anywhere a user name is shown.
 */
export function displayName(liveName: string | null | undefined, fallbackName?: string | null): string {
  if (liveName && liveName.trim().length > 0 && liveName !== 'Unknown') {
    return liveName.trim();
  }
  if (fallbackName && fallbackName.trim().length > 0 && fallbackName !== 'Unknown') {
    return fallbackName.trim();
  }
  return 'Vee User';
}
