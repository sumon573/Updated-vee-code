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
import type { VeeUser } from '../services/userService';
import generateVId from '../utils/generateVId';

/** Maximum ms to wait for the first Firebase auth-state callback. */
const AUTH_LOADING_TIMEOUT_MS = 10_000;

/**
 * Result of the single shared users/{uid} read per auth callback.
 * `ok:false` means the read itself failed — consumers must treat that as
 * "unknown", NOT as "no profile" (fail-soft: retry on next callback).
 */
type SharedProfile = { profile: VeeUser | null; ok: boolean };

/**
 * Ensure the given user has a permanent Vee ID. Accounts created before the
 * Vee ID system existed (or created through a flow that skipped reservation)
 * are backfilled here exactly once, since this runs on every auth-state
 * change. The ID is never re-generated or edited if one already exists.
 * 2026-10-19 perf: takes the shared profile snapshot instead of its own
 * getUser read.
 */
async function backfillVIdIfMissing(uid: string, shared: SharedProfile): Promise<void> {
  try {
    if (!shared.ok) return; // read failed — retry on next callback
    const existing = shared.profile;
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
  /**
   * 2026-10-19 polish: true when the 10s fail-open safety timeout fired
   * BEFORE any onAuthStateChanged callback arrived (slow network, offline
   * start). Callers must hold a neutral "retrying" state — never route to
   * /auth/login — until the first real auth callback clears this flag.
   */
  authTimedOut: boolean;
  logout: () => Promise<void>;
  isBanned: boolean;
  banReason: string | null;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  authTimedOut: false,
  logout: async () => {},
  isBanned: false,
  banReason: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authTimedOut, setAuthTimedOut] = useState(false);
  const loadingDoneRef = useRef(false);
  // BAN ENFORCEMENT (2026-10-13): real-time ban check. When admin bans a user
  // via the admin panel, the app blocks them immediately with a banned screen.
  const [isBanned, setIsBanned] = useState(false);
  const [banReason, setBanReason] = useState<string | null>(null);
  const banUnsubscribeRef = useRef<(() => void) | null>(null);
  // 2026-10-19 stability fix: the auth callback re-fires on token refresh —
  // the ban listener must be subscribed once per UID, not torn down and
  // re-subscribed on every callback. Tracks which UID owns the live listener.
  const banListenerUidRef = useRef<string | null>(null);
  // 2026-10-13 (Sumon): ban race fix — setUser(null) triggers onUserStateChanged(null)
  // which would reset isBanned. This ref preserves the banned state.
  const bannedSessionRef = useRef(false);
  // 2026-10-13: কোন UID ban হয়েছে track করি — ভিন্ন user login করলে reset।
  const bannedUidRef = useRef<string | null>(null);

  useEffect(() => {
    // 2026-10-17 (Sumon): Load server-driven Nobel rewards at startup.
    // Non-blocking — falls back to hardcoded if Firebase unreachable.
    import('@/src/services/nobleRewardsCatalog').then(({ loadServerNobleRewards }) => {
      loadServerNobleRewards().catch(() => {});
    }).catch(() => {});

    // BUG 12/17 fix: Safety timeout — if Firebase never fires onAuthStateChanged
    // (offline start, corrupted token, etc.) force-unblock the loading screen
    // after AUTH_LOADING_TIMEOUT_MS so the app never stays permanently stuck.
    // 2026-10-19 polish: the timeout sets authTimedOut, NOT a route to
    // /auth/login — a slow network must not flash the login screen before the
    // first real auth callback arrives. _layout holds a neutral "retrying"
    // state while authTimedOut && !user.
    const timeoutId = setTimeout(() => {
      if (!loadingDoneRef.current) {
        loadingDoneRef.current = true;
        setLoading(false);
        setAuthTimedOut(true);
      }
    }, AUTH_LOADING_TIMEOUT_MS);

    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = onUserStateChanged((firebaseUser) => {
        setUser(firebaseUser);

        // 2026-10-19 perf fix: ONE users/{uid} read per auth callback, shared
        // by the ban check, Vee-ID backfill, and profile name-repair below —
        // previously each did its own read (3× the cost on every callback,
        // including hourly token refreshes). `ok:false` = read failed:
        // consumers must treat it as unknown, never as "no profile".
        const sharedProfile: Promise<SharedProfile> = firebaseUser
          ? getUser(firebaseUser.uid).then(
            (profile) => ({ profile, ok: true as const }),
            () => ({ profile: null, ok: false as const }),
          )
          : Promise.resolve({ profile: null, ok: true as const });

        // 2026-10-17 (Sumon): EXISTING USERS — ensure Vee Team system chat
        // exists on every login/app-start (not just signup). Safe to call
        // repeatedly — welcome message is deduped. Fire-and-forget.
        if (firebaseUser && firebaseUser.uid) {
          import('@/src/features/chat/services/veeTeamService').then(({ ensureVeeTeamChat }) => {
            const name = firebaseUser.displayName || 'User';
            ensureVeeTeamChat(firebaseUser.uid, name).catch(() => {});
          }).catch(() => {});
        }

        // BAN ENFORCEMENT: subscribe to banned flag. If admin bans this user,
        // kick them out immediately with a banned screen.
        // 2026-10-13: banned session-এ listener alive রাখি — unban detect করতে।
        // ভিন্ন UID login করলে পুরনো ban state clear করি।
        // 2026-10-13 (Sumon): unban-এর পর re-login fix — login-এ fresh ban status
        // check করি। Logout-এর পর listener auth ছাড়া read করতে পারে না, তাই
        // unban detect হয় না। Login-এ Firebase থেকে current banned flag পড়ে
        // সিদ্ধান্ত নিই — unbanned হলে ban state clear করে login allow করি।
        if (firebaseUser) {
          // 2026-10-19 perf: ban flag comes from the shared profile snapshot
          // instead of a second users/{uid}/banned read. A failed read
          // (ok:false) preserves the current ban state — same as the old
          // .catch(()=>{}) on the direct get.
          sharedProfile.then(({ profile, ok }) => {
            if (!ok) return;
            const currentlyBanned = profile?.banned === true;
            if (!currentlyBanned && bannedUidRef.current === firebaseUser.uid) {
              // Was banned, now unbanned — clear stale ban state, allow login
              bannedSessionRef.current = false;
              bannedUidRef.current = null;
              setIsBanned(false);
              setBanReason(null);
            } else if (currentlyBanned) {
              // Still banned — enforce ban screen
              bannedSessionRef.current = true;
              bannedUidRef.current = firebaseUser.uid;
              setIsBanned(true);
              firebaseLogout().catch(() => {});
              setUser(null);
              return;
            }
            // Different UID — clear old ban state
            if (bannedUidRef.current && firebaseUser.uid !== bannedUidRef.current) {
              bannedSessionRef.current = false;
              bannedUidRef.current = null;
            }
          }).catch(() => {});
        }
        if (firebaseUser) {
          // Reset ban state on new login, then subscribe
          // 2026-10-13: banned session থেকে logout হলে reset করি না
          if (!bannedSessionRef.current) {
            setIsBanned(false);
            setBanReason(null);
          }
          // 2026-10-19 stability fix: subscribe the ban listener ONCE per
          // UID. The auth callback re-fires on token refresh — the old code
          // tore the listener down and re-subscribed on every callback.
          if (banListenerUidRef.current !== firebaseUser.uid) {
            const prevUnsub = banUnsubscribeRef.current;
            banUnsubscribeRef.current = null;
            if (prevUnsub) prevUnsub();
            const subscribeUid = firebaseUser.uid;
            banListenerUidRef.current = subscribeUid;
            import('../config/firebase').then(({ database }) => {
              import('firebase/database').then(({ ref, onValue }) => {
                const banRef = ref(database, `users/${subscribeUid}/banned`);
                const reasonRef = ref(database, `users/${subscribeUid}/banReason`);
                const unsubBan = onValue(banRef, (snap) => {
                  const banned = snap.val() === true;
                  if (banned) {
                    // 2026-10-13 (Sumon): ban race fix — banned session mark করি
                    // যাতে setUser(null) → onUserStateChanged(null) isBanned reset না করে।
                    bannedSessionRef.current = true;
                    bannedUidRef.current = subscribeUid;
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
                  } else if (bannedSessionRef.current) {
                    // Unbanned while banned screen showing — clear and allow re-login
                    bannedSessionRef.current = false;
                    bannedUidRef.current = null;
                    setIsBanned(false);
                    setBanReason(null);
                  }
                }, (e) => {
                  // 2026-10-19 polish: a dead ban listener must not silently
                  // disable ban enforcement. Log, then do ONE delayed one-shot
                  // re-check (no resubscribe loop — a permanent error like
                  // permission-denied would spin forever).
                  console.warn('[AuthContext] ban listener error:', (e as Error)?.message || e);
                  setTimeout(() => {
                    if (banListenerUidRef.current !== subscribeUid || bannedSessionRef.current) return;
                    import('firebase/database').then(({ get }) => {
                      get(banRef).then((s) => {
                        if (s.val() === true) {
                          bannedSessionRef.current = true;
                          bannedUidRef.current = subscribeUid;
                          setIsBanned(true);
                          firebaseLogout().catch(() => {});
                          setUser(null);
                        }
                      }).catch(() => {});
                    }).catch(() => {});
                  }, 10000);
                });
                // The UID may have moved on while the dynamic import was
                // resolving — the newer subscribe path owns the ref now, so
                // drop this stale subscription instead of orphaning it.
                if (banListenerUidRef.current === subscribeUid) {
                  if (banUnsubscribeRef.current) banUnsubscribeRef.current();
                  banUnsubscribeRef.current = unsubBan;
                } else {
                  unsubBan();
                }
              }).catch(() => {});
            }).catch(() => {});
          }
        } else {
          // 2026-10-13: banned session-এ logout হলে ban screen ধরে রাখি —
          // listener alive রাখি যাতে unban detect হয়।
          if (!bannedSessionRef.current) {
            if (banUnsubscribeRef.current) {
              banUnsubscribeRef.current();
              banUnsubscribeRef.current = null;
            }
            banListenerUidRef.current = null;
            setIsBanned(false);
            setBanReason(null);
          }
        }

        // Clear loading on the first callback (and any subsequent ones)
        if (!loadingDoneRef.current) {
          loadingDoneRef.current = true;
          clearTimeout(timeoutId);
        }
        setLoading(false);
        // 2026-10-19 polish: the first real auth callback ends the neutral
        // "retrying" state — routing may now proceed normally.
        setAuthTimedOut(false);

        // Set up real-time presence when user logs in. These are deliberately
        // non-blocking: presence/profile repair must never gate navigation.
        if (firebaseUser) {
          try {
            setupPresence(firebaseUser.uid);
          } catch {
            // Presence is optional during startup; auth/navigation must continue.
          }
          // 2026-10-19 perf: backfill shares the single profile snapshot —
          // no second getUser read.
          sharedProfile
            .then((shared) => backfillVIdIfMissing(firebaseUser.uid, shared))
            .catch(() => {/* background: safe to swallow — Vee ID backfill retries on next login */});
          // FIX (2026-10-12): Backfill Google Auth profile data to DB if empty.
          // Google users may have empty DB name/photoURL (only visible to themselves
          // via Auth fallback). Others see empty. Copy from Auth if DB is empty.
          // FIX (2026-10-15, Sumon): CREATE the DB profile if it doesn't exist at
          // all (fail-open timeout can let users into home with no DB profile —
          // then everyone sees them as "Vee User" with no name/DP).
          (async () => {
            try {
              const { updateUser, createUser } = await import('@/src/services/userService');
              // 2026-10-19 perf: reuse the shared profile snapshot — no third
              // getUser read. A failed read (ok:false) skips repair entirely
              // (same as the old catch-and-swallow) — it must NOT fall into
              // the !profile branch, which would createUser-clobber a profile
              // we simply failed to read.
              const { profile, ok } = await sharedProfile;
              if (!ok) return;
              if (!profile) {
                // No DB profile — create one from Auth data so others see the
                // real name/DP. Vee ID backfill (above) handles the vId.
                // 2026-10-15 (Sumon): Google sign-in MUST use the Google
                // account name — never fall back to generic 'User'. Reload
                // first so displayName is fresh from the provider.
                let googleName = firebaseUser.displayName || '';
                let googlePhoto = firebaseUser.photoURL || '';
                try {
                  await firebaseUser.reload();
                  googleName = firebaseUser.displayName || googleName;
                  googlePhoto = firebaseUser.photoURL || googlePhoto;
                } catch { /* reload is best-effort */ }
                // Also check provider data (Google provider may have it even
                // if top-level displayName is empty).
                if (!googleName && Array.isArray((firebaseUser as any).providerData)) {
                  for (const p of (firebaseUser as any).providerData) {
                    if (p && p.displayName) { googleName = p.displayName; break; }
                  }
                  if (!googlePhoto) {
                    for (const p of (firebaseUser as any).providerData) {
                      if (p && p.photoURL) { googlePhoto = p.photoURL; break; }
                    }
                  }
                }
                const fallbackName = firebaseUser.email
                  ? firebaseUser.email.split('@')[0]
                  : `Vee${firebaseUser.uid.slice(0, 6)}`;
                await createUser({
                  uid: firebaseUser.uid,
                  vId: '',
                  name: googleName || fallbackName,
                  email: firebaseUser.email ?? '',
                  photoURL: googlePhoto,
                  bio: '',
                  createdAt: Date.now(),
                  lastSeen: Date.now(),
                  online: true,
                  // 2026-10-19 onboarding fix: mark auto-created profiles
                  // incomplete — AuthGuard routes on this flag (not mere
                  // existence) so new users always land on complete-profile,
                  // which then REUSES the already-reserved vId.
                  profileComplete: false,
                }).catch(() => {});
              } else {
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
    // 2026-10-14 Bug #1 fix (Sumon): Logout must clean up voice room session.
    // Without this: minimize bar persists in new account, user ghosts in room,
    // mic stays on in background. Must-fix before market release.
    // 2026-10-14 (Sumon): Also clean up when IN room (not minimized) and when
    // app was killed with ID in room. Check currentRoom + minimizedRoom.
    try {
      const { getMinimizedRoom, setMinimizedRoom, getCurrentRoom, clearCurrentRoom } = await import('../store/minimizedRoom');
      const minimized = getMinimizedRoom();
      const current = getCurrentRoom();
      // Use current room if in room, otherwise minimized room
      const roomToClean = current || minimized;
      if (roomToClean) {
        try {
          const { destroyPersistedVoiceRoomEngine } = await import('../features/voice-room/useLivekitVoiceRoom');
          destroyPersistedVoiceRoomEngine();
        } catch {}
        try {
          const { removeSeat, leaveAudience } = await import('../features/voice-room/services/firebaseRoomService');
          if (roomToClean.mySeatIdx >= 0) {
            await removeSeat(roomToClean.id, roomToClean.mySeatIdx).catch(() => {});
            await leaveAudience(roomToClean.id, roomToClean.myUid).catch(() => {});
          } else {
            await leaveAudience(roomToClean.id, roomToClean.myUid).catch(() => {});
          }
        } catch {}
        setMinimizedRoom(null);
        clearCurrentRoom();
      }
    } catch {}
    if (user) {
      // Mark offline before signing out — with timeout so offline hang doesn't block logout
      await withTimeout(setUserOffline(user.uid), 3000).catch(() => {/* background: safe to swallow — onDisconnect hook marks offline anyway */});
      // 2026-10-19 (batch 2D): delete THIS device's per-device FCM token
      // BEFORE sign-out (rules require auth) so a logged-out device stops
      // receiving the user's pushes.
      await import('../services/fcmPushService').then(({ unregisterFcmToken }) =>
        unregisterFcmToken(user.uid).catch(() => {})
      ).catch(() => {});
    }
    await firebaseLogout();
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, authTimedOut, logout, isBanned, banReason }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Access auth state anywhere in the app */
export function useAuth() {
  return useContext(AuthContext);
}
