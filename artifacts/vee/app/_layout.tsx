import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Modal, Text, Pressable, Image, I18nManager, AppState } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';

/**
 * CRASH CAUSE DISPLAY (2026-10-11, Sumon's rule): every JS error must show
 * its real cause on screen. Installed FIRST, before anything else.
 * NOTE: native startup crashes (before JS loads) cannot be caught by JS.
 */
import { installGlobalCrashHandler, CrashOverlay } from '@/src/utils/crashReporter';
import { HonorCelebration } from '@/src/components/HonorCelebration';
import NobleLevelUpCelebration from '@/src/features/nobel/NobleLevelUpCelebration';
// 2026-10-19 import-order fix (CRASH-RISK: import-time throws) — fail-soft
// module init: a throw here must never kill the root layout. The reporter
// also self-installs at its own module scope (see crashReporter.tsx), which
// runs before every import below — so this explicit call is normally a no-op
// via the idempotency flag, and this try/catch only guards the pathological
// case. Import bindings themselves are unchanged when they succeed.
try {
  installGlobalCrashHandler();
} catch {
  /* crash overlay stays uninstalled — the app still boots */
}

/**
 * PERMANENT GUARD (2026-10-09): RTL layout is disabled for the entire app.
 * Selecting Arabic used to call I18nManager.forceRTL(true), which mirrored
 * every screen and left the app permanently garbled. No screen was ever
 * designed or tested for RTL, so per the "no setting may ever break the
 * app" rule, LTR is now enforced at the root: even if some persisted or
 * future code path ever flips the RTL flag, React Native will NOT mirror
 * the layout. This also instantly heals devices currently stuck in the
 * mirrored state — no reinstall needed.
 */
try {
  I18nManager.allowRTL(false);
  I18nManager.forceRTL(false);
} catch {
  // Non-fatal: layout simply stays in its default direction.
}
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getPersistedActiveRoom, clearPersistedActiveRoom } from '@/src/store/activeRoom';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nextProvider } from 'react-i18next';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ErrorFallback, ErrorFallbackProps } from '@/components/ErrorFallback';
import { withTimeout } from '@/src/utils/withTimeout';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts } from '@expo-google-fonts/inter';
import { Stack, useRouter, useSegments, useGlobalSearchParams, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from '@/src/context/AuthContext';
import { getUser, type VeeUser } from '@/src/services/userService';
import { ThemeProvider } from '@/src/context/ThemeContext';
import { LanguageProvider, useLanguage } from '@/src/context/LanguageContext';
// Side-effect import: initialises i18next with all four language resources.
// Must be imported before any component that calls useTranslation().
import i18n from '@/src/i18n';
// Import type-augmentation so useTranslation() is fully typed everywhere.
import '@/src/i18n/types';
import { cleanExpiredStories } from '@/src/features/chat/services/firebaseStoryService';
import { ONESIGNAL_APP_ID } from '@/src/config/onesignal';
import {
  initializeOneSignal,
  loginOneSignal,
  logoutOneSignal,
  registerNotificationOpenedHandler } from '@/src/services/pushNotificationService';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  subscribeIncomingCall,
  removeCallSignal,
  cleanupCallSignal,
  updateCallSignal,
  type IncomingCall } from '@/src/features/audio-call/services/firebaseCallService';
import { isInteractionBlocked } from '@/src/services/blockService';
import { tryGetApiBase } from '@/src/utils/platform';
// NOTE 1 (2026-10-11): Global return-to-room bar for minimized voice rooms.
import MinimizedRoomBar from '@/src/features/voice-room/components/MinimizedRoomBar';
import RoomInvitePopup from '@/src/features/voice-room/components/RoomInvitePopup';
import CallMinimizeBar from '@/src/features/audio-call/components/CallMinimizeBar';
import {
  startIncomingCallAlert,
  stopIncomingCallAlert,
  dismissIncomingCallNotifications,
} from '@/src/features/audio-call/services/incomingCallRingtone';
import {
  isCallMinimizing,
  getMinimizedCall } from '@/src/features/audio-call/services/callMinimizeStore';
import { isVoiceRoomAudioActive } from '@/src/services/audioOwner';

// Expo can reject this call when the native splash screen has already been
// dismissed (for example after a fast reload). Never leave that rejection
// unhandled during the most fragile part of app startup.
void SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000 } } });

