/**
 * /user-profile?uid=xxx&name=xxx
 * Route wrapper — renders ANOTHER user's profile using the SAME ProfileScreen
 * component as own profile (identical layout). Only differences:
 * - No settings icon
 * - Three-dots shows their vId
 * - Bottom: Chat/Add + Follow buttons instead of Edit
 */

import { useEffect } from 'react';
import { Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import ProfileScreen from './profile/index';

export default function UserProfileRoute() {
  const { t } = useTranslation();
  const { uid, name } = useLocalSearchParams<{ uid: string; name: string }>();

  // Guard: without a uid the screen would subscribe to the users/ root.
  useEffect(() => {
    if (!uid) {
      Alert.alert(t('userProfile.error'), t('userProfile.userNotFound'), [
        { text: 'OK', onPress: () => router.back() },
      ]);
    }
  }, [uid, t]);

  if (!uid) return null;

  return <ProfileScreen targetUid={uid} targetName={name} />;
}
