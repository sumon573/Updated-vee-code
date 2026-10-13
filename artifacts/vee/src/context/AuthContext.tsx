/**
 * Auth Context — provides authenticated user to the entire app.
 * Uses Firebase onAuthStateChanged with AsyncStorage persistence.
 *
 * BUG 12 fix: Add a 10-second timeout fallback so the loading state can
 * never stay true forever (e.g. if Firebase auth takes too long on a slow
 * network after a crash or profile update).
 * BUG 17 fix: Every async path now has a maximum wait time so the app
 * never becomes permanently stuck on the loading screen.
 */

import React, {
  createContext, useContext, useEffect, useRef, useState, useCallback,
} from 'react';
import { AppState } from 'react-native';
import { User } from 'firebase/auth';
import { onUserStateChanged, logout as firebaseLogout } from '../services/authService';
import { withTimeout } from '../utils/withTimeout';
import {
  setupPresence, setUserOffline, getUser, setUserVId, generateAndReserveVId,
} from '../services/userService';
import generateVId from '../utils/generateVId';

/** Maximum ms to wait for the first Firebase auth-state callback. */
const AUTH_LOADING_TIMEOUT_MS = 10_000;

/**
 * Ensure the given user has a permanent Vee ID. Accounts created before the
 * Vee ID system existed (or created through a flow that skipped reservation)
 * are backfilled here exactly once, since this runs on every auth-state
 * change. The ID is never re-generated or edited if one already exists.
 */
async function backfillVIdIfMissing(uid: string): Promise<void> {
  try {
    const existing = await getUser(uid);
    if (!existing || existing.vId) return; // already has a permanent vId — never touch it

    const vId = await generateAndReserveVId(uid, generateVId);
    await setUserVId(uid, vId);
  } catch {
    // non-critical — silently ignore
  }
}

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
  isBanned: boolean;
  banReason: string | null;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  logout: async () => {},
  isBanned: false,
  banReason: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const loadingDoneRef = useRef(false);
  // BAN ENFORCEMENT (2026-10-13): real-time ban check. When admin bans a user
  // via the admin panel, the app blocks them immediately with a banned screen.
  const [isBanned, setIsBanned] = useState(false);
  const [banReason, setBanReason] = useState<string | null>(null);
  const banUnsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // BUG 12/17 fix: Safety timeout — if Firebase never fires onAuthStateChanged
    // (offline start, corrupted token, etc.) force-unblock the loading screen
    // after AUTH_LOADING_TIMEOUT_MS so the app never stays permanently stuck.
    const timeoutId = setTimeout(() => {
      if (!loadingDoneRef.current) {
        loadingDoneRef.current = true;
        setLoading(false);
      }
    }, AUTH_LOADING_TIMEOUT_MS);

    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = onUserStateChanged((firebaseUser) => {
        setUser(firebaseUser);

        // BAN ENFORCEMENT: subscribe to banned flag. If admin bans this user,
        // kick them out immediately with a banned screen.
        if (banUnsubscribeRef.current) {
          banUnsubscribeRef.current();
          banUnsubscribeRef.current = null;
        }
        if (firebaseUser) {
          // Reset ban state on new login, then subscribe
          setIsBanned(false);
          setBanReason(null);
          import('../config/firebase').then(({ database }) => {
            import('firebase/database').then(({ ref, onValue }) => {
              const banRef = ref(database, `users/${firebaseUser.uid}/banned`);
              const reasonRef = ref(database, `users/${firebaseUser.uid}/banReason`);
              const unsubBan = onValue(banRef, (snap) => {
                const banned = snap.val() === true;
                if (banned) {
                  // Fetch reason, then force logout and show banned screen
                  import('firebase/database').then(({ get }) => {
                    get(reasonRef).then((rSnap) => {
                      setBanReason(typeof rSnap.val() === 'string' ? rSnap.val() : null);
                    }).catch(() => {});
                  }).catch(() => {});
                  setIsBanned(true);
                  // Sign out silently — banned screen takes over
                  firebaseLogout().catch(() => {});
                  setUser(null);
                }
              });
              banUnsubscribeRef.current = unsubBan;
            }).catch(() => {});
          }).catch(() => {});
        } else {
          setIsBanned(false);
          setBanReason(null);
        }

        // Clear loading on the first callback (and any subsequent ones)
        if (!loadingDoneRef.current) {
          loadingDoneRef.current = true;
          clearTimeout(timeoutId);
        }
        setLoading(false);

        // Set up real-time presence when user logs in. These are deliberately
        // non-blocking: presence/profile repair must never gate navigation.
        if (firebaseUser) {
          try {
            setupPresence(firebaseUser.uid);
          } catch {
            // Presence is optional during startup; auth/navigation must continue.
          }
          backfillVIdIfMissing(firebaseUser.uid).catch(() => {/* background: safe to swallow — Vee ID backfill retries on next login */});
          // FIX (2026-10-12): Backfill Google Auth profile data to DB if empty.
          // Google users may have empty DB name/photoURL (only visible to themselves
          // via Auth fallback). Others see empty. Copy from Auth if DB is empty.
          (async () => {
            try {
              const { getUser, updateUser } = await import('@/src/services/userService');
              const profile = await getUser(firebaseUser.uid);
              if (profile) {
                const updates: Record<string, string> = {};
                if (!profile.name && firebaseUser.displayName) {
                  updates.name = firebaseUser.displayName;
                }
                if (!profile.photoURL && firebaseUser.photoURL) {
                  updates.photoURL = firebaseUser.photoURL;
                }
                if (Object.keys(updates).length > 0) {
                  await updateUser(firebaseUser.uid, updates);
                }
              }
            } catch {/* background: safe — retries on next login */}
          })();
          // FIX (2026-10-10): Initialize wallet on login so gift send works.
          // Previously wallets were only created in GiftsModal (errors swallowed),
          // leaving most users without wallets → "Insufficient balance" on gift send.
          import('@/src/features/wallet/walletService').then(({ initializeWallet }) => {
            initializeWallet(firebaseUser.uid).catch(() => {/* background: safe — retries on next login */});
          }).catch(() => {});
        }
      });
    } catch {
      // A malformed/corrupt persisted auth state must fail closed and send the
      // user to login, not leave the provider rendering an endless spinner.
      loadingDoneRef.current = true;
      clearTimeout(timeoutId);
      setUser(null);
      setLoading(false);
    }

    return () => {
      clearTimeout(timeoutId);
      unsubscribe?.();
      if (banUnsubscribeRef.current) {
        banUnsubscribeRef.current();
        banUnsubscribeRef.current = null;
      }
    };
  }, []);

  // PRESENCE FIX (2026-10-10): setupPresence ran only on login. When the app
  // was backgrounded, Firebase onDisconnect marked the user offline — but
  // foregrounding the app never set online=true again (no re-login), so the
  // user stayed "offline" forever: callers saw "Calling" instead of "Ringing"
  // and inbox ticks never upgraded. Re-register presence on every foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && user) {
        try {
          setupPresence(user.uid);
        } catch {
          // Non-critical — next foreground retry will repair it.
        }
      }
    });
    return () => sub.remove();
  }, [user]);

  const logout = useCallback(async () => {
    if (user) {
      // Mark offline before signing out — with timeout so offline hang doesn't block logout
      await withTimeout(setUserOffline(user.uid), 3000).catch(() => {/* background: safe to swallow — onDisconnect hook marks offline anyway */});
    }
    await firebaseLogout();
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, logout, isBanned, banReason }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Access auth state anywhere in the app */
export function useAuth() {
  return useContext(AuthContext);
}