// ─── Auth + Language Guard ────────────────────────────────────────────────────
//
// Navigation rules (evaluated in order):
//   1. While loading (auth or language) → show spinner.
//   2. Language not yet selected + not already on language-select → go there.
//   3. Language selected, no user, not in auth group → go to login.
//   4. Language selected, user present, in auth group → go to home.

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading, authTimedOut, isBanned, banReason } = useAuth();
  const { isLanguageSelected, isLoading: langLoading } = useLanguage();
  const segments = useSegments();
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const redirectInFlightRef = useRef<string | null>(null);
  // 2026-10-12 audit fix (HIGH PUSH-1): pending notification deep link,
  // consumed once navigation is ready (see effect below).
  const pendingDeepLinkRef = useRef<(() => void) | null>(null);
  // 2026-10-19 stability fix: hoisted from the OneSignal effect so the FCM
  // tap handler uses the same guard. On cold start router.push() can be lost
  // (navigation not ready) — stash the deep link; the auth-redirect effect
  // consumes it once rootNavigationState is ready.
  const stashPendingLink = useCallback((fn: () => void) => {
    if (rootNavigationState?.key) {
      fn();
    } else {
      pendingDeepLinkRef.current = fn;
    }
  }, [rootNavigationState?.key]);
  // 2026-10-19 stability fix: ref mirror so the mount-once FCM effect below
  // always calls the latest stashPendingLink without re-running.
  const stashPendingLinkRef = useRef(stashPendingLink);
  stashPendingLinkRef.current = stashPendingLink;
  // 2026-10-19 stability fix (batch 2D): uid mirror for the mount-once FCM
  // tap handler below — official-notification routing needs the current uid
  // for buildChatId(uid, 'vee_team').
  const uidRef = useRef<string | null>(user?.uid || null);
  uidRef.current = user?.uid || null;
  // 2026-10-19 CRASH-RISK fix (incoming-call tap dead end): seeds the ringing
  // modal when an incoming-call push is tapped. Incoming-call pushes carry no
  // chatId, so the FCM tap handler used to no-op — with the app killed that
  // tap is the ONLY entry point and the call was silently missed.
  // The seeder verifies the RTDB call signal is STILL ALIVE before seeding
  // (a dead signal → stay silent), and applies the same guards as the live
  // IncomingCallListener path (audio-call screen, minimized call, voice-room
  // audio owner, block list). It NEVER pushes /audio-call with partial
  // params — the modal (and its own accept-time liveness check) owns the
  // transition to the call screen.
  const [pendingIncomingCall, setPendingIncomingCall] = useState<IncomingCall | null>(null);
  const seedPendingIncomingCallFromTap = useCallback(async (d: Record<string, any>) => {
    try {
      const uid = user?.uid;
      if (!uid) return;
      const callerUid = typeof d?.callerUid === 'string' ? d.callerUid : '';
      if ((segments as string[])?.[0] === 'audio-call') return;
      if (getMinimizedCall()) return;
      if (isVoiceRoomAudioActive()) return;
      if (callerUid) {
        const blocked = await isInteractionBlocked(uid, callerUid).catch(() => false);
        if (blocked) return;
      }
      const { get, ref } = await import('firebase/database');
      const { database } = await import('@/src/config/firebase');
      const snap = await get(ref(database, `calls/${uid}`));
      if (!snap.exists()) return; // caller cancelled/timed out — stay silent
      const call = snap.val() as IncomingCall;
      if ((call as { status?: string })?.status === 'accepted' &&
          (isCallMinimizing() || getMinimizedCall())) {
        return;
      }
      setPendingIncomingCall(call);
    } catch { /* non-critical — no modal is better than a crash */ }
  }, [user?.uid, segments]);
  // Ref mirror — the mount-once FCM effect calls the latest seeder.
  const seedPendingIncomingCallFromTapRef = useRef(seedPendingIncomingCallFromTap);
  seedPendingIncomingCallFromTapRef.current = seedPendingIncomingCallFromTap;
  // 2026-10-19 stability fix: room-invite push must never stack a second
  // voice-room modal over an active room — two VoiceRoomScreen instances =
  // two LiveKit engines on one mic (native crash territory). If a room is
  // already open: same room → ignore the tap; different room → dismiss the
  // current modal first so its engine tears down before the new one opens.
  // Ref mirrors keep the mount-once notification handler below reading fresh
  // navigation state.
  const segmentsRef = useRef<string[]>([]);
  segmentsRef.current = segments as string[];
  const globalParams = useGlobalSearchParams();
  const globalParamsRef = useRef(globalParams);
  globalParamsRef.current = globalParams;
  const handleRoomInviteTap = useCallback((roomId: string) => {
    stashPendingLinkRef.current(() => {
      if (segmentsRef.current.includes('voice-room')) {
        const currentRoomId = globalParamsRef.current?.roomId;
        if (typeof currentRoomId === 'string' && currentRoomId === roomId) {
          return; // already in this room — ignore the tap
        }
        if (router.canDismiss()) {
          router.dismiss();
        }
        // Let the dismiss settle so the old engine unmounts first.
        setTimeout(() => {
          router.push({ pathname: '/voice-room', params: { roomId } } as any);
        }, 80);
        return;
      }
      router.push({ pathname: '/voice-room', params: { roomId } } as any);
    });
  }, []);
  const [profileChecked, setProfileChecked] = useState(false);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);

  // 2026-10-14 (Sumon): Ghost mic fix — app start-এ stale audio engine destroy.
  // App close/reopen-এর পর mic on থাকতো যদিও user room-এ ছিল না।
  useEffect(() => {
    try {
      const { destroyPersistedVoiceRoomEngine } = require('@/src/features/voice-room/useLivekitVoiceRoom');
      destroyPersistedVoiceRoomEngine();
    } catch { /* non-critical */ }
    // Minimized state clear — fresh start-এ কোনো room active থাকা উচিত না
    try {
      const { setMinimizedRoom } = require('@/src/store/minimizedRoom');
      setMinimizedRoom(null);
    } catch { /* non-critical */ }
  }, []);

  // Check if the authenticated user has an RTDB profile.
  // New users (Google/email) land on complete-profile; existing users go home.
  useEffect(() => {
    if (!user || authLoading) {
      setProfileChecked(false);
      setHasProfile(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // P1 fix (2026-10-12): bound the profile read at 8s — a stalled
        // connection previously left the user on index.tsx's spinner forever.
        // Timeout is fail-open (treated like a read error): assume the profile
        // exists so a slow network never blocks an existing user.
        const result = await withTimeout(getUser(user.uid), 8000);
        if (cancelled) return;
        // 2026-10-19 onboarding fix: AuthContext auto-creates an incomplete
        // profile (profileComplete: false) while this check runs — route on
        // the flag, not mere existence. Legacy profiles (flag undefined)
        // count as complete; the timeout stays fail-open for slow networks.
        const profile = result.timedOut ? null : (result.value as VeeUser | null);
        const complete = result.timedOut
          ? true
          : !!profile && profile.profileComplete !== false;
        setHasProfile(complete);
        setProfileChecked(true);
      } catch {
        // On error, assume profile exists to avoid blocking existing users.
        // New users will be caught on next app start if profile creation failed.
        if (!cancelled) {
          setHasProfile(true);
          setProfileChecked(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user, authLoading]);

  useEffect(() => {
    // 2026-10-13 (Sumon): banned user-কে login-এ redirect কোরো না — ban screen
    // দেখাতে হবে। Ban-এর পর firebaseLogout()+setUser(null) হলে এই effect
    // '/auth/login'-এ পাঠিয়ে দিত, ban screen আর দেখা যেত না।
    if (isBanned) return;

    // Never dispatch a redirect before Expo Router has mounted its navigator.
    // A redirect issued during cold-start can be lost, leaving index.tsx's
    // loading indicator mounted forever.
    if (authLoading || langLoading || !rootNavigationState?.key) return;

    // 2026-10-19 polish: the 10s auth fail-open timeout fires before any real
    // auth callback on slow networks — hold a neutral "retrying" state and
    // NEVER flash /auth/login here. The first real callback clears the flag
    // and routing proceeds normally below.
    if (authTimedOut && !user) return;

    const segs             = segments as string[];
    const inAuthGroup      = segs[0] === 'auth';
    const onRoot           = segs.length === 0 || segs[0] === 'index';
    const onCompleteProfile = segs[1] === 'complete-profile';

    let destination: string | null = null;
    // Language is selected from the login header (IMO-style) — no separate page.
    if (!user && (!inAuthGroup || onRoot)) {
      // Not yet logged in.
      destination = '/auth/login';
    } else if (user && (inAuthGroup || onRoot) && !onCompleteProfile) {
      // Authenticated — check profile status before routing.
      // Wait for the profile check to complete.
      if (!profileChecked) return;
      if (hasProfile) {
        // Existing user — go home.
        destination = '/home';
      } else {
        // New user — complete profile first.
        destination = '/auth/complete-profile';
      }
    } else if (user && profileChecked && !hasProfile && !onCompleteProfile) {
      // 2026-10-12 audit fix: enforce profile completion on EVERY
      // authenticated route (e.g., deep link to /inbox or /voice-room
      // before completing profile). Previously only auth-group/root
      // were guarded, letting new users roam with no profile.
      destination = '/auth/complete-profile';
    }

    if (destination && redirectInFlightRef.current !== destination) {
      redirectInFlightRef.current = destination;
      router.replace(destination as any);
    } else if (!destination) {
      redirectInFlightRef.current = null;
    }

    // 2026-10-12 audit fix (HIGH PUSH-1): consume a stashed notification deep
    // link now that navigation is ready. Runs after the auth redirect so the
    // deep link wins (e.g., tap push → land directly in the chat/room).
    if (!authLoading && !langLoading && rootNavigationState?.key && pendingDeepLinkRef.current) {
      const fn = pendingDeepLinkRef.current;
      pendingDeepLinkRef.current = null;
      // Defer one tick so the auth redirect (if any) settles first.
      setTimeout(fn, 100);
    }
  }, [
    user,
    authLoading,
    authTimedOut,
    segments,
    isLanguageSelected,
    isBanned,
    langLoading,
    router,
    rootNavigationState?.key,
    profileChecked,
    hasProfile,
  ]);

  // 2026-10-15 (Sumon): VOICE-ROOM SESSION RESTORE.
  // If the app was killed (long background) while the user was in a voice
  // room, the in-memory room state is gone — but the persisted active room
  // survives. Return the user to their room (restore=1 → no duplicate
  // "joined" message, seat reclaimed if still free). Runs once per cold start,
  // after auth settles. A notification deep link always wins.
  const restoreCheckedRef = useRef(false);
  useEffect(() => {
    if (!user || authLoading || !profileChecked || !hasProfile || !rootNavigationState?.key) return;
    if (restoreCheckedRef.current) return;
    restoreCheckedRef.current = true;
    (async () => {
      try {
        const persisted = await getPersistedActiveRoom().catch(() => null);
        if (!persisted || persisted.myUid !== user.uid) return;
        if (pendingDeepLinkRef.current) return;
        if ((segments as string[])?.includes('voice-room')) return;
        const { get, ref } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        const infoSnap = await get(ref(database, `rooms/${persisted.roomId}/info`)).catch(() => null);
        if (!infoSnap?.exists()) {
          // Room was deleted while we were away — drop the stale entry.
          await clearPersistedActiveRoom().catch(() => {});
          return;
        }
        router.replace({ pathname: '/voice-room', params: { roomId: persisted.roomId, restore: '1' } } as any);
      } catch { /* non-critical — user stays on home */ }
    })();
  }, [user, authLoading, profileChecked, hasProfile, rootNavigationState?.key, segments]);

  // RC8-B2: Clean expired stories for the current user only (fire-and-forget).
  // Global cleanup across all users is now handled by the server-side scheduler
  // (artifacts/api-server/src/jobs/scheduler.ts, runs every 60 min).
  // Previously: cleanAllExpiredStories() downloaded ALL stories on every app start.
  useEffect(() => {
    if (user && !authLoading) {
      cleanExpiredStories(user.uid).catch(() => {/* non-critical */});
    }
  }, [user?.uid]);

  // BUG 13 fix: initializeOneSignal is Expo-Go-safe — it checks executionEnvironment
  // internally and is a no-op in Expo Go. Safe to call unconditionally here.
  useEffect(() => {
    initializeOneSignal(ONESIGNAL_APP_ID).catch(() => {/* non-critical */});

    // 2026-10-14 (Sumon): FCM push setup — Android channel + tap handler.
    // Unlimited, free, no-risk (expo-notifications official plugin).
    import('../src/services/fcmPushService').then(({ ensureAndroidChannel, setupNotificationListeners, setupNotificationHandler }) => {
      setupNotificationHandler();
      ensureAndroidChannel().catch(() => {});
      const handleFcmTap = (data: Record<string, any>) => {
        try {
          const d = data as any;
          // 2026-10-19 CRASH-RISK fix: incoming-call pushes carry no chatId —
          // route them through stashPendingLink to the ringing-modal seeder
          // (same cold-start guard the chat-tap path uses).
          if (d?.type === 'incoming-call') {
            stashPendingLinkRef.current(() => {
              void seedPendingIncomingCallFromTapRef.current(d || {});
            });
            return;
          }
          // Navigate to the chat when notification is tapped.
          // 2026-10-19 stability fix: route through stashPendingLink (same
          // guard as the OneSignal path) — direct router.push() is lost on
          // cold start when navigation isn't ready yet.
          const chatId = d?.chatId;
          if (chatId && typeof chatId === 'string') {
            stashPendingLinkRef.current(() => router.push(`/inbox/${chatId}` as any));
            return;
          }
          // 2026-10-19 stability fix (batch 2D): Vee Team / official broadcasts
          // carry category:"official" and NO chatId — tapping them did nothing.
          // Route them to the Vee Team chat (buildChatId keeps the canonical
          // uid-vee_team chat id used everywhere else).
          if (d?.category === 'official') {
            const uid = uidRef.current;
            if (uid) {
              stashPendingLinkRef.current(() => {
                import('@/src/features/chat/services/firebaseDmService').then(({ buildChatId }) => {
                  router.push(`/inbox/${buildChatId(uid, 'vee_team')}` as any);
                }).catch(() => {
                  // 2026-10-21 (Sumon): never force-open the chat list —
                  // if the Vee Team chat id can't be built, land on home.
                });
              });
            }
            return;
          }
          // 2026-10-19 stability fix (batch 2D): room-invite pushes carry a
          // roomId — mirror the OneSignal path (never stack a second
          // voice-room modal over an active room).
          const roomId = d?.roomId;
          if (roomId && typeof roomId === 'string') {
            stashPendingLinkRef.current(() => handleRoomInviteTap(roomId));
            return;
          }
          // 2026-10-21 (Sumon): unknown notification types land on HOME —
          // never force-open the chat list. (The old push('/chat') here,
          // replayed by the cold-start last-response path below, re-opened
          // Chats over home on every app launch from one stale tap.)
        } catch {}
      };
      setupNotificationListeners(handleFcmTap);
      // 2026-10-19 CRASH-RISK fix: a tap that launches a KILLED app is NOT
      // re-fired to addNotificationResponseReceivedListener — it is only
      // visible via getLastNotificationResponseAsync. Route it through the
      // identical handler so the incoming-call dead end is closed on cold
      // start too. (Idempotent: the seeder verifies the RTDB signal is alive,
      // so a stale tap can never pop a phantom modal.)
      import('expo-notifications').then(async ({ getLastNotificationResponseAsync, clearLastNotificationResponseAsync }) => {
        try {
          const last = await getLastNotificationResponseAsync();
          // 2026-10-21 (Sumon): CLEAR the stored response immediately.
          // getLastNotificationResponseAsync returns the last tap FOREVER,
          // so without clearing, one old notification tap replayed on every
          // cold start and force-opened its target over home. Clearing keeps
          // genuine app-launching taps working exactly once.
          try { await clearLastNotificationResponseAsync(); } catch { /* non-critical */ }
          const d = last?.notification?.request?.content?.data as Record<string, any> | undefined;
          if (d && typeof d === 'object' && Object.keys(d).length > 0) {
            handleFcmTap(d);
          }
        } catch { /* non-critical */ }
      }).catch(() => {});
    });

    // RC8-B2: Warm up the API server (Render free tier sleeps when idle;
    // cold start takes 30-60 s, silently dropping the first push notification).
    // Fixed URL: /health did not exist — correct endpoint is /api/healthz.
    const apiBase = tryGetApiBase();
    if (apiBase) {
      // background: safe to swallow — warm-up ping only
      fetch(`${apiBase}/api/healthz`, { method: 'GET' }).catch(() => {});
    }
  }, []);

  // FIX (2026-10-10): Request all permissions on first app open (Sumon's order).
  // Separate useEffect, non-fatal: failures are swallowed, app continues.
  useEffect(() => {
    import('@/src/utils/firstLaunchPermissions').then(({ requestAllPermissionsOnFirstLaunch }) => {
      requestAllPermissionsOnFirstLaunch().catch(() => {});
    }).catch(() => {});
  }, []);

  // OneSignal: tapping a background/killed-state push opens the right chat
  useEffect(() => {
    let unsubFn: (() => void) | undefined;
    let cancelled = false;

    // 2026-10-12 audit fix (HIGH PUSH-1): on cold start, router.push() can be
    // lost (navigation not ready). Uses the hoisted stashPendingLink (same
    // guard the FCM path now shares).

    // RC8-B2: Added onRoom handler for seat-approved / room-invite / seat-invite
    // notifications so tapping them navigates directly to the voice room.
    registerNotificationOpenedHandler(
      (chatId) => stashPendingLink(() => router.push(`/inbox/${chatId}` as any)),
      (roomId) => handleRoomInviteTap(roomId),
      // 2026-10-21 (Sumon): generic OneSignal taps land on HOME — never
      // force-open the chat list.
      () => {},
      // Incoming call: just bring app to foreground; the call UI is driven by
      // the live call listener (app/_layout.tsx handleIncomingCall), not by params.
      // Pushing /audio-call with partial params would hit the invalid-call guard.
      // 2026-10-21 (Sumon): no forced navigation (was push('/chat')).
      () => {},
    ).then((unsub) => {
      if (cancelled) {
        unsub();
      } else {
        unsubFn = unsub;
      }
    }).catch(() => {/* non-critical — Expo Go safe */});

    return () => {
      cancelled = true;
      unsubFn?.();
    };
  }, []);

  // OneSignal: link to authenticated user
  // 2026-10-14 (Sumon): Retry on app foreground — login-এ fail হলে আর try হতো না
  useEffect(() => {
    if (user?.uid) {
      loginOneSignal(user.uid).catch(() => {/* non-critical */});
      // 2026-10-14 (Sumon): PERMANENT unlimited push — FCM via expo-notifications.
      // No-risk (official Expo plugin), free, unlimited. Saves FCM token to Firebase.
      import('../src/services/fcmPushService').then(({ registerFcmToken }) => {
        registerFcmToken(user.uid).catch(() => {/* non-critical */});
      });
    } else if (!authLoading) {
      logoutOneSignal().catch(() => {/* non-critical */});
    }
  }, [user?.uid, authLoading]);

  // 2026-10-14 (Sumon): Foreground-এ OneSignal re-register — push ID missing থাকলে retry
  useEffect(() => {
    if (!user?.uid) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        // Check if we have a OneSignal ID, if not, retry registration
        import('@/src/services/pushNotificationService').then(({ loginOneSignal }) => {
          loginOneSignal(user.uid).catch(() => {});
        }).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [user?.uid]);

  // 2026-10-19 stability fix (batch 2D): the app badge is set on every push
  // (shouldSetBadge:true) but was NEVER cleared — clear it on foreground and
  // on cold start so a stale count never sticks.
  useEffect(() => {
    const clear = () => {
      import('../src/services/fcmPushService').then(({ clearAppBadge }) => {
        clearAppBadge().catch(() => {});
      }).catch(() => {});
    };
    const sub = AppState.addEventListener('change', (state: string) => {
      if (state === 'active') clear();
    });
    clear(); // cold start (e.g. launched from a notification tap)
    return () => sub.remove();
  }, []);

  // BUG 17 fix: Never show an infinite spinner — the loading states already
  // have internal timeouts (AuthContext: 10s, LanguageContext: 6s) so this
  // block will always resolve in a bounded amount of time.
  if (authLoading || langLoading) {
    return (
      // P1 fix (2026-10-12): white loading screen per the light-mode-everywhere rule.
      <View style={{ flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
        <PremiumLoader size="large" />
      </View>
    );
  }

  // 2026-10-19 polish: the auth fail-open timeout fired before any real auth
  // callback (slow network). Hold a neutral "retrying" state — the auth
  // redirect effect above is guarded so /auth/login never flashes here.
  if (authTimedOut && !user) {
    return (
      <View style={{ flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
        <PremiumLoader size="large" />
        <Text style={{ marginTop: 16, fontSize: 14, color: '#666' }}>
          Connecting… retrying
        </Text>
      </View>
    );
  }

  // BAN ENFORCEMENT (2026-10-13): if admin banned this user, show a
  // full-screen banned message instead of the app. No navigation possible.
  if (isBanned) {
    return (
      <View style={{ flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ fontSize: 64, marginBottom: 16 }}>🚫</Text>
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#111', marginBottom: 8, textAlign: 'center' }}>
          Account Banned
        </Text>
        <Text style={{ fontSize: 15, color: '#666', textAlign: 'center', lineHeight: 22 }}>
          {banReason || 'Your account has been banned by the administrator. Please contact support if you believe this is a mistake.'}
        </Text>
      </View>
    );
  }

  // RC6 fix Issue 8: when the user is authenticated, mount a global listener
  // for incoming 1-to-1 audio calls. The IncomingCallListener renders a Modal
  // that sits on top of all screens without interrupting navigation state.
  return (
    <>
      {children}
      {user && (
        <IncomingCallListener
          uid={user.uid}
          myName={user.displayName || 'Vee User'}
          pendingCall={pendingIncomingCall}
          onPendingCallConsumed={() => setPendingIncomingCall(null)}
        />
      )}
      {/* NOTE 1 (2026-10-11): Return-to-room bar — renders only when a room is
          minimized (component returns null otherwise). Mounted globally so the
          Return button is reachable from any screen. */}
      {user && <MinimizedRoomBar />}
      {/* 2026-10-14 (Sumon): Room invite popup — Accept/Reject */}
      {user && <RoomInvitePopup />}
      {/* 2026-10-11 Issue #8: Minimized call badge — renders only when a call
          is minimized. Mounted globally so it's reachable from any screen. */}
      {user && <CallMinimizeBar />}
      {/* 2026-10-11: Crash-cause display — shows real JS error cause on screen. */}
      <CrashOverlay />
    </>
  );
}

// ─── Incoming Call Listener (RC6 Issue 8) ─────────────────────────────────────
//
// Mounted globally inside AuthGuard so it survives route changes. Subscribes to
// Firebase RTDB `calls/{uid}` for real-time incoming call signaling.
// Shows a bottom-sheet Modal — Accept navigates to /audio-call (callee role),
// Decline removes the Firebase signal.

function IncomingCallListener({
  uid, myName, pendingCall, onPendingCallConsumed }: {
  uid: string;
  myName: string;
  // 2026-10-19 CRASH-RISK fix: push-tap-seeded incoming call (RTDB-verified
  // alive by the seeder in AuthGuard) — surfaces the ringing modal on cold
  // start, where the live RTDB subscribe may not have delivered yet.
  pendingCall: IncomingCall | null;
  onPendingCallConsumed: () => void;
}) {
  const router    = useRouter();
  const segmentsRef = useRef<string[]>([]);
  const segments  = useSegments();
  segmentsRef.current = segments as string[];

  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  // DP fallback: if the caller signal has no photoURL, fetch it from their
  // profile so the incoming modal always shows the caller's DP when available.
  const [fallbackPhoto, setFallbackPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (incoming?.callerPhotoURL || !incoming?.callerId) {
      setFallbackPhoto(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { get, ref } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        const snap = await get(ref(database, `users/${incoming.callerId}/photoURL`));
        if (!cancelled && snap.exists() && typeof snap.val() === 'string') {
          setFallbackPhoto(snap.val() as string);
        }
      } catch { /* non-critical — initial fallback remains */ }
    })();
    return () => { cancelled = true; };
  }, [incoming?.callerId, incoming?.callerPhotoURL]);

  // 2026-10-13: ref mirrors for the signal watcher — the subscribe callback
  // is registered once with [uid], so it can't see fresh React state.
  const incomingRef = useRef<IncomingCall | null>(null);
  // True when the modal was dismissed by the user's own tap (accept/decline).
  // Distinguishes user action from the caller cancelling remotely.
  const userDismissedRef = useRef(false);
  // 2026-10-19 stability fix (double-tap race): accept is async — the RTDB
  // liveness get() leaves a window where a second tap starts a second accept
  // (double updateCallSignal + double router.push → two stacked call modals).
  // Claimed synchronously as the first line of handleAccept; the Pressable
  // is also disabled while in flight.
  const acceptInFlightRef = useRef(false);
  const [accepting, setAccepting] = useState(false);
  const setIncomingState = useCallback((call: IncomingCall | null) => {
    incomingRef.current = call;
    setIncoming(call);
  }, []);

  // 2026-10-19 polish: incoming calls were completely silent. While the
  // ringing modal is up, play the ringtone + vibration (idempotent start);
  // stop both the moment the modal goes away (accept / decline /
  // caller-cancel / timeout) and dismiss the stale tray notification.
  // The cleanup also stops the alert on unmount.
  useEffect(() => {
    if (incoming) {
      startIncomingCallAlert();
    } else {
      stopIncomingCallAlert();
      dismissIncomingCallNotifications().catch(() => {});
    }
    return () => {
      stopIncomingCallAlert();
    };
  }, [incoming]);

  // 2026-10-19 CRASH-RISK fix: consume the push-tap-seeded incoming call so
  // the ringing modal renders on launch. The live RTDB subscribe (below)
  // takes over from here — including the caller-cancelled path, which logs
  // the missed call via the existing watcher.
  useEffect(() => {
    if (pendingCall) {
      setIncomingState(pendingCall);
      onPendingCallConsumed();
    }
  }, [pendingCall, onPendingCallConsumed, setIncomingState]);

  // Shared missed-call logger — decline path and caller-cancel path both
  // record an 'incoming / missed' entry in the chat inbox, like IMO.
  const logMissedCall = useCallback((callerId: string) => {
    import('@/src/features/chat/services/firebaseDmService').then(async ({ buildChatId, logCallToChat }) => {
      try {
        const chatId = buildChatId(uid, callerId);
        await logCallToChat(chatId, uid, callerId, 'incoming', 'missed', 0);
      } catch { /* non-critical */ }
    });
  }, [uid]);

  useEffect(() => {
    return subscribeIncomingCall(uid, async (call) => {
      // Ignore incoming calls while already on the audio-call screen (avoids
      // stacking modals when both devices are active in the same call).
      const segs = segmentsRef.current;
      if (segs[0] === 'audio-call') {
        // FIX (2026-10-10): Do NOT delete the signal for our own ACCEPTED call.
        // After accept, the callee lands on /audio-call while the signal
        // (status='accepted') still exists. Deleting it here made the CALLER's
        // AudioCallScreen listener see node-gone + state 'ringing' → false
        // 'declined' → auto-cut right after accept. The caller owns the
        // accepted signal's lifecycle (cleanup on connect/endCall).
        // Only auto-dismiss genuinely NEW incoming calls (busy) while in a call.
        const status = (call as { status?: string } | null)?.status;
        // background: safe to swallow — signaling cleanup
        if (call && status !== 'accepted') cleanupCallSignal(uid);
        return;
      }
      // 2026-10-11 FIX: never pop the incoming-call modal for a stale
      // 'accepted' signal while its call is minimized. After minimize the
      // signal node (status='accepted') still exists; any re-fire would
      // otherwise show the modal again and make minimize look broken.
      if (call && (call as { status?: string }).status === 'accepted' &&
          (isCallMinimizing() || getMinimizedCall())) {
        return;
      }
      // P1 fix (2026-10-12): busy guard — a NEW incoming call while a call
      // is minimized must not pop the modal. Accepting it would navigate to
      // /audio-call and orphan the minimized session (leaked mic + peer
      // connection). Auto-decline as busy instead.
      if (call && (call as { status?: string }).status !== 'accepted' && getMinimizedCall()) {
        cleanupCallSignal(uid);
        return;
      }
      // 2026-10-19 stability fix: mutual exclusion — auto-decline an incoming
      // 1-to-1 call while a voice room holds the native audio pipeline.
      // Accepting would run two mic captures on one audio session (native
      // contention = hard crash). The caller sees it as busy/declined.
      if (call && (call as { status?: string }).status !== 'accepted' && isVoiceRoomAudioActive()) {
        cleanupCallSignal(uid);
        return;
      }
      // Block enforcement: auto-decline calls from blocked users (either way).
      if (call) {
        const blocked = await isInteractionBlocked(uid, call.callerId).catch(() => false);
        if (blocked) {
          cleanupCallSignal(uid);
          return;
        }
      }
      if (!call) {
        // 2026-10-13: signal vanished while the modal was ringing — the
        // caller cancelled, timed out, or their app died. If the modal was
        // showing and the user didn't dismiss it themselves, this is a
        // MISSED call — log it like a decline, IMO-style. (Known open item.)
        const wasRinging = incomingRef.current;
        if (wasRinging && !userDismissedRef.current) {
          logMissedCall(wasRinging.callerId);
        }
        userDismissedRef.current = false;
        setIncomingState(null);
        // 2026-10-19: a stale accept claim must not block the next call.
        acceptInFlightRef.current = false;
        setAccepting(false);
        return;
      }
      userDismissedRef.current = false;
      // 2026-10-19: fresh incoming call — release any stale accept claim so
      // the new modal's Accept is immediately tappable.
      acceptInFlightRef.current = false;
      setAccepting(false);
      setIncomingState(call);
    });
  }, [uid, logMissedCall, setIncomingState]);

  const handleAccept = useCallback(async () => {
    // 2026-10-19 stability fix: claim the accept synchronously, BEFORE any
    // await — a second rapid tap must see the in-flight flag and bail out.
    if (acceptInFlightRef.current) return;
    acceptInFlightRef.current = true;
    setAccepting(true);
    try {
      const call = incomingRef.current;
      if (!call) return;
    // P1 fix (2026-10-12): last-moment busy guard — never accept over a
    // minimized call (race: modal popped just before minimize completed).
    if (getMinimizedCall()) {
      userDismissedRef.current = true;
      setIncomingState(null);
      cleanupCallSignal(uid);
      return;
    }
    // 2026-10-13: accept race — the caller may have cancelled in the ms
    // between the modal rendering and the tap. Accepting a dead signal
    // would CREATE a phantom 'accepted' node and strand this side on
    // "Connecting..." for 45s.
    let signalAlive = true;
    try {
      const { get, ref } = await import('firebase/database');
      const { database } = await import('@/src/config/firebase');
      signalAlive = (await get(ref(database, `calls/${uid}`))).exists();
    } catch { /* best-effort — proceed with accept */ }
    userDismissedRef.current = true;
    setIncomingState(null);
    if (!signalAlive) {
      // Caller is gone — log the missed call now (the signal watcher was
      // told this was user-dismissed, so it won't double-log).
      logMissedCall(call.callerId);
      return;
    }
    // FIX (2026-10-10): Mark as accepted instead of deleting.
    // Deleting triggered the caller's decline timer, auto-cutting the call
    // after 1.5s even though the callee answered. The caller cleans up
    // the signal when the call connects or ends.
    updateCallSignal(uid, { status: 'accepted', acceptedAt: Date.now() }).catch(() => {});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(
      `/audio-call?roomId=${encodeURIComponent(call.roomId)}&role=callee&remoteUid=${encodeURIComponent(call.callerId)}&remoteName=${encodeURIComponent(call.callerName)}&calleeUid=${encodeURIComponent(uid)}&myUid=${encodeURIComponent(uid)}&myName=${encodeURIComponent(myName)}${call.callerPhotoURL ? `&remotePhotoURL=${encodeURIComponent(call.callerPhotoURL)}` : ''}` as never,
    );
    } finally {
      // Release the claim — the modal is gone (accepted) or the accept
      // bailed out early; the next incoming call starts clean.
      acceptInFlightRef.current = false;
      setAccepting(false);
    }
  }, [uid, myName, router, logMissedCall, setIncomingState]);

  const handleDecline = useCallback(() => {
    const call = incomingRef.current;
    if (!call) return;
    userDismissedRef.current = true;
    setIncomingState(null);
    // background: safe to swallow — signaling cleanup
    cleanupCallSignal(uid);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // MISSED CALL LOG (2026-10-09): record in chat inbox like IMO.
    logMissedCall(call.callerId);
  }, [uid, logMissedCall, setIncomingState]);

  if (!incoming) return null;

  // ── IMO port (2026-10-19): incoming call rebuilt in IMO's style.
  // IMO's incoming call is a FULL-SCREEN activity (not a bottom sheet):
  // blurred caller avatar as background, centered avatar + name + status,
  // bottom answer/decline circles — green #04be5a / red #fa5353 (65-72dp).
  // All logic (ringtone, accept/decline, fallbackPhoto, audioOwner guard)
  // is untouched — pure UI reskin.
  const callerPhoto = incoming.callerPhotoURL || fallbackPhoto;
  return (
    <Modal
      visible
      animationType="fade"
      transparent={false}
      onRequestClose={handleDecline}
    >
      <View style={{ flex: 1, backgroundColor: '#0A0612' }}>
        {/* Blurred-avatar background (IMO alr.xml: full-screen avatar bg).
            No expo-blur — avatar image at low opacity + dark overlay. */}
        {callerPhoto ? (
          <Image
            source={{ uri: callerPhoto as string }}
            style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              width: '100%', height: '100%', opacity: 0.28,
            }}
            resizeMode="cover"
          />
        ) : null}
        <View style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(6,3,12,0.62)',
        }} />

        <SafeAreaView
          style={{
            flex: 1, alignItems: 'center', justifyContent: 'space-between',
            paddingTop: 72, paddingBottom: 64,
          }}
          edges={['top', 'bottom']}
        >
          {/* Caller info — centered (IMO: 72-96dp avatar, name, status) */}
          <View style={{ alignItems: 'center' }}>
            <View style={{
              width: 96, height: 96, borderRadius: 48,
              backgroundColor: 'rgba(255,255,255,0.12)',
              alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
              borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)',
            }}>
              {callerPhoto ? (
                <Image
                  source={{ uri: callerPhoto as string }}
                  style={{ width: 96, height: 96 }}
                />
              ) : (
                <Text style={{ color: '#fff', fontSize: 38, fontWeight: '800' }}>
                  {incoming.callerName[0]?.toUpperCase() ?? '?'}
                </Text>
              )}
            </View>
            <Text style={{
              color: '#fff', fontSize: 24, fontWeight: '800',
              marginTop: 18, textAlign: 'center', paddingHorizontal: 32,
            }}>
              {incoming.callerName}
            </Text>
            <Text style={{
              color: 'rgba(255,255,255,0.6)', fontSize: 14,
              marginTop: 6, fontWeight: '500',
            }}>
              Incoming voice call
            </Text>
          </View>

          {/* Answer / Decline — IMO green #04be5a / red #fa5353 */}
          <View style={{ flexDirection: 'row', gap: 56, alignItems: 'flex-start' }}>
            <View style={{ alignItems: 'center' }}>
              <Pressable
                onPress={handleDecline}
                style={{
                  width: 72, height: 72, borderRadius: 36,
                  backgroundColor: '#fa5353',
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: '#fa5353', shadowOpacity: 0.5, shadowRadius: 16,
                  elevation: 8,
                }}
              >
                <Feather name="phone-off" size={30} color="#fff" />
              </Pressable>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 8 }}>
                Decline
              </Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Pressable
                onPress={handleAccept}
                // 2026-10-19 stability fix (double-tap race): no second
                // accept while one is in flight.
                disabled={accepting}
                style={{
                  width: 72, height: 72, borderRadius: 36,
                  backgroundColor: '#04be5a',
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: '#04be5a', shadowOpacity: 0.5, shadowRadius: 16,
                  elevation: 8,
                  opacity: accepting ? 0.5 : 1,
                }}
              >
                <Feather name="phone" size={30} color="#fff" />
              </Pressable>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 8 }}>
                Accept
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

