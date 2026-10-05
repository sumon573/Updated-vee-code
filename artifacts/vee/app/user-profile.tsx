/**
 * /user-profile?uid=xxx&name=xxx
 * Route wrapper for UserProfileScreen
 */

import { useEffect } from 'react';
import { Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import UserProfileScreen from '@/src/features/user-profile/UserProfileScreen';

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

  return <UserProfileScreen uid={uid} name={name ?? 'User'} />;
}
