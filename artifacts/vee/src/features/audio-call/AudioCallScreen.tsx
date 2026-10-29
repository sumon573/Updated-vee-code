/**
 * AudioCallScreen — 1-to-1 voice call over WebRTC P2P (react-native-webrtc).
 * WebRTC is now the only call transport.
 *
 * Flow:
 *   Caller → navigates here → SDP offer written → initiateCall() → show "Ringing..."
 *   Callee → accepts IncomingCallModal → navigates here → answers the offer
 *   Both   → ICE connects → 'connected' → timer starts
 *   Either → taps End → session hangup + Firebase signal removed → router.back()
 *   Either → remote hangs up → signaling node removed → 'ended' → auto back after 1.5s
 *
 * Safety rules (same pattern as the old engine block):
 *   • Native calls (mute, speaker) happen OUTSIDE setState callbacks
 *     — never inside updater functions.
 *   • Cleanup guard (cleaningUpRef) prevents double-hangup crashes.
 *   • All state setters guard on mountedRef before executing.
 */

import React, {
  useEffect, useRef, useState, useCallback,
} from 'react';
import {
  View, Text, Pressable, Image, StatusBar, Alert,
  Platform, PermissionsAndroid,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
// IMO port (2026-10-19): IMO call-screen design tokens + CallOptView control
// pattern (48dp icon circle + label below), extracted from IMO v2026.09.1051.
import { IMO_CALL } from './components/ImoCallTheme';
import CallOptButton from './components/CallOptButton';
import { useRouter, useNavigation } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useSafeKeepAwake } from '@/src/hooks/useSafeKeepAwake';
import { initiateCall, removeCallSignal } from './services/firebaseCallService';
import { startOutgoingTone, stopOutgoingTone } from './services/outgoingCallTone';
import { WebRTCCallSession, type WebRTCCallCallbacks } from './services/webrtcCallService';
import { alertMicDeniedWithSettings } from '@/src/utils/permissionAlert';
// 2026-10-11 Issue #8: call minimize — persist WebRTC session at module level.
// 2026-10-11 FIX: module-level minimizing flag + mount tracking fix the race
// where RN's own back handler dismissed the modal before our BackHandler ran.
import {
  setMinimizedCall,
  getMinimizedCall,
  setPersistedCallSession,
  getPersistedCallSession,
  clearPersistedCallSession,
  teardownPersistedCall,
  setCallMinimizing,
  isCallMinimizing,
  setCallScreenMounted,
  isCallScreenMounted,
} from './services/callMinimizeStore';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isExpoGo(): boolean {
  try {
    return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  } catch {
    return false;
  }
}

async function requestMicPermission(strings: {
  title: string; message: string; allow: string; deny: string; askLater: string;
}): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const already = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    if (already) return true;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: strings.title,
        message: strings.message,
        buttonPositive: strings.allow,
        buttonNegative: strings.deny,
        buttonNeutral: strings.askLater,
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