// ─── Navigation Stack ────────────────────────────────────────────────────────

function RootLayoutNav() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#FFFFFF' },
          animation: 'fade_from_bottom' }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="auth/login" />
        <Stack.Screen name="auth/complete-profile" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="auth/email-login" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="auth/signup" />
        <Stack.Screen name="auth/forgot-password" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="home/index" />
        <Stack.Screen
          name="voice-room"
          options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
        />
        <Stack.Screen
          name="inbox/[chatId]"
          options={{ animation: 'slide_from_right' }}
        />
        {/* ── User Profile ── */}
        <Stack.Screen
          name="user-profile"
          options={{ animation: 'slide_from_right' }}
        />
        {/* ── Profile sub-screens ── */}
        <Stack.Screen
          name="profile/index"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="profile/edit"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="profile/rooms"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="profile/notifications"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="profile/privacy"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="profile/settings"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="profile/help"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="profile/about"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="profile/wallet"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="profile/gifts"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="profile/honor"
          options={{ animation: 'slide_from_right' }}
        />
        {/* RC6 fix Issue 8: real 1-to-1 audio call screen */}
        <Stack.Screen
          name="audio-call"
          options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
        />
        <Stack.Screen name="+not-found" />
      </Stack>
    </>
  );
}

// ─── Root Layout ─────────────────────────────────────────────────────────────

