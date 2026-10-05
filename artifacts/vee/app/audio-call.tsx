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
import { Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import AudioCallScreen from '@/src/features/audio-call/AudioCallScreen';

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
  }>();

  // Guard: a malformed deep link (e.g. vee://audio-call with missing params)
  // must not mount the call screen — with empty UIDs it would run a bogus
  // WebRTC session and write/remove signaling at the `calls/` root.
  const hasParams = !!roomId && !!remoteUid && !!calleeUid && !!myUid;
  useEffect(() => {
    if (!hasParams) {
      Alert.alert(t('chat.error'), t('audioCall.invalidCall'), [
        { text: t('audioCall.ok'), onPress: () => router.back() },
      ]);
    }
  }, [hasParams, t]);

  if (!hasParams) return null;

  return (
    <AudioCallScreen
      roomId={roomId ?? ''}
      role={role === 'callee' ? 'callee' : 'caller'}
      remoteUid={remoteUid ?? ''}
      remoteName={remoteName ?? 'Unknown'}
      remotePhotoURL={remotePhotoURL}
      calleeUid={calleeUid ?? ''}
      myUid={myUid ?? ''}
      myName={myName ?? 'Vee User'}
      myPhotoURL={myPhotoURL}
    />
  );
}
