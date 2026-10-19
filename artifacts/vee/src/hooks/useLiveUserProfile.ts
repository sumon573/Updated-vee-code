import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { database } from '../config/firebase';

export interface LiveUserProfile {
  name: string | null;
  avatar: string | null;
}

/**
 * 2026-10-14 (Sumon): live name and avatar for a user.
 *
 * PERMANENT FIX for "Unknown" name + missing DP:
 * - Listens DIRECTLY to users/{uid} in real-time
 * - If ID has a name set → shows THAT name (never "Unknown", never "Vee User")
 * - If ID has a DP → shows THAT DP
 * - Only falls back to "Vee User" if the user genuinely has no name
 * - Updates LIVE if user changes their name/DP (no stale cache)
 *
 * This replaces the one-time refresh logic that could fail silently.
 *
 * 2026-10-19 (stability): module-level ref-counted subscription cache.
 * Previously every chat-list row attached its own onValue(users/{uid})
 * listener. Now one shared subscription per uid: the first mounted row
 * attaches it, every other row for the same uid reuses it, and the last
 * unmount detaches. Subscribers are only notified when name/avatar actually
 * change, so unchanged snapshots don't re-render rows.
 */

function parseProfile(u: any): LiveUserProfile {
  // Use || (not ??) — database can hold empty-string names
  const name = (u.name || u.displayName || '').trim() || null;
  const avatar = u.photoURL || u.avatar || u.dp || null;
  return { name, avatar };
}

function sameProfile(a: LiveUserProfile, b: LiveUserProfile): boolean {
  return a.name === b.name && a.avatar === b.avatar;
}

interface ProfileEntry {
  profile: LiveUserProfile;
  refCount: number;
  listeners: Set<(p: LiveUserProfile) => void>;
  unsub: (() => void) | null;
}

/** Module-level: one subscription per uid, shared across every mounted row. */
const profileCache = new Map<string, ProfileEntry>();

function ensureProfileSubscription(uid: string): ProfileEntry {
  const existing = profileCache.get(uid);
  if (existing) return existing;

  const entry: ProfileEntry = {
    profile: { name: null, avatar: null },
    refCount: 0,
    listeners: new Set(),
    unsub: null,
  };

  // Real-time listener on the user's profile (single per uid)
  entry.unsub = onValue(ref(database, `users/${uid}`), (snap) => {
    const next: LiveUserProfile = snap.exists()
      ? parseProfile(snap.val())
      : { name: null, avatar: null };
    if (!sameProfile(next, entry.profile)) {
      entry.profile = next;
      for (const cb of entry.listeners) {
        try { cb(next); } catch { /* one bad listener must not break the rest */ }
      }
    }
  }, (e) => {
    // 2026-10-19 polish: never let a listener error silently freeze every
    // row on a stale profile — keep serving the last-known value and log.
    console.warn('[useLiveUserProfile] listener error:', (e as Error)?.message || e);
  });

  profileCache.set(uid, entry);
  return entry;
}

/**
 * Subscribe to a uid's live profile. Ref-counted: the first subscriber
 * attaches the single RTDB listener, the last unsubscriber detaches it.
 * The callback fires immediately with the current value.
 */
export function subscribeLiveUserProfile(
  uid: string,
  cb: (p: LiveUserProfile) => void,
): () => void {
  const entry = ensureProfileSubscription(uid);
  entry.refCount += 1;
  entry.listeners.add(cb);
  cb(entry.profile);
  return () => {
    entry.listeners.delete(cb);
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      try { entry.unsub?.(); } catch { /* ignore */ }
      profileCache.delete(uid);
    }
  };
}

export function useLiveUserProfile(uid: string | undefined | null): LiveUserProfile {
  const [profile, setProfile] = useState<LiveUserProfile>(() =>
    uid ? profileCache.get(uid)?.profile ?? { name: null, avatar: null } : { name: null, avatar: null },
  );

  useEffect(() => {
    if (!uid) {
      setProfile({ name: null, avatar: null });
      return;
    }
    return subscribeLiveUserProfile(uid, setProfile);
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
