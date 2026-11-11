/**
 * /user-profile?uid=xxx&name=xxx&roomId=yyy
 * Route wrapper — renders ANOTHER user's profile using the SAME ProfileScreen
 * component as own profile (identical layout). Only differences:
 * - No settings icon
 * - Three-dots shows their vId
 * - Bottom: Chat/Add + Follow buttons instead of Edit
 * - When roomId is present (opened from a voice room), the profile shows
 *   the imo-style room bottom row (+ Follow / Chat-or-Say-hi / gift) and
 *   the role-gated 5-icon bar (2026-11-11, boss).
 */

import { useEffect } from 'react';
import { Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import ProfileScreen from './profile/index';

export default function UserProfileRoute() {
  const { t } = useTranslation();
  const { uid, name, roomId } = useLocalSearchParams<{ uid: string; name: string; roomId?: string }>();

  // Guard: without a uid the screen would subscribe to the users/ root.
  useEffect(() => {
    if (!uid) {
      Alert.alert(t('userProfile.error'), t('userProfile.userNotFound'), [
        // 2026-10-12 audit fix: on a cold deep link there's no history —
        // router.back() is a no-op leaving a blank screen. Fall back to /home.
        { text: 'OK', onPress: () => { if (router.canGoBack()) router.back(); else router.replace('/home'); } },
      ]);
    }
  }, [uid, t]);

  if (!uid) return null;

  return <ProfileScreen targetUid={uid} targetName={name} roomId={roomId} />;
}
