import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, ActivityIndicator, Modal, Text, Pressable, Image, I18nManager } from 'react-native';

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
// NOTE 5 (2026-10-11): Global IMO-style network status bar ("Waiting for
// network..." / "Reconnecting..." / "Connected").
import NetworkStatusBar from '@/src/components/NetworkStatusBar';

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
  const { user, loading: authLoading } = useAuth();
  const { isLanguageSelected, isLoading: langLoading } = useLanguage();
  const segments = useSegments();
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const redirectInFlightRef = useRef<string | null>(null);

  useEffect(() => {
    // Never dispatch a redirect before Expo Router has mounted its navigator.
    // A redirect issued during cold-start can be lost, leaving index.tsx's
    // loading indicator mounted forever.
    if (authLoading || langLoading || !rootNavigationState?.key) return;

    const segs             = segments as string[];
    const inAuthGroup      = segs[0] === 'auth';
    const onLanguageSelect = inAuthGroup && segs[1] === 'language-select';
    const onRoot           = segs.length === 0 || segs[0] === 'index';

    let destination: string | null = null;
    if (!isLanguageSelected && !onLanguageSelect) {
      // First launch — must pick a language before anything else.
      destination = '/auth/language-select';
    } else if (isLanguageSelected && !user && (!inAuthGroup || onRoot)) {
      // Language done, not yet logged in.
      destination = '/auth/login';
    } else if (user && (inAuthGroup || onRoot)) {
      // Already authenticated — leave auth screens and the root index spinner.
      // The latter is the important cold-relaunch case.
      destination = '/home';
    }

    if (destination && redirectInFlightRef.current !== destination) {
      redirectInFlightRef.current = destination;
      router.replace(destination as any);
    } else if (!destination) {
      redirectInFlightRef.current = null;
    }
  }, [
    user,
    authLoading,
    segments,
    isLanguageSelected,
    langLoading,
    router,
    rootNavigationState?.key,
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

    // RC8-B2: Added onRoom handler for seat-approved / room-invite / seat-invite
    // notifications so tapping them navigates directly to the voice room.
    registerNotificationOpenedHandler(
      (chatId) => router.push(`/inbox/${chatId}` as any),
      (roomId) => router.push({ pathname: '/voice-room', params: { roomId } } as any),
      () => router.push('/chat' as any),
      // Incoming call: just bring app to foreground; the call UI is driven by
      // the live call listener (app/_layout.tsx handleIncomingCall), not by params.
      // Pushing /audio-call with partial params would hit the invalid-call guard.
      () => router.push('/chat' as any),
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
  useEffect(() => {
    if (user?.uid) {
      loginOneSignal(user.uid).catch(() => {/* non-critical */});
    } else if (!authLoading) {
      logoutOneSignal().catch(() => {/* non-critical */});
    }
  }, [user?.uid, authLoading]);

  // BUG 17 fix: Never show an infinite spinner — the loading states already
  // have internal timeouts (AuthContext: 10s, LanguageContext: 6s) so this
  // block will always resolve in a bounded amount of time.
  if (authLoading || langLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#07020F', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#7C3AED" size="large" />
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
          myName={user.displayName ?? 'Vee User'}
        />
      )}
      {/* NOTE 1 (2026-10-11): Return-to-room bar — renders only when a room is
          minimized (component returns null otherwise). Mounted globally so the
          Return button is reachable from any screen. */}
      {user && <MinimizedRoomBar />}
      {/* NOTE 5 (2026-10-11): IMO-style network status bar — visible only
          when offline/reconnecting (or briefly on reconnect). */}
      {user && <NetworkStatusBar />}
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
      // Block enforcement: auto-decline calls from blocked users (either way).
      if (call) {
        const blocked = await isInteractionBlocked(uid, call.callerId).catch(() => false);
        if (blocked) {
          removeCallSignal(uid).catch(() => {});
          return;
        }
      }
      setIncoming(call);
    });
  }, [uid]);

  const handleAccept = useCallback(() => {
    if (!incoming) return;
    const call = incoming;
    setIncoming(null);
    // FIX (2026-10-10): Mark as accepted instead of deleting.
    // Deleting triggered the caller's decline timer, auto-cutting the call
    // after 1.5s even though the callee answered. The caller cleans up
    // the signal when the call connects or ends.
    updateCallSignal(uid, { status: 'accepted', acceptedAt: Date.now() }).catch(() => {});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(
      `/audio-call?roomId=${encodeURIComponent(call.roomId)}&role=callee&remoteUid=${encodeURIComponent(call.callerId)}&remoteName=${encodeURIComponent(call.callerName)}&calleeUid=${encodeURIComponent(uid)}&myUid=${encodeURIComponent(uid)}&myName=${encodeURIComponent(myName)}${call.callerPhotoURL ? `&remotePhotoURL=${encodeURIComponent(call.callerPhotoURL)}` : ''}` as never,
    );
  }, [incoming, uid, myName, router]);

  const handleDecline = useCallback(() => {
    if (!incoming) return;
    const call = incoming;
    setIncoming(null);
    // background: safe to swallow — signaling cleanup
    removeCallSignal(uid).catch(() => {});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // MISSED CALL LOG (2026-10-09): record in chat inbox like IMO.
    import('@/src/features/chat/services/firebaseDmService').then(async ({ buildChatId, logCallToChat }) => {
      try {
        const chatId = buildChatId(uid, call.callerId);
        await logCallToChat(
          chatId,
          uid,
          call.callerId,
          'incoming',
          'missed',
          0,
        );
      } catch { /* non-critical */ }
    });
  }, [incoming, uid]);

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
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#07020F' },
          animation: 'fade_from_bottom',
        }}
      >
        <Stack.Screen name="index" />
        {/* Language selection — shown once before login */}
        <Stack.Screen
          name="auth/language-select"
          options={{ animation: 'fade' }}
        />
        <Stack.Screen name="auth/login" />
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
    // I18nextProvider makes the i18n instance available to useTranslation()
    <I18nextProvider i18n={i18n}>
      <LanguageProvider>
        <SafeAreaProvider>
          {/* BUG 18 fix: ErrorBoundary at the root catches all unhandled render
              errors and shows a recovery UI instead of freezing the app. */}
          <ErrorBoundary>
            <AuthProvider>
              {/* Issue 7: ThemeProvider inside AuthProvider so it can read user uid */}
              <ThemeProvider>
                <QueryClientProvider client={queryClient}>
                  <GestureHandlerRootView style={{ flex: 1 }}>
                    <AuthGuard>
                      <RootLayoutNav />
                    </AuthGuard>
                  </GestureHandlerRootView>
                </QueryClientProvider>
              </ThemeProvider>
            </AuthProvider>
          </ErrorBoundary>
        </SafeAreaProvider>
      </LanguageProvider>
    </I18nextProvider>
  );
}
