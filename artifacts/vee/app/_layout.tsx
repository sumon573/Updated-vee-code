import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, ActivityIndicator, Modal, Text, Pressable, Image, I18nManager, AppState } from 'react-native';

/**
 * CRASH CAUSE DISPLAY (2026-10-11, Sumon's rule): every JS error must show
 * its real cause on screen. Installed FIRST, before anything else.
 * NOTE: native startup crashes (before JS loads) cannot be caught by JS.
 */
import { installGlobalCrashHandler, CrashOverlay } from '@/src/utils/crashReporter';
import { HonorCelebration } from '@/src/components/HonorCelebration';
installGlobalCrashHandler();

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
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from '@/src/context/AuthContext';
import { getUser } from '@/src/services/userService';
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
  registerNotificationOpenedHandler,
} from '@/src/services/pushNotificationService';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  subscribeIncomingCall,
  removeCallSignal,
  updateCallSignal,
  type IncomingCall,
} from '@/src/features/audio-call/services/firebaseCallService';
import { isInteractionBlocked } from '@/src/services/blockService';
import { tryGetApiBase } from '@/src/utils/platform';
// NOTE 1 (2026-10-11): Global return-to-room bar for minimized voice rooms.
import MinimizedRoomBar from '@/src/features/voice-room/components/MinimizedRoomBar';
import RoomInvitePopup from '@/src/features/voice-room/components/RoomInvitePopup';
import CallMinimizeBar from '@/src/features/audio-call/components/CallMinimizeBar';
import {
  isCallMinimizing,
  getMinimizedCall,
} from '@/src/features/audio-call/services/callMinimizeStore';

// Expo can reject this call when the native splash screen has already been
// dismissed (for example after a fast reload). Never leave that rejection
// unhandled during the most fragile part of app startup.
void SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000,
    },
  },
});

