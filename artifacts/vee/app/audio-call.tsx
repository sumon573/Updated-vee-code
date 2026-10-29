/**
 * Audio Call Route — RC6 Issue 8 fix
 *
 * Reads search-param props and renders the AudioCallScreen.
 * Both caller and callee land on this route (role param distinguishes them).
 *
 * Required params:
 *   roomId         — deterministic call room shared by both parties
 *   role           — 'caller' | 'callee'
 *   remoteUid      — UID of the other party
 *   remoteName     — display name of the other party
 *   calleeUid      — UID used for Firebase signaling cleanup
 *   myUid          — UID of the local user
 *   myName         — display name of the local user
 *
 * Optional params:
 *   remotePhotoURL — photo URL of the other party (for avatar display)
 */

import { useEffect } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ErrorFallback, ErrorFallbackProps } from '@/components/ErrorFallback';
import AudioCallScreen from '@/src/features/audio-call/AudioCallScreen';

/**
 * 2026-10-19 stability fix: a render throw in AudioCallScreen used to
 * propagate to the root boundary — full-app fallback, losing all state
 * including a backgrounded voice room. This route-level boundary keeps the
 * crash contained, and "End call & go back" tears down any live WebRTC
 * session (so the mic is not left open) before leaving.
 */
function AudioCallErrorFallback({ error, componentStack, resetError }: ErrorFallbackProps) {
  const { roomId } = useLocalSearchParams<{ roomId?: string }>();

  const handleEndCallAndGoBack = async () => {
    // Best-effort: end any in-progress WebRTC session. hangup() is
    // idempotent, so calling it on a half-built session is safe.
    try {
      const {
        getPersistedCallSession,
        clearPersistedCallSession,
        setMinimizedCall,
      } = await import('@/src/features/audio-call/services/callMinimizeStore');
      const id = typeof roomId === 'string' ? roomId : '';
      const session = (id ? getPersistedCallSession(id) : null) as { hangup?: () => void } | null;
      try {
        session?.hangup?.();
      } catch {
        // non-critical
      }
      try {
        clearPersistedCallSession();
      } catch {
        // non-critical
      }
      try {
        setMinimizedCall(null);
      } catch {
        // non-critical
      }
    } catch {
      // non-critical — still navigate back
    }
    try {
      resetError();
    } catch {
      // non-critical
    }
    if (router.canDismiss()) {
      router.dismiss();
    } else {
      router.replace('/home');
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ErrorFallback error={error} componentStack={componentStack} resetError={resetError} />
      {/* Absolute overlay — ErrorFallback owns its own button layout, so the
          escape is overlaid rather than depending on it. */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 56,
          alignItems: 'center',
          paddingHorizontal: 24,
        }}
        pointerEvents="box-none"
      >
        <Pressable
          onPress={handleEndCallAndGoBack}
          style={({ pressed }) => ({
            paddingVertical: 14,
            paddingHorizontal: 24,
            minWidth: 200,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.10)',
            backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.055)',
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text style={{ color: '#B8A6D9', fontWeight: '600', textAlign: 'center', fontSize: 16 }}>
            End call & go back
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function AudioCallPage() {
  const { t } = useTranslation();
  const {
    roomId,
    role,
    remoteUid,
    remoteName,
    remotePhotoURL,
    calleeUid,
    myUid,
    myName,
    myPhotoURL,
    returning,
    speakerOn,
  } = useLocalSearchParams<{
    roomId: string;
    role: 'caller' | 'callee';
    remoteUid: string;
    remoteName: string;
    remotePhotoURL?: string;
    calleeUid: string;
    myUid: string;
    myName: string;
    myPhotoURL?: string;
    returning?: string;
    speakerOn?: string;
  }>();

  // Guard: a malformed deep link (e.g. vee://audio-call with missing params)
  // must not mount the call screen — with empty UIDs it would run a bogus
  // WebRTC session and write/remove signaling at the `calls/` root.
  // 2026-10-11 Issue #8: when returning from a minimized call, the WebRTC
  // session persists at module level — skip the param guard and reattach.
  const isReturning = returning === 'true';
  const hasParams = !!roomId && !!remoteUid && !!calleeUid && !!myUid;
  useEffect(() => {
    if (!hasParams && !isReturning) {
      Alert.alert(t('chat.error'), t('audioCall.invalidCall'), [
        { text: t('audioCall.ok'), onPress: () => router.back() },
      ]);
    }
  }, [hasParams, isReturning, t]);

  if (!hasParams && !isReturning) return null;

  return (
    <ErrorBoundary FallbackComponent={AudioCallErrorFallback}>
      <AudioCallScreen
        roomId={roomId ?? ''}
        role={role === 'callee' ? 'callee' : 'caller'}
        remoteUid={remoteUid ?? ''}
        remoteName={remoteName || 'Unknown'}
        remotePhotoURL={remotePhotoURL}
        calleeUid={calleeUid ?? ''}
        myUid={myUid ?? ''}
        myName={myName || 'Vee User'}
        myPhotoURL={myPhotoURL}
        isReturning={isReturning}
        initialSpeakerOn={speakerOn === 'true'}
      />
    </ErrorBoundary>
  );
}