// P0 fix (2026-10-12): the crash screen's own SafeAreaProvider. The
// ErrorBoundary now sits OUTSIDE the app's SafeAreaProvider, so when it
// catches a render throw in I18nextProvider/LanguageProvider/SafeAreaProvider,
// the fallback must not depend on the (possibly never-mounted) provider above
// it — useSafeAreaInsets() throws without one. This wrapper gives the crash
// screen its own safe-area context.
function RootErrorFallback(props: ErrorFallbackProps) {
  return (
    <SafeAreaProvider>
      <ErrorFallback {...props} />
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      // background: safe to swallow — splash hide is best-effort (timeout below is the backstop)
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  // BUG 17 fix: hard timeout so splash never blocks forever on slow devices
  useEffect(() => {
    const t = setTimeout(() => SplashScreen.hideAsync().catch(() => {/* background: safe to swallow */}), 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    // P0 fix (2026-10-12): ErrorBoundary is the OUTERMOST wrapper. It used to
    // sit inside I18nextProvider → LanguageProvider → SafeAreaProvider, so a
    // render throw in any of those killed the JS thread with no recovery UI.
    // BUG 18 fix: ErrorBoundary at the root catches all unhandled render
    // errors and shows a recovery UI instead of freezing the app.
    <ErrorBoundary FallbackComponent={RootErrorFallback}>
      {/* I18nextProvider makes the i18n instance available to useTranslation() */}
      <I18nextProvider i18n={i18n}>
        <LanguageProvider>
          <SafeAreaProvider>
            <AuthProvider>
              {/* Issue 7: ThemeProvider inside AuthProvider so it can read user uid */}
              <ThemeProvider>
                <QueryClientProvider client={queryClient}>
                  <GestureHandlerRootView style={{ flex: 1 }}>
                    <AuthGuard>
                      <RootLayoutNav />
                      {/* 2026-10-13 (Sumon): Honor/Frame grant celebration */}
                      <HonorCelebration />
                      {/* 2026-10-15 (Sumon): Noble rank-up mist celebration */}
                      <NobleLevelUpCelebration />
                    </AuthGuard>
                  </GestureHandlerRootView>
                </QueryClientProvider>
              </ThemeProvider>
            </AuthProvider>
          </SafeAreaProvider>
        </LanguageProvider>
      </I18nextProvider>
    </ErrorBoundary>
  );
}