// ─── Auth + Language Guard ────────────────────────────────────────────────────
//
// Navigation rules (evaluated in order):
//   1. While loading (auth or language) → show spinner.
//   2. Language not yet selected + not already on language-select → go there.
//   3. Language selected, no user, not in auth group → go to login.
//   4. Language selected, user present, in auth group → go to home.

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading, isBanned, banReason } = useAuth();
  const { isLanguageSelected, isLoading: langLoading } = useLanguage();
  const segments = useSegments();
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const redirectInFlightRef = useRef<string | null>(null);
  // 2026-10-12 audit fix (HIGH PUSH-1): pending notification deep link,
  // consumed once navigation is ready (see effect below).
  const pendingDeepLinkRef = useRef<(() => void) | null>(null);
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

  // Check if the authenticated user has a Firestore profile.
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
        setHasProfile(result.timedOut ? true : !!result.value);
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
    segments,
    isLanguageSelected,
    isBanned,
    langLoading,
    router,
    rootNavigationState?.key,
    profileChecked,
    hasProfile,
  ]);

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
      setupNotificationListeners((data) => {
        try {
          // Navigate to the chat when notification is tapped
          const chatId = (data as any)?.chatId;
          if (chatId && typeof chatId === 'string') {
            router.push(`/inbox/${chatId}` as any);
          }
        } catch {}
      });
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
    // lost (navigation not ready). Stash the pending deep link; the
    // auth-redirect effect below consumes it once rootNavigationState is ready.
    const stashPendingLink = (fn: () => void) => {
      if (rootNavigationState?.key) {
        fn();
      } else {
        pendingDeepLinkRef.current = fn;
      }
    };

    // RC8-B2: Added onRoom handler for seat-approved / room-invite / seat-invite
    // notifications so tapping them navigates directly to the voice room.
    registerNotificationOpenedHandler(
      (chatId) => stashPendingLink(() => router.push(`/inbox/${chatId}` as any)),
      (roomId) => stashPendingLink(() => router.push({ pathname: '/voice-room', params: { roomId } } as any)),
      () => stashPendingLink(() => router.push('/chat' as any)),
      // Incoming call: just bring app to foreground; the call UI is driven by
      // the live call listener (app/_layout.tsx handleIncomingCall), not by params.
      // Pushing /audio-call with partial params would hit the invalid-call guard.
      () => stashPendingLink(() => router.push('/chat' as any)),
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

  // BUG 17 fix: Never show an infinite spinner — the loading states already
  // have internal timeouts (AuthContext: 10s, LanguageContext: 6s) so this
  // block will always resolve in a bounded amount of time.
  if (authLoading || langLoading) {
    return (
      // P1 fix (2026-10-12): white loading screen per the light-mode-everywhere rule.
      <View style={{ flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#007AFF" size="large" />
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
  uid, myName,
}: {
  uid: string;
  myName: string;
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
  const setIncomingState = useCallback((call: IncomingCall | null) => {
    incomingRef.current = call;
    setIncoming(call);
  }, []);

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
        if (call && status !== 'accepted') removeCallSignal(uid).catch(() => {});
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
        removeCallSignal(uid).catch(() => {});
        return;
      }
      // Block enforcement: auto-decline calls from blocked users (either way).
      if (call) {
        const blocked = await isInteractionBlocked(uid, call.callerId).catch(() => false);
        if (blocked) {
          removeCallSignal(uid).catch(() => {});
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
        return;
      }
      userDismissedRef.current = false;
      setIncomingState(call);
    });
  }, [uid, logMissedCall, setIncomingState]);

  const handleAccept = useCallback(async () => {
    const call = incomingRef.current;
    if (!call) return;
    // P1 fix (2026-10-12): last-moment busy guard — never accept over a
    // minimized call (race: modal popped just before minimize completed).
    if (getMinimizedCall()) {
      userDismissedRef.current = true;
      setIncomingState(null);
      removeCallSignal(uid).catch(() => {});
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
  }, [uid, myName, router, logMissedCall, setIncomingState]);

  const handleDecline = useCallback(() => {
    const call = incomingRef.current;
    if (!call) return;
    userDismissedRef.current = true;
    setIncomingState(null);
    // background: safe to swallow — signaling cleanup
    removeCallSignal(uid).catch(() => {});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // MISSED CALL LOG (2026-10-09): record in chat inbox like IMO.
    logMissedCall(call.callerId);
  }, [uid, logMissedCall, setIncomingState]);

  if (!incoming) return null;

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      onRequestClose={handleDecline}
    >
      <View style={{
        flex: 1, justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.55)',
      }}>
        <View style={{
          backgroundColor: '#0F0A1E',
          borderTopLeftRadius: 28, borderTopRightRadius: 28,
          paddingHorizontal: 28, paddingTop: 28, paddingBottom: 48,
          alignItems: 'center',
          borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
          borderColor: 'rgba(139,92,246,0.3)',
        }}>
          {/* Caller avatar */}
          <View style={{
            width: 84, height: 84, borderRadius: 42,
            backgroundColor: 'rgba(124,58,237,0.25)',
            borderWidth: 2, borderColor: '#8B5CF6',
            alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden', marginBottom: 14,
            shadowColor: '#8B5CF6', shadowOpacity: 0.4,
            shadowRadius: 18, shadowOffset: { width: 0, height: 4 },
          }}>
            {(incoming.callerPhotoURL || fallbackPhoto) ? (
              <Image
                source={{ uri: (incoming.callerPhotoURL || fallbackPhoto) as string }}
                style={{ width: 84, height: 84 }}
              />
            ) : (
              <Text style={{ color: '#fff', fontSize: 32, fontWeight: '900' }}>
                {incoming.callerName[0]?.toUpperCase() ?? '?'}
              </Text>
            )}
          </View>

          <Text style={{ color: '#fff', fontSize: 21, fontWeight: '900' }}>
            {incoming.callerName}
          </Text>
          <Text style={{
            color: 'rgba(255,255,255,0.55)', fontSize: 14,
            marginTop: 5, marginBottom: 32, fontWeight: '500',
          }}>
            Incoming Voice Call
          </Text>

          {/* Accept / Decline */}
          <View style={{ flexDirection: 'row', gap: 36, alignItems: 'center' }}>
            {/* Decline */}
            <View style={{ alignItems: 'center', gap: 8 }}>
              <Pressable
                onPress={handleDecline}
                style={{
                  width: 68, height: 68, borderRadius: 34,
                  backgroundColor: '#EF4444',
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: '#EF4444', shadowOpacity: 0.5, shadowRadius: 14,
                  elevation: 8,
                }}
              >
                <Feather name="phone-off" size={28} color="#fff" />
              </Pressable>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>Decline</Text>
            </View>

            {/* Accept */}
            <View style={{ alignItems: 'center', gap: 8 }}>
              <Pressable
                onPress={handleAccept}
                style={{
                  width: 68, height: 68, borderRadius: 34,
                  backgroundColor: '#22C55E',
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: '#22C55E', shadowOpacity: 0.5, shadowRadius: 14,
                  elevation: 8,
                }}
              >
                <Feather name="phone" size={28} color="#fff" />
              </Pressable>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>Accept</Text>
            </View>
          </View>
        </View>
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
          animation: 'fade_from_bottom',
        }}
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
    Inter_700Bold,
  });

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
