/**
 * Complete Profile — for brand-new users (Google or email).
 * Collects: display name + profile photo (DP).
 * White/light mode only.
 *
 * After completion, creates the Firestore user profile and routes to /home.
 * AuthGuard redirects here when an authenticated user has no DB profile.
 */
import { useState } from 'react';
import { View, Text, TextInput, Pressable, Image, Alert, ScrollView } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { getCurrentUser } from '@/src/services/authService';
import { createUser, setupPresence, generateAndReserveVId } from '@/src/services/userService';
import { initializeWallet } from '@/src/features/wallet/walletService';
import { uploadImage } from '@/src/services/cloudinaryService';
import generateVId from '@/src/utils/generateVId';

const C = {
  bg: '#FFFFFF',
  text: '#0A1A33',
  muted: '#6B7280',
  blue: '#1E9BF0',
  error: '#FF4B4B' } as const;

export default function CompleteProfileScreen() {
  const { t } = useTranslation();
  const fbUser = getCurrentUser();

  const [name, setName] = useState(fbUser?.displayName ?? '');
  const [photoLocalUri, setPhotoLocalUri] = useState<string | null>(fbUser?.photoURL ?? null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function handlePickPhoto() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        // Non-fatal — user can continue without a photo
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8 });
      if (!result.canceled && result.assets?.[0]?.uri) {
        setPhotoLocalUri(result.assets[0].uri);
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch {
      // Non-fatal — user can continue without a photo
    }
  }

  async function handleComplete() {
    setErrorMsg('');
    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMsg(t('auth.completeProfile.errorNoName'));
      return;
    }
    if (!fbUser) {
      setErrorMsg(t('auth.errors.generic'));
      return;
    }
    try {
      setLoading(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Reserve a unique Vee ID
      const vId = await generateAndReserveVId(fbUser.uid, generateVId);

      // Upload avatar if it's a local file (Google photoURL is already remote)
      let photoURL = fbUser.photoURL ?? '';
      if (photoLocalUri && !photoLocalUri.startsWith('http')) {
        try {
          const uploaded = await uploadImage(photoLocalUri, {
            folder: 'vee/avatars',
            transformation: 'c_fill,w_400,h_400,q_auto' });
          photoURL = uploaded.url;
        } catch {
          Alert.alert(
            t('auth.signup.photoUploadTitle'),
            t('auth.signup.photoUploadFailed', 'Photo upload failed. You can add it later in Edit Profile.'),
          );
        }
      } else if (photoLocalUri) {
        photoURL = photoLocalUri;
      }

      await createUser({
        uid: fbUser.uid,
        vId,
        name: trimmedName,
        email: fbUser.email ?? '',
        photoURL,
        bio: '',
        createdAt: Date.now(),
        lastSeen: Date.now(),
        online: true });

      await initializeWallet(fbUser.uid).catch(() => {});
      setupPresence(fbUser.uid);

      // AuthGuard will route to /home now that the profile exists
      router.replace('/home');
    } catch (err) {
      setErrorMsg(t('auth.errors.generic'));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* DP picker */}
        <Pressable
          onPress={handlePickPhoto}
          style={{ alignSelf: 'center', marginTop: 20 }}
          accessibilityRole="button"
          accessibilityLabel={t('auth.completeProfile.pickPhoto')}
        >
          <View
            style={{
              width: 120,
              height: 120,
              borderRadius: 60,
              backgroundColor: '#F1F2F6',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              borderWidth: 2,
              borderColor: '#E8E8EC' }}
          >
            {photoLocalUri ? (
              <Image
                source={{ uri: photoLocalUri }}
                style={{ width: 120, height: 120 }}
              />
            ) : (
              <Feather name="user" size={48} color={C.muted} />
            )}
          </View>
          <View
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: C.blue,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 3,
              borderColor: '#FFFFFF' }}
          >
            <Feather name="camera" size={16} color="#FFFFFF" />
          </View>
        </Pressable>

        {/* Title */}
        <Text
          style={{
            fontSize: 24,
            fontWeight: '800',
            color: C.text,
            textAlign: 'center',
            marginTop: 28 }}
        >
          {t('auth.completeProfile.title')}
        </Text>
        <Text
          style={{
            fontSize: 15,
            color: C.muted,
            textAlign: 'center',
            marginTop: 8,
            lineHeight: 22 }}
        >
          {t('auth.completeProfile.subtitle')}
        </Text>

        {/* Name input */}
        <TextInput
          style={{
            marginTop: 32,
            height: 56,
            borderRadius: 16,
            backgroundColor: '#F7F7FA',
            borderWidth: 1,
            borderColor: '#E8E8EC',
            paddingHorizontal: 18,
            fontSize: 17,
            color: C.text }}
          placeholder={t('auth.completeProfile.namePlaceholder')}
          placeholderTextColor="#A9A9B3"
          value={name}
          onChangeText={(v) => { setName(v); setErrorMsg(''); }}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={handleComplete}
          maxLength={40}
        />

        {/* Error */}
        {!!errorMsg && (
          <Text style={{ color: C.error, fontSize: 14, marginTop: 12, textAlign: 'center' }}>
            {errorMsg}
          </Text>
        )}

        {/* Submit */}
        <Pressable
          onPress={handleComplete}
          disabled={loading}
          style={({ pressed }) => ({
            marginTop: 28,
            height: 56,
            borderRadius: 28,
            backgroundColor: pressed ? '#1879C4' : C.blue,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: loading ? 0.7 : 1,
            shadowColor: C.blue,
            shadowOpacity: 0.3,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: 5 })}
        >
          {loading ? (
            <PremiumLoader size="medium" />
          ) : (
            <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '700' }}>
              {t('auth.completeProfile.doneButton')}
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
