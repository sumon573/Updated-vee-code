import { useEffect } from 'react';
import { Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import InboxScreen from '@/src/features/chat/screens/InboxScreen';

export default function InboxRoute() {
  const { t } = useTranslation();
  const { chatId, participantId, participantName } = useLocalSearchParams<{
    chatId: string;
    participantId: string;
    participantName: string;
  }>();

  // Guard: a deep link without a chatId would subscribe to an empty chat path.
  useEffect(() => {
    if (!chatId) {
      Alert.alert(t('chat.error'), t('chat.chatNotFound'), [
        { text: 'OK', onPress: () => router.back() },
      ]);
    }
  }, [chatId, t]);

  if (!chatId) return null;

  // Safe decode: expo-router params are already decoded, and names with % would throw URIError
  let safeName = participantName ?? t('chat.unknownUser');
  try {
    // Only decode if it looks encoded (contains %)
    if (safeName.includes('%')) safeName = decodeURIComponent(safeName);
  } catch {
    // Keep original on decode failure
  }
  return (
    <InboxScreen
      chatId={chatId}
      participantId={participantId ?? ''}
      participantName={safeName}
    />
  );
}
