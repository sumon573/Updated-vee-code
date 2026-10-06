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
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { initiateCall, removeCallSignal } from './services/firebaseCallService';
import { WebRTCCallSession } from './services/webrtcCallService';
import { alertMicDeniedWithSettings } from '@/src/utils/permissionAlert';

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

type CallState = 'ringing' | 'connecting' | 'connected' | 'ended';

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
}: AudioCallProps) {
  const router = useRouter();
  const { t } = useTranslation();

  // ── Refs ──────────────────────────────────────────────────────────────────
  const webrtcRef      = useRef<WebRTCCallSession | null>(null);
  const mountedRef     = useRef(true);
  const cleaningUpRef  = useRef(false);
  const callStateRef   = useRef<CallState>(role === 'caller' ? 'ringing' : 'connecting');
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutedRef       = useRef(false);
  const speakerOnRef   = useRef(true);

  // ── State ──────────────────────────────────────────────────────────────────
  const [callState, setCallState] = useState<CallState>(callStateRef.current);
  const [muted,     setMuted]     = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [elapsed,   setElapsed]   = useState(0);
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
      if (mountedRef.current) setElapsed(e => e + 1);
    }, 1000);
  }, []);

  // ── End call (cleanup + navigate back) ───────────────────────────────────
  const endCall = useCallback((goBack = true) => {
    if (cleaningUpRef.current) return;
    cleaningUpRef.current = true;

    // Stop timers
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }

    // Remove Firebase signaling (caller removes it; callee already removed on accept)
    if (role === 'caller') {
      removeCallSignal(calleeUid).catch(() => {/* background: safe to swallow — signaling cleanup */});
    }

    // WebRTC teardown — the session owns the peer connection, RTDB
    // listeners, and the ephemeral signaling node.
    const session = webrtcRef.current;
    webrtcRef.current = null;
    mountedRef.current = false;

    if (session) {
      try { session.hangup(); } catch { /* non-critical */ }
    }

    if (goBack) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.back();
    }
  }, [role, calleeUid, roomId, router]);

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
  useEffect(() => {
    mountedRef.current   = true;
    cleaningUpRef.current = false;

    if (isExpoGo()) return;

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
        try {
          await initiateCall(calleeUid, {
            callerId:        myUid,
            callerName:      myName,
            // RC6 fix Issue 8: include caller's photo so callee's
            // IncomingCallModal shows the caller's avatar, not just initials.
            ...(myPhotoURL ? { callerPhotoURL: myPhotoURL } : {}),
            roomId,
          });
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
    })();

    return () => {
      if (!cleaningUpRef.current) endCall(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, myUid, myName]);

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
    } catch { /* non-critical */ }
  }, []);

  // ── Speaker toggle ────────────────────────────────────────────────────────
  const handleToggleSpeaker = useCallback(() => {
    const session = webrtcRef.current;
    if (!session) return;
    try {
      const newSpeaker = !speakerOnRef.current;
      speakerOnRef.current = newSpeaker;
      session.setSpeakerphone(newSpeaker);
      setSpeakerOn(newSpeaker);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch { /* non-critical */ }
  }, []);

  // ── End call button ───────────────────────────────────────────────────────
  const handleEndCall = useCallback(() => {
    endCall(true);
  }, [endCall]);

  // ── Status text ───────────────────────────────────────────────────────────
  const statusText =
    callState === 'ringing'    ? t('audioCall.ringing')
    : callState === 'connecting' ? t('audioCall.connecting')
    : callState === 'ended'      ? t('audioCall.ended')
    : formatElapsed(elapsed);

  const statusColor =
    callState === 'connected' ? C.green
    : callState === 'ended'   ? C.red
    : C.muted;

  const topPad = Platform.OS === 'web' ? 67 : 0;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <SafeAreaView
        style={{
          flex: 1, alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: topPad + 20, paddingBottom: 48,
        }}
        edges={['top', 'bottom']}
      >

        {/* ── Remote party info ── */}
        <View style={{ alignItems: 'center', marginTop: 32 }}>
          {/* Avatar */}
          <View style={{
            width: 120, height: 120, borderRadius: 60,
            backgroundColor: 'rgba(124,58,237,0.25)',
            borderWidth: 3, borderColor: C.glow,
            alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden',
            shadowColor: C.glow, shadowOpacity: 0.45,
            shadowRadius: 28, shadowOffset: { width: 0, height: 8 },
            elevation: 12,
          }}>
            {remotePhoto ? (
              <Image
                source={{ uri: remotePhoto }}
                style={{ width: 120, height: 120, borderRadius: 60 }}
              />
            ) : (
              <Text style={{ color: C.text, fontSize: 44, fontWeight: '900' }}>
                {remoteName[0]?.toUpperCase() ?? '?'}
              </Text>
            )}
          </View>

          {/* Name */}
          <Text style={{
            color: C.text, fontSize: 28, fontWeight: '900',
            marginTop: 22, letterSpacing: 0.2,
          }}>
            {remoteName}
          </Text>

          {/* Status / timer */}
          <Text style={{
            color: statusColor, fontSize: 15,
            fontWeight: callState === 'connected' ? '700' : '500',
            marginTop: 8,
          }}>
            {statusText}
          </Text>
        </View>

        {/* ── Call controls ── */}
        <View style={{ alignItems: 'center', gap: 36, width: '100%' }}>
          {/* Mic + Speaker row */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 32 }}>
            {/* Mute / Unmute */}
            <Pressable
              onPress={handleToggleMic}
              hitSlop={10}
              style={{
                width: 68, height: 68, borderRadius: 34,
                backgroundColor: muted
                  ? C.primary
                  : 'rgba(255,255,255,0.10)',
                borderWidth: 1.5,
                borderColor: muted ? C.glow : 'rgba(255,255,255,0.2)',
                alignItems: 'center', justifyContent: 'center',
                shadowColor: muted ? C.glow : 'transparent',
                shadowOpacity: 0.5, shadowRadius: 14,
              }}
            >
              <Feather name={muted ? 'mic-off' : 'mic'} size={26} color={C.text} />
            </Pressable>

            {/* Speaker toggle */}
            <Pressable
              onPress={handleToggleSpeaker}
              hitSlop={10}
              style={{
                width: 68, height: 68, borderRadius: 34,
                backgroundColor: !speakerOn
                  ? C.primary
                  : 'rgba(255,255,255,0.10)',
                borderWidth: 1.5,
                borderColor: !speakerOn ? C.glow : 'rgba(255,255,255,0.2)',
                alignItems: 'center', justifyContent: 'center',
                shadowColor: !speakerOn ? C.glow : 'transparent',
                shadowOpacity: 0.5, shadowRadius: 14,
              }}
            >
              <Feather name={speakerOn ? 'volume-2' : 'volume-x'} size={26} color={C.text} />
            </Pressable>
          </View>

          {/* End call */}
          <Pressable
            onPress={handleEndCall}
            hitSlop={8}
            style={{
              width: 76, height: 76, borderRadius: 38,
              backgroundColor: C.red,
              alignItems: 'center', justifyContent: 'center',
              shadowColor: C.red, shadowOpacity: 0.65,
              shadowRadius: 22, shadowOffset: { width: 0, height: 6 },
              elevation: 12,
            }}
          >
            <Feather name="phone-off" size={30} color={C.text} />
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
