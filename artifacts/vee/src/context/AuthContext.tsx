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
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const loadingDoneRef = useRef(false);

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
    };
  }, []);

  const logout = useCallback(async () => {
    if (user) {
      // Mark offline before signing out — with timeout so offline hang doesn't block logout
      await withTimeout(setUserOffline(user.uid), 3000).catch(() => {/* background: safe to swallow — onDisconnect hook marks offline anyway */});
    }
    await firebaseLogout();
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Access auth state anywhere in the app */
export function useAuth() {
  return useContext(AuthContext);
}