function formatElapsed(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type CallState = 'calling' | 'ringing' | 'connecting' | 'connected' | 'ended' | 'declined';

// ─── Props ────────────────────────────────────────────────────────────────────

export type AudioCallProps = {
  /** Deterministic room ID shared by both parties: buildCallRoomId(uidA, uidB) */
  roomId: string;
  /** 'caller' = initiated the call; 'callee' = accepted the call */
  role: 'caller' | 'callee';
  remoteUid: string;
  remoteName: string;
  remotePhotoURL?: string;
  /** Firebase UID of the call recipient — used to remove the signaling node */
  calleeUid: string;
  myUid: string;
  myName: string;
  /** Caller's own photo URL — sent in the Firebase signal so callee's
   *  IncomingCallModal can show the caller's avatar. */
  myPhotoURL?: string;
  /** 2026-10-11 Issue #8: true when returning from a minimized call —
   *  reattach to the persisted WebRTC session instead of dialing anew. */
  isReturning?: boolean;
  /** 2026-10-29 Fix #18: speaker choice carried through a minimize →
   *  return cycle (set by the minimized record) so the returned screen's
   *  speaker button shows the true route instead of resetting to off. */
  initialSpeakerOn?: boolean;
};

// ─── Component ───────────────────────────────────────────────────────────────

const C = {
  bg: '#07020F',
  primary: '#7C3AED',
  glow: '#8B5CF6',
  text: '#FFFFFF',
  muted: 'rgba(255,255,255,0.55)',
  green: '#22C55E',
  red: '#EF4444',
  border: 'rgba(139,92,246,0.3)',
} as const;

export default function AudioCallScreen({
  roomId, role,
  remoteUid, remoteName, remotePhotoURL,
  calleeUid, myUid, myName, myPhotoURL,
  isReturning, initialSpeakerOn,
}: AudioCallProps) {
  const router = useRouter();
  const navigation = useNavigation();
  const { t } = useTranslation();
  // 2026-10-22 (boss): keep the display awake during a call (speaker/desk
  // use must not sleep mid-conversation — same rule as the voice room).
  // Proximity-to-ear behaviour is unaffected; audio also keeps running
  // with the screen off via the mic foreground service.
  useSafeKeepAwake('audio-call');

  // ── Refs ──────────────────────────────────────────────────────────────────
  const webrtcRef      = useRef<WebRTCCallSession | null>(null);
  const mountedRef     = useRef(true);
  const cleaningUpRef  = useRef(false);
  // 2026-10-11 Issue #8: true while minimizing — unmount cleanup must NOT
  // hang up the call; the WebRTC session persists at module level.
  const isMinimizingRef = useRef(false);
  const callStateRef   = useRef<CallState>(role === 'caller' ? 'calling' : 'connecting');
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutedRef       = useRef(false);
  /** 2026-10-29 Fix #18: ref mirror of speakerOn — native routing calls
   *  must happen OUTSIDE setState callbacks (same pattern as mutedRef). */
  const speakerOnRef   = useRef(initialSpeakerOn ?? false);
  /** Unsubscribe for the call-signal reject listener (caller side). */
  const signalUnsubRef = useRef<(() => void) | null>(null);
  /** Unsubscribe for the callee-online presence listener (caller side). */
  const onlineUnsubRef = useRef<(() => void) | null>(null);
  /** Timer for delayed decline detection (cancelled on connect). */
  const declineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 2026-10-13: generation counter — detects endCall racing initiateCall.
   *  If the user hangs up while the signal write is in flight, endCall's
   *  cleanup runs BEFORE the set() lands, leaving a stale ringing signal. */
  const callGenRef = useRef(0);

  // ── State ──────────────────────────────────────────────────────────────────
  const [callState, setCallState] = useState<CallState>(callStateRef.current);
  // 2026-10-20 (boss): caller-side progress tones — "calling" and "ringing"
  // must sound DIFFERENT. Callee role never plays these (it has the incoming
  // ringtone instead). Stops on connected/connecting/ended/declined/unmount.
  useEffect(() => {
    if (role !== 'caller') return;
    if (callState === 'calling') startOutgoingTone('calling');
    else if (callState === 'ringing') startOutgoingTone('ringing');
    else stopOutgoingTone();
  }, [callState, role]);
  useEffect(() => () => stopOutgoingTone(), []);
  const [muted,     setMuted]     = useState(false);
  // 2026-10-29 Fix #18: speaker toggle state. The 2026-10-19 disabled
  // placeholder is gone — session.setSpeakerphone() is REAL since the
  // 2026-10-24 Bluetooth fix, so the button toggles it in BOTH dialing
  // and connected states. speakerReady gates the button until the WebRTC
  // session exists (session creation awaits mic permission).
  const [speakerOn, setSpeakerOn] = useState(initialSpeakerOn ?? false);
  const [speakerReady, setSpeakerReady] = useState(false);
  const [elapsed,   setElapsed]   = useState(0);
  /** Ref mirror of elapsed — endCall's closure needs the live value. */
  const elapsedRef = useRef(0);
  /** Remote user's mute state (synced via Firebase). */
  const [remoteMuted, setRemoteMuted] = useState(false);
  /** Display name with Firebase fallback (2026-10-09): if remoteName is
   *  missing/"Vee User", fetch the real name from users/{remoteUid}. */
  const [displayName, setDisplayName] = useState(remoteName);
  useEffect(() => {
    if (remoteName && remoteName !== 'Vee User' && remoteName.trim()) {
      setDisplayName(remoteName);
      return;
    }
    const uid = remoteUid || calleeUid;
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const { get, ref } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        // P1 fix (2026-10-12): the DB field is `name` — `displayName` is never
        // written, so this fetch always missed.
        const snap = await get(ref(database, `users/${uid}/name`));
        if (!cancelled && snap.exists()) {
          const name = snap.val() as string;
          if (name && name.trim()) setDisplayName(name);
        }
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [remoteName, remoteUid, calleeUid]);

  // BACK BUTTON → KEEP CALL (2026-10-10, Sumon's order): pressing back during
  // a call must NOT end it. Block the back action; the user stays on the call
  // (The minimize version of this handler is registered after minimizeCall
  // is defined below — 2026-10-11 Issue #8.)
  /** Remote user's photo — fetched from Firebase as fallback if the nav
   *  param is missing/stale, so the callee's DP always shows. */
  const [remotePhoto, setRemotePhoto] = useState<string | undefined>(remotePhotoURL);

  // ── Safe state setters (guard on mountedRef) ──────────────────────────────
  const updateCallState = useCallback((state: CallState) => {
    callStateRef.current = state;
    if (mountedRef.current) setCallState(state);
  }, []);

  // ── Timer ─────────────────────────────────────────────────────────────────
  const startTimer = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      if (mountedRef.current) {
        elapsedRef.current += 1;
        setElapsed(e => e + 1);
      }
    }, 1000);
  }, []);

  // ── End call (cleanup + navigate back) ───────────────────────────────────
  const endCall = useCallback((goBack = true) => {
    if (cleaningUpRef.current) {
      // 2026-10-23 (Sumon bug): cleanup already ran through an
      // endCall(false) path (remote hangup while a persisted-session
      // record existed) but this screen is STILL displayed — the user
      // ends up stranded on the "Call Ended" page with a dead End
      // button. Navigation is independent of cleanup: always honour a
      // goBack request while the call screen is mounted.
      if (goBack && isCallScreenMounted()) {
        try {
          if (router.canGoBack()) router.back();
          else router.replace('/home');
        } catch { /* non-critical — already dismissed */ }
      }
      return;
    }
    cleaningUpRef.current = true;
    // 2026-10-13: bump the generation — an in-flight initiateCall checks
    // this afterwards and cleans up its stale signal write.
    callGenRef.current += 1;
    // 2026-10-11 FIX: a real hangup is never a minimize — reset the flag.
    setCallMinimizing(false);

    // 2026-10-11 Issue #8: a real hangup discards any persisted session.
    clearPersistedCallSession();
    setMinimizedCall(null);

    // Stop timers
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    // 2026-10-13: endCall can run while the screen stays mounted (e.g. the
    // remote-ended delayed end), so unsubscribe here too — don't rely on
    // the unmount cleanup alone.
    if (signalUnsubRef.current) { try { signalUnsubRef.current(); } catch { /* non-critical */ } signalUnsubRef.current = null; }
    if (onlineUnsubRef.current) { try { onlineUnsubRef.current(); } catch { /* non-critical */ } onlineUnsubRef.current = null; }
    if (declineTimerRef.current) { clearTimeout(declineTimerRef.current); declineTimerRef.current = null; }

    // CALL HISTORY (2026-10-09): log to chat inbox like IMO/WhatsApp.
    // Fire-and-forget — never blocks the hangup flow.
    try {
      const state = callStateRef.current;
      const wasConnected = state === 'connected';
      const result = wasConnected ? 'completed'
        : state === 'declined' ? 'rejected'
        : 'cancelled';
      // Only log if there was actual call activity (not instant hangup)
      if (state !== 'ended') {
        import('@/src/features/chat/services/firebaseDmService').then(async ({ buildChatId, logCallToChat }) => {
          try {
            const otherUid = role === 'caller' ? calleeUid : remoteUid;
            if (!otherUid || !myUid) return;
            const chatId = buildChatId(myUid, otherUid);
            await logCallToChat(
              chatId,
              myUid,
              otherUid,
              role === 'caller' ? 'outgoing' : 'incoming',
              result as 'missed' | 'rejected' | 'completed' | 'cancelled',
              elapsedRef.current,
            );
          } catch { /* non-critical */ }
        });
      }
    } catch { /* non-critical */ }

    // Remove Firebase signaling.
    // — কলার সবসময় সিগন্যাল মুছে দেয়;
    // — ক্যালি মুছে দেয় শুধু যখন কল কখনোই কানেক্ট হয়নি — নইলে মরা
    //   'accepted' সিগন্যাল চিরকাল calls/{uid}-তে থেকে যায়, আর প্রতিবার
    //   অ্যাপ চালু হলেই ভুয়া Incoming Call মোডাল পপ হয়;
    // — কানেক্ট হওয়া কলের ক্ষেত্রে কলারই সিগন্যালের মালিক (connect/end-এ মুছে)।
    if (role === 'caller' || callStateRef.current !== 'connected') {
      removeCallSignal(calleeUid).catch(() => {/* background: safe to swallow — signaling cleanup */});
    }
    // CRITICAL (2026-10-13): initiateCall-এ calls/{calleeUid}-তে যে
    // onDisconnect arm করা হয়েছিল সেটা cancel করো — নইলে পরে এই ডিভাইসের
    // কানেকশন ড্রপ হলে ফায়ারবেস ওই নোডের তখনকার (সম্পূর্ণ নতুন) কল
    // সিগন্যাল মুছে দেবে, অর্থাৎ অন্য কারো নতুন incoming call নীরবে মরে যাবে।
    if (role === 'caller') {
      import('firebase/database').then(async ({ ref, onDisconnect }) => {
        try {
          const { database } = await import('@/src/config/firebase');
          await onDisconnect(ref(database, `calls/${calleeUid}`)).cancel();
        } catch { /* non-critical */ }
      });
    }

    // C10 FIX: Clean up callMute state on call end. Stale mute nodes leak
    // into the next call with the same roomId (deterministic per user pair).
    if (roomId && myUid) {
      import('firebase/database').then(async ({ ref, remove }) => {
        try {
          const { database } = await import('@/src/config/firebase');
          await remove(ref(database, `callMute/${roomId}/${myUid}`));
        } catch { /* non-critical */ }
      });
    }

    // WebRTC teardown — the session owns the peer connection, RTDB
    // listeners, and the ephemeral signaling node.
    // 2026-10-19 (Sumon): when the call was minimized, the session lives at
    // module level and this instance may be unmounted (remote hangup while
    // minimized). Route the native hangup through the store so no dead
    // instance's closure owns it; a live local session ends directly.
    if (roomId && getPersistedCallSession(roomId)) {
      teardownPersistedCall(roomId);
    } else {
      const session = webrtcRef.current;
      if (session) {
        try { session.hangup(); } catch { /* non-critical */ }
      }
    }
    webrtcRef.current = null;
    mountedRef.current = false;

    if (goBack) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      // 2026-10-11 FIX: only navigate when the call screen is actually
      // mounted. Without this, a remote hangup while minimized would pop
      // whatever screen the user is on.
      if (isCallScreenMounted()) {
        try {
          if (router.canGoBack()) router.back();
          else router.replace('/home');
        } catch { /* non-critical — already dismissed */ }
      }
    }
  }, [role, calleeUid, roomId, router]);

  // 2026-10-19 (Sumon): MOUNT-ONCE init support — route params are immutable
  // for a screen instance; the WebRTC init effect snapshots them at mount and
  // never re-runs (re-running would drop the live call via the cleanup's
  // endCall). endCall/t are re-created by hooks, so the mount-once effect
  // routes them through refs instead of depending on them.
  const paramsRef = useRef({ roomId, role, remoteUid, calleeUid, myUid, myName, myPhotoURL, isReturning });
  const endCallRef = useRef(endCall);
  endCallRef.current = endCall;
  const tRef = useRef(t);
  tRef.current = t;

  // ── Minimize call (2026-10-11 Issue #8, hardened 2026-10-11) ───────────────
  // Keeps the WebRTC session alive at module level, shows the floating
  // CallMinimizeBar, and navigates back. Audio continues. Returning via the
  // bar reattaches to the persisted session (no re-dial).
  const minimizeCall = useCallback(() => {
    // 2026-10-29 Fix #18: minimize is allowed in ANY non-terminal state.
    // Dialing ("Calling..."/"Ringing"/"Connecting") minimizes exactly like
    // a connected call — the session persists at module level, the bar
    // shows, and Back never hangs up. Only 'ended'/'declined' end normally
    // (there is no live call left to minimize).
    const minimizeState = callStateRef.current;
    if (minimizeState === 'ended' || minimizeState === 'declined') {
      endCall(true);
      return;
    }
    // 2026-10-11 FIX: set the module-level flag FIRST so every cleanup path
    // (unmount, beforeRemove re-entry, timers) knows this is a minimize.
    // The component ref alone was not enough — RN's own back handler could
    // dismiss the modal before our BackHandler ran.
    isMinimizingRef.current = true;
    setCallMinimizing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Persist the live WebRTC session so unmount doesn't hang up.
    const session = webrtcRef.current;
    if (session && roomId) {
      setPersistedCallSession(roomId, session);
    }
    // Stop ALL timers — a stale 45s/decline timer firing while minimized
    // would otherwise end the call behind the user's back.
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (declineTimerRef.current) { clearTimeout(declineTimerRef.current); declineTimerRef.current = null; }
    setMinimizedCall({
      remoteName: displayName || remoteName || 'Call',
      remotePhotoURL: remotePhoto || remotePhotoURL || null,
      startedAt: Date.now() - elapsedRef.current * 1000,
      callId: roomId || '',
      params: {
        roomId: roomId || '',
        role,
        ...(calleeUid ? { calleeUid } : {}),
        ...(remoteUid ? { remoteUid } : {}),
        ...(remoteName ? { remoteName } : {}),
        // 2026-10-11 FIX: carry identity through the minimize → return
        // cycle so the returned screen stays fully functional.
        ...(myUid ? { myUid } : {}),
        ...(myName ? { myName } : {}),
        // 2026-10-29 Fix #18: carry the speaker choice through the
        // minimize → return cycle so the returned screen's button
        // shows the true route (params are strings — 'true'/'false').
        speakerOn: speakerOnRef.current ? 'true' : 'false',
        // 2026-10-13: DP ও minimize → return সাইকেলে টিকে থাকে, ফলে ফেরত
        // আসা স্ক্রিন Firebase থেকে আবার না এনে সাথে সাথে DP দেখায়।
        ...((remotePhoto || remotePhotoURL) ? { remotePhotoURL: (remotePhoto || remotePhotoURL) as string } : {}),
      },
    });
    router.back();
  }, [roomId, role, calleeUid, remoteUid, remoteName, displayName, remotePhoto, remotePhotoURL, myUid, myName, endCall, router]);

  // ── Back button → MINIMIZE (2026-10-11 Issue #8, Sumon's order) ──────────
  // Pressing back during a connected call minimizes it (audio continues);
  // the floating CallMinimizeBar lets the user return.
  // 2026-10-11 FIX: use navigation 'beforeRemove' instead of BackHandler.
  // React Navigation's own back handler could win the race and dismiss the
  // modal before our BackHandler ran — the screen unmounted without
  // minimizeCall, and cleanup ended the call. beforeRemove intercepts EVERY
  // dismissal path (hardware back, gesture, programmatic) reliably.
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      // Already minimizing/ending — let the navigation proceed.
      if (isMinimizingRef.current || isCallMinimizing() || cleaningUpRef.current) return;
      // 2026-10-29 Fix #18: Back minimizes in EVERY non-terminal state.
      // Back during dialing used to proceed to unmount → hangup (the
      // boss's bug report); now it minimizes exactly like a connected
      // call. Only 'ended'/'declined' let back proceed — the screen is
      // already leaving via endCall there.
      const backState = callStateRef.current;
      if (backState === 'ended' || backState === 'declined') return;
      e.preventDefault();
      minimizeCall();
    });
    return unsub;
  }, [navigation, minimizeCall]);

  // ── Fetch remote user's DP from Firebase (fallback if nav param missing) ──
  useEffect(() => {
    if (remotePhotoURL || !remoteUid) return;
    let cancelled = false;
    (async () => {
      try {
        const { get, ref } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        const snap = await get(ref(database, `users/${remoteUid}/photoURL`));
        if (!cancelled && snap.exists() && typeof snap.val() === 'string') {
          setRemotePhoto(snap.val() as string);
        }
      } catch { /* non-critical — initial letter fallback remains */ }
    })();
    return () => { cancelled = true; };
  }, [remoteUid, remotePhotoURL]);

  // ── WebRTC P2P engine init ──────────────────────────────────────────────
  // 2026-10-19 (Sumon): MOUNT-ONCE. Route params are immutable for a screen
  // instance, and the cleanup below ends the live call — re-running init on
  // a param change would drop the call. So params are snapshotted at mount
  // (paramsRef) and every other mutable input routes through refs
  // (endCallRef, tRef). Deps are intentionally [updateCallState, startTimer]
  // — both stable useCallbacks — so this runs exactly once per screen
  // instance. No eslint-disable: the dep list is complete for stable inputs.
  useEffect(() => {
    const { roomId, role, remoteUid, calleeUid, myUid, myName, myPhotoURL, isReturning } = paramsRef.current;
    const endCall = endCallRef.current;
    const t = tRef.current;
    mountedRef.current   = true;
    cleaningUpRef.current = false;
    // 2026-10-11 FIX: track mount state at module level so endCall only
    // navigates when this screen is actually on screen.
    setCallScreenMounted(true);

    if (isExpoGo()) return;

    // 2026-10-11 Issue #8: returning from minimized call — reattach to the
    // persisted WebRTC session instead of dialing anew.
    if (isReturning && roomId) {
      const persisted = getPersistedCallSession(roomId) as WebRTCCallSession | null;
      if (persisted) {
        webrtcRef.current = persisted;
        // 2026-10-29 Fix #18: the session exists from here on, so the
        // speaker button is live on the returned screen too.
        setSpeakerReady(true);
        // 2026-10-22 (deep audit): REBIND the session's callbacks to THIS
        // live instance. The session was created by the previous (now
        // unmounted) screen and its handlers still close over that dead
        // instance — remote hangup / errors / state changes would fire
        // into a screen that no longer exists. These handlers mirror the
        // fresh-dial ones passed to startCall below.
        persisted.setCallbacks({
          onRemoteStream: () => {
            if (!mountedRef.current || !webrtcRef.current) return;
            updateCallState('connected');
            startTimer();
            if (declineTimerRef.current) {
              clearTimeout(declineTimerRef.current);
              declineTimerRef.current = null;
            }
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
          },
          onConnectionChange: (state) => {
            if (!mountedRef.current || !webrtcRef.current) return;
            if (state === 'connected') {
              updateCallState('connected');
              startTimer();
              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
              }
            } else if (state === 'remote-ended') {
              updateCallState('ended');
              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
              }
              // 2026-10-23 (Sumon bug): the endCall(false) shortcut is
              // ONLY for a genuinely minimized call (screen not mounted).
              // On this returning path a persisted session ALWAYS exists,
              // so the old check stranded the visible screen on
              // "Call Ended" forever.
              if (getPersistedCallSession(roomId) && !isCallScreenMounted()) {
                endCall(false);
                return;
              }
              timeoutRef.current = setTimeout(() => {
                if (mountedRef.current) endCall(true);
              }, 1500);
            }
          },
          onError: ({ fatal, message }) => {
            if (fatal) {
              if (mountedRef.current) {
                mountedRef.current = false;
                Alert.alert(
                  t('audioCall.callEndedTitle'),
                  message,
                  [{ text: t('audioCall.ok'), onPress: () => endCall(true) }],
                  { onDismiss: () => endCall(true) },
                );
              }
            } else {
              Alert.alert(
                t('audioCall.audioNoticeTitle'),
                message,
              );
            }
          },
        } satisfies WebRTCCallCallbacks);
        isMinimizingRef.current = false;
        // 2026-10-11 FIX: clear the module-level minimizing flag — we're
        // back on the call screen, future unmounts must hang up normally.
        setCallMinimizing(false);
        // 2026-10-29 Fix #18: restore the TRUE state. A call minimized
        // while still dialing must come back dialing — the old code
        // unconditionally faked 'connected' (and started the timer on a
        // live dial). The fresh instance already starts in 'calling'
        // (caller) / 'connecting' (callee), so the dialing branch leaves
        // it alone and only re-arms the 45 s no-answer cap (the original
        // timeout was stopped on minimize; without a re-arm a returned
        // but unanswered dial would ring forever — the user can still
        // hang up, and the cap bounds it).
        // Known edge (not expanded here): the fresh-dial decline/online
        // listeners were unsubscribed at minimize-unmount and are not
        // re-attached on return, so a decline that lands while
        // minimized-during-dialing surfaces via this cap, not instantly.
        if (persisted.isConnected()) {
          // Restore connected state — the call never dropped.
          callStateRef.current = 'connected';
          if (mountedRef.current) {
            setCallState('connected');
            // Resume the timer from the minimized duration.
            const min = getMinimizedCall();
            if (min) {
              elapsedRef.current = Math.floor((Date.now() - min.startedAt) / 1000);
              setElapsed(elapsedRef.current);
            }
            if (!timerRef.current) {
              timerRef.current = setInterval(() => {
                if (mountedRef.current) {
                  elapsedRef.current += 1;
                  setElapsed(e => e + 1);
                }
              }, 1000);
            }
          }
        } else {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(() => {
            if (mountedRef.current && callStateRef.current !== 'connected') {
              endCall(true);
            }
          }, 45_000);
        }
        clearPersistedCallSession();
        setMinimizedCall(null);
        return;
      }
      // No persisted session (e.g. app was killed) — fall through to end.
      endCall(true);
      return;
    }

    (async () => {
      const micGranted = await requestMicPermission({
        title: t('audioCall.micPermissionTitle'),
        message: t('audioCall.micPermissionMessage'),
        allow: t('audioCall.allow'),
        deny: t('audioCall.deny'),
        askLater: t('audioCall.askLater'),
      });
      if (!mountedRef.current) return;
      if (!micGranted) {
        // Android denial: getUserMedia would reject with a generic native
        // error, so surface actionable guidance here instead. endCall runs
        // immediately (not in the Alert button) because an alert dismissed
        // without tapping OK must not leave the screen stuck on "Ringing...".
        alertMicDeniedWithSettings(
          t('audioCall.micDeniedTitle'),
          t('audioCall.micDeniedMessage'),
          t('audioCall.ok'),
        );
        endCall(true);
        return;
      }

      const session = new WebRTCCallSession();
      webrtcRef.current = session;
      setSpeakerReady(true);
      // 2026-10-29 Fix #18: the minimize button renders from mount, so a
      // minimize tapped before this line (during mic permission) would
      // otherwise leave a session that is neither persisted nor hung up.
      // If a minimize is already in flight, persist it now so the bar's
      // return path can reattach.
      if (isCallMinimizing() && roomId) {
        setPersistedCallSession(roomId, session);
      }

      // startCall never throws — failures surface via onError below.
      await session.startCall({
        myUid,
        remoteUid,
        isCaller: role === 'caller',
        onRemoteStream: () => {
          if (!mountedRef.current || !webrtcRef.current) return;
          // Remote audio is flowing — call connected, start timer
          updateCallState('connected');
          startTimer();
          // Cancel decline timer — it was an accept, not a reject
          if (declineTimerRef.current) {
            clearTimeout(declineTimerRef.current);
            declineTimerRef.current = null;
          }
          // Cancel ringing timeout now that connection is established
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
        },
        onConnectionChange: (state) => {
          if (!mountedRef.current || !webrtcRef.current) return;
          if (state === 'connected') {
            // Call connected — start timer
            updateCallState('connected');
            startTimer();
            // Cancel ringing timeout now that connection is established
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
          } else if (state === 'remote-ended') {
            // Remote party hung up — show 'ended', then navigate back
            updateCallState('ended');
            // Clear the connection timeout before reusing the ref, so the
            // stale 45 s timer can't fire later and leak.
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
            // 2026-10-13: মিনিমাইজড কলে রিমোট কেটে দিলে সাথে সাথে শেষ করো —
            // স্ক্রিন তো দেখা যাচ্ছে না, "Call Ended" দেখানোর কিছু নেই।
            // দেরি করা টাইমার রাখলে পুরনো closure থেকে ১.৫ সেকেন্ড পরে endCall
            // চলতো; ব্যবহারকারী ওই ফাঁকে কলে ফিরলে টাইমারটি লাইভ সেশন মেরে
            // নতুন স্ক্রিন pop করে দিতো।
            // 2026-10-23 (Sumon bug): that shortcut must require the
            // screen to be NOT mounted — a stale persisted record for
            // this deterministic roomId otherwise stranded the visible
            // screen on "Call Ended" with a dead End button.
            if (getPersistedCallSession(roomId) && !isCallScreenMounted()) {
              endCall(false);
              return;
            }
            // Short delay so user can read "Call Ended" before dismissal
            timeoutRef.current = setTimeout(() => {
              if (mountedRef.current) endCall(true);
            }, 1500);
          }
        },
        onError: ({ fatal, message }) => {
          if (fatal) {
            // Surface the reason before leaving — previously the screen just
            // vanished on failures like NAT-traversal failure or mic denial.
            if (mountedRef.current) {
              mountedRef.current = false;
              Alert.alert(
                t('audioCall.callEndedTitle'),
                message,
                [{ text: t('audioCall.ok'), onPress: () => endCall(true) }],
                // M1 fix: Android back-button/tap-outside dismisses without
                // onPress — ensure the call actually ends and mic releases.
                { onDismiss: () => endCall(true) },
              );
            }
          } else {
            // Non-fatal (e.g. speaker-routing notice) — tell the user instead
            // of only logging; this fires at most once per session.
            Alert.alert(
              t('audioCall.audioNoticeTitle'),
              message,
            );
          }
        },
      });

      if (!mountedRef.current) return;

      // Caller: write Firebase signal so callee receives IncomingCallModal
      if (role === 'caller') {
        // 2026-10-13: capture the generation — see the guard after initiateCall.
        const genAtDial = callGenRef.current;
        // ONLINE CHECK (2026-10-09): show "Calling..." if callee is offline,
        // "Ringing" only when they're online. Professional like IMO.
        // FIX (2026-10-10): Use real-time listener so "Calling" upgrades to
        // "Ringing" if callee comes online during call setup.
        try {
          const { get, ref, onValue } = await import('firebase/database');
          const { database } = await import('@/src/config/firebase');
          const onlineRef = ref(database, `users/${calleeUid}/online`);
          const onlineSnap = await get(onlineRef);
          const calleeOnline = onlineSnap.exists() && onlineSnap.val() === true;
          if (mountedRef.current) {
            updateCallState(calleeOnline ? 'ringing' : 'calling');
          }
          // Real-time updates: if callee comes online, switch to ringing
          const onlineUnsub = onValue(onlineRef, (snap) => {
            if (!mountedRef.current) return;
            const isOnline = snap.exists() && snap.val() === true;
            const current = callStateRef.current;
            if (isOnline && current === 'calling') {
              updateCallState('ringing');
            } else if (!isOnline && current === 'ringing') {
              updateCallState('calling');
            }
          });
          // Store for cleanup (FIX 2026-10-10: was assigning onto
          // signalUnsubRef.current while null → TypeError → the reject
          // listener below never attached, caller stuck on "Calling").
          onlineUnsubRef.current = onlineUnsub;
          // REJECT SYNC (2026-10-09): watch the call signal node. If the
          // callee declines (node removed) before WebRTC connects, show
          // "Declined" instead of ringing forever.
          // RACE FIX (2026-10-09): Firebase fires the callback immediately
          // with null (node doesn't exist yet — initiateCall hasn't run).
          // Only treat disappearance as rejection AFTER we've seen the node
          // exist at least once.
          // ACCEPT RACE FIX: callee removes the node on ACCEPT too. Wait 3s
          // FIX (2026-10-10): Distinguish accept from reject.
          // - Callee ACCEPTS: updates signal with status='accepted' (node still exists)
          //   → cancel any decline timer, call is connecting.
          // - Callee REJECTS: deletes the signal node
          //   → start decline timer, show 'declined' after 1.5s.
          const signalRef = ref(database, `calls/${calleeUid}`);
          let signalSeen = false;
          // FIX (2026-10-10): once 'accepted' is seen, a later node deletion
          // must NEVER be treated as a reject — it means the call ended, not
          // that it was declined. (Defensive: the _layout audio-call cleanup
          // no longer deletes accepted signals, but no other path may either.)
          let acceptedSeen = false;
          signalUnsubRef.current = onValue(signalRef, (snap) => {
            if (snap.exists()) {
              signalSeen = true;
              const status = (snap.val() as Record<string, unknown>)?.status;
              if (status === 'accepted') {
                acceptedSeen = true;
                // Callee accepted — cancel any pending decline timer.
                if (declineTimerRef.current) {
                  clearTimeout(declineTimerRef.current);
                  declineTimerRef.current = null;
                }
              }
              return;
            }
            if (!acceptedSeen && signalSeen && mountedRef.current &&
                (callStateRef.current === 'ringing' || callStateRef.current === 'calling')) {
              // Node deleted = rejected. Wait 0.5s for fast feedback.
              // (Accept uses status='accepted' update, not deletion, so no
              // false positive here.)
              if (declineTimerRef.current) clearTimeout(declineTimerRef.current);
              declineTimerRef.current = setTimeout(() => {
                if (mountedRef.current &&
                    (callStateRef.current === 'ringing' || callStateRef.current === 'calling')) {
                  updateCallState('declined');
                  setTimeout(() => { if (mountedRef.current) endCall(true); }, 1000);
                }
              }, 500);
            }
          });
        } catch { /* non-critical — default ringing state remains */ }
        try {
          await initiateCall(calleeUid, {
            callerId:        myUid,
            callerName:      myName,
            // RC6 fix Issue 8: include caller's photo so callee's
            // IncomingCallModal shows the caller's avatar, not just initials.
            ...(myPhotoURL ? { callerPhotoURL: myPhotoURL } : {}),
            roomId,
          });
          // 2026-10-13: generation guard — the user may have hung up while
          // initiateCall was in flight. endCall's cleanup then ran BEFORE
          // the set() above landed, leaving a stale ringing signal (the
          // callee's phone would ring for a dead call). Clean it now.
          if (callGenRef.current !== genAtDial) {
            removeCallSignal(calleeUid).catch(() => {/* background: safe to swallow */});
            import('firebase/database').then(async ({ ref, onDisconnect }) => {
              try {
                const { database } = await import('@/src/config/firebase');
                await onDisconnect(ref(database, `calls/${calleeUid}`)).cancel();
              } catch { /* non-critical */ }
            });
          }
        } catch { /* non-critical — WebRTC signaling is already live */ }
      }

      // Connection timeout (both roles): if the call never reaches
      // 'connected' within 45 s, hang up. Previously only the caller had
      // this — a callee whose offer/ICE never completed sat on
      // "Connecting..." forever.
      timeoutRef.current = setTimeout(() => {
        if (mountedRef.current && callStateRef.current !== 'connected') {
          endCall(true);
        }
      }, 45_000);
      // M4 fix: never-throws contract could regress — guard the IIFE.
    })().catch(() => {});

    return () => {
      signalUnsubRef.current?.();
      signalUnsubRef.current = null;
      onlineUnsubRef.current?.();
      onlineUnsubRef.current = null;
      // 2026-10-11 FIX: track unmount at module level too.
      setCallScreenMounted(false);
      // 2026-10-11 Issue #8: skip hangup when minimizing — the session
      // persists at module level and audio continues. Check the module
      // flag as well as the ref (belt and suspenders against the
      // back-handler race).
      if (!cleaningUpRef.current && !isMinimizingRef.current && !isCallMinimizing()) endCall(false);
    };
  }, [updateCallState, startTimer]);

  // ── Remote mute sync listener (2026-10-09) ──────────────────────────────
  // Shows a muted indicator when the other side mutes.
  useEffect(() => {
    if (!roomId) return;
    const otherUid = role === 'caller' ? calleeUid : remoteUid;
    if (!otherUid) return;
    let unsub: (() => void) | null = null;
    (async () => {
      try {
        const { ref, onValue } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        unsub = onValue(ref(database, `callMute/${roomId}/${otherUid}`), (snap) => {
          if (mountedRef.current) setRemoteMuted(snap.val() === true);
        });
      } catch { /* non-critical */ }
    })();
    return () => { unsub?.(); };
  }, [roomId, role, calleeUid, remoteUid]);

  // ── Mic toggle ────────────────────────────────────────────────────────────
  // RC6 fix pattern: native SDK call OUTSIDE setState callback
  const handleToggleMic = useCallback(() => {
    const session = webrtcRef.current;
    if (!session) return;
    try {
      const newMuted = session.toggleMute();
      mutedRef.current = newMuted;
      setMuted(newMuted);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // MUTE SYNC (2026-10-09): publish mute state so the other side
      // sees the muted indicator. Best-effort, never blocks.
      if (roomId && myUid) {
        import('firebase/database').then(async ({ ref, set }) => {
          try {
            const { database } = await import('@/src/config/firebase');
            await set(ref(database, `callMute/${roomId}/${myUid}`), newMuted);
          } catch { /* non-critical */ }
        });
      }
    } catch { /* non-critical */ }
  }, [roomId, myUid]);

  // ── Speaker toggle (2026-10-29 Fix #18) ──────────────────────────────
  // RC6 fix pattern (same as mic): native SDK call OUTSIDE setState.
  // Works in dialing AND connected states — the audio session is started
  // in startCall(), before any peer connection, so route switching is
  // live from "Calling..." onward. OFF returns to Bluetooth-first
  // (headset, then earpiece) via the session — never yanks audio off a
  // Bluetooth headset.
  const handleToggleSpeaker = useCallback(() => {
    const session = webrtcRef.current;
    if (!session) return;
    try {
      const next = !speakerOnRef.current;
      session.setSpeakerphone(next);
      speakerOnRef.current = next;
      setSpeakerOn(next);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch { /* non-critical */ }
  }, []);

  // ── End call button ───────────────────────────────────────────────────────
  const handleEndCall = useCallback(() => {
    endCall(true);
  }, [endCall]);

  // ── Status text ───────────────────────────────────────────────────────────
  const statusText =
    callState === 'calling'    ? t('audioCall.calling')
    : callState === 'ringing'    ? t('audioCall.ringing')
    : callState === 'connecting' ? t('audioCall.connecting')
    : callState === 'ended'      ? t('audioCall.ended')
    : callState === 'declined'   ? t('audioCall.declined')
    : formatElapsed(elapsed);

  const statusColor =
    callState === 'connected' ? C.green
    : callState === 'ended'   ? C.red
    : callState === 'declined' ? C.red
    : C.muted;

  // 2026-10-29 Fix #18: the minimize button shows in EVERY non-terminal
  // state — dialing included (previously connected-only, which is why
  // dialing had no minimize button at all).
  const showMinimize =
    callState === 'connected' || callState === 'calling' ||
    callState === 'ringing' || callState === 'connecting';

  const topPad = Platform.OS === 'web' ? 67 : 0;

  // ── IMO port (2026-10-19): call screen rebuilt in IMO's style.
  // Layout mirrors IMO's in-call screen (aly.xml): gradient background,
  // top-centered avatar (72dp) + name + status, bottom CallOptView controls
  // (48dp icon circles with labels below), IMO red #fa5353 end button (65dp).
  // All call logic (WebRTC, timers, mute sync, minimize, audioOwner guard)
  // is untouched — this is a pure UI reskin.
  return (
    <View style={{ flex: 1 }}>
      <StatusBar barStyle="light-content" backgroundColor="#07020F" />
      <LinearGradient
        colors={[IMO_CALL.bgGradient[0], IMO_CALL.bgGradient[1]]}
        style={{ flex: 1 }}
      >
        <SafeAreaView
          style={{
            flex: 1, alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: topPad + 12, paddingBottom: 40,
          }}
          edges={['top', 'bottom']}
        >

          {/* ── Remote party header (IMO aly.xml: avatar + name + status) ── */}
          <View style={{ alignItems: 'center', marginTop: 48 }}>
            <View style={{
              width: IMO_CALL.inCallAvatar,
              height: IMO_CALL.inCallAvatar,
              borderRadius: IMO_CALL.inCallAvatar / 2,
              backgroundColor: 'rgba(255,255,255,0.08)',
              alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
            }}>
              {remotePhoto ? (
                <Image
                  source={{ uri: remotePhoto }}
                  style={{
                    width: IMO_CALL.inCallAvatar,
                    height: IMO_CALL.inCallAvatar,
                    borderRadius: IMO_CALL.inCallAvatar / 2,
                  }}
                />
              ) : (
                <Text style={{ color: IMO_CALL.text, fontSize: 30, fontWeight: '700' }}>
                  {displayName[0]?.toUpperCase() ?? '?'}
                </Text>
              )}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16 }}>
              <Text style={{
                color: IMO_CALL.text, fontSize: 22, fontWeight: '700',
                letterSpacing: 0.2,
              }}>
                {displayName || 'Vee User'}
              </Text>
              {remoteMuted && (
                <View style={{
                  marginLeft: 8, backgroundColor: 'rgba(250,83,83,0.18)',
                  borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4,
                  flexDirection: 'row', alignItems: 'center',
                }}>
                  <Feather name="mic-off" size={12} color={IMO_CALL.declineRed} />
                  <Text style={{ color: IMO_CALL.declineRed, fontSize: 11, fontWeight: '700', marginLeft: 4 }}>
                    Muted
                  </Text>
                </View>
              )}
            </View>

            <Text style={{
              color: statusColor === C.green ? IMO_CALL.answerGreen
                : (statusColor === C.red ? IMO_CALL.declineRed : IMO_CALL.mutedText),
              fontSize: 14, fontWeight: callState === 'connected' ? '600' : '400',
              marginTop: 6,
            }}>
              {statusText}
            </Text>
          </View>

          {/* ── Call controls (IMO CallOptView: icon + label) ── */}
          <View style={{ alignItems: 'center', width: '100%' }}>
            <View style={{
              flexDirection: 'row', justifyContent: 'center',
              alignItems: 'flex-start', marginBottom: 28,
            }}>
              <CallOptButton
                icon={muted ? 'mic-off' : 'mic'}
                label={muted ? t('audioCall.unmute') : t('audioCall.mute')}
                onPress={handleToggleMic}
                active={muted}
              />
              {/* Speaker (2026-10-29 Fix #18): the 2026-10-19 disabled
                  placeholder is gone — session.setSpeakerphone() has been
                  REAL since the 2026-10-24 Bluetooth fix (LiveKit
                  AudioSession route switching), so the button toggles
                  loudspeaker in dialing AND connected states. Active tint
                  = speaker on. 2026-10-20 (boss) still holds: NO writing
                  under the speaker icon — icon only. */}
              <CallOptButton
                icon="volume-2"
                label=""
                onPress={handleToggleSpeaker}
                active={speakerOn}
                disabled={!speakerReady}
              />
              {showMinimize && (
                <CallOptButton
                  icon="chevron-down"
                  label={t('audioCall.minimize')}
                  onPress={minimizeCall}
                />
              )}
            </View>

            {/* End call — IMO red #fa5353, 65dp (a7m.xml / h5) */}
            <Pressable
              onPress={handleEndCall}
              hitSlop={8}
              style={{
                width: IMO_CALL.actionSize, height: IMO_CALL.actionSize,
                borderRadius: IMO_CALL.actionSize / 2,
                backgroundColor: IMO_CALL.declineRed,
                alignItems: 'center', justifyContent: 'center',
                shadowColor: IMO_CALL.declineRed, shadowOpacity: 0.5,
                shadowRadius: 18, shadowOffset: { width: 0, height: 6 },
                elevation: 10,
              }}
            >
              <Feather name="phone-off" size={28} color="#fff" />
            </Pressable>
          </View>
        </SafeAreaView>
      </LinearGradient>
    </View>
  );
}
