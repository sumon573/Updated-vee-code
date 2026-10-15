/**
 * Forgot Password Screen — white/light design matching login + email-login.
 * Sends a password reset email via Firebase Auth.
 */

import { useState } from 'react';
import { View, Text, TextInput, Pressable, Platform } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import ScalePress from '@/components/ScalePress';
import { resetPassword, getAuthErrorMessage } from '@/src/services/authService';

const C = {
  bg: '#FFFFFF',
  text: '#0A1A33',
  muted: '#6B7280',
  blue: '#1E9BF0',
  error: '#FF4B4B',
  errorBg: 'rgba(255,75,75,0.10)',
  success: '#22C55E',
  successBg: 'rgba(34,197,94,0.10)',
  inputBg: '#F7F7FA',
  inputBorder: '#E8E8EC' } as const;

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [focused, setFocused] = useState(false);

  async function handleReset() {
    setErrorMsg('');
    setSuccessMsg('');

    if (!email.trim()) {
      setErrorMsg(t('auth.forgotPassword.errorNoEmail'));
      return;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      setErrorMsg(t('auth.forgotPassword.errorInvalidEmail'));
      return;
    }

    try {
      setLoading(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await resetPassword(email);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSuccessMsg(
        t('auth.forgotPassword.successMessage', { email: email.trim() }),
      );
    } catch (err) {
      setErrorMsg(t(getAuthErrorMessage(err) as any));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8 }}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={{ padding: 6 }}>
            <Feather name="arrow-left" size={24} color={C.text} />
          </Pressable>
          <View style={{ marginLeft: 8 }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: C.text }}>
              {t('auth.forgotPassword.headerTitle')}
            </Text>
            <Text style={{ fontSize: 14, color: C.muted, marginTop: 2 }}>
              {t('auth.forgotPassword.headerSubtitle')}
            </Text>
          </View>
        </View>

        <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 32 }}>

          {/* Icon */}
          <View style={{ alignItems: 'center', marginBottom: 32 }}>
            <View style={{
              width: 80, height: 80, borderRadius: 40,
              backgroundColor: 'rgba(30,155,240,0.10)',
              borderWidth: 1.5, borderColor: 'rgba(30,155,240,0.30)',
              alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="mail" size={34} color={C.blue} />
            </View>
            <Text style={{ color: C.text, fontSize: 20, fontWeight: '800', marginTop: 18, textAlign: 'center' }}>
              {t('auth.forgotPassword.heading')}
            </Text>
            <Text style={{ color: C.muted, fontSize: 14, marginTop: 8, textAlign: 'center', lineHeight: 22 }}>
              {t('auth.forgotPassword.description')}
            </Text>
          </View>

          {/* Error */}
          {!!errorMsg && (
            <View style={{
              backgroundColor: C.errorBg, borderRadius: 14,
              borderWidth: 1, borderColor: 'rgba(255,75,75,0.3)',
              paddingHorizontal: 16, paddingVertical: 12, marginBottom: 16,
              flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Feather name="alert-circle" size={16} color={C.error} />
              <Text style={{ color: C.error, fontSize: 14, flex: 1, lineHeight: 20 }}>{errorMsg}</Text>
            </View>
          )}

          {/* Success */}
          {!!successMsg && (
            <View style={{
              backgroundColor: C.successBg, borderRadius: 14,
              borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)',
              paddingHorizontal: 16, paddingVertical: 14, marginBottom: 20,
              flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <Feather name="check-circle" size={18} color={C.success} style={{ marginTop: 2 }} />
              <Text style={{ color: C.success, fontSize: 14, flex: 1, lineHeight: 22 }}>{successMsg}</Text>
            </View>
          )}

          {/* Email field */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            borderRadius: 16, borderWidth: 1,
            borderColor: focused ? C.blue : C.inputBorder,
            backgroundColor: C.inputBg, paddingHorizontal: 16, height: 56, marginBottom: 24 }}>
            <Feather name="mail" size={18} color={focused ? C.blue : C.muted} style={{ marginRight: 12 }} />
            <TextInput
              style={{ flex: 1, color: C.text, fontSize: 16, height: '100%' }}
              placeholder={t('auth.forgotPassword.emailPlaceholder')}
              placeholderTextColor={C.muted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
            />
          </View>

          {/* Send button */}
          <ScalePress onPress={handleReset} disabled={loading || !!successMsg}>
            <View style={{
              height: 56, borderRadius: 28,
              backgroundColor: successMsg ? C.success : C.blue,
              alignItems: 'center', justifyContent: 'center' }}>
              {loading
                ? <PremiumLoader size="medium" />
                : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Feather name={successMsg ? 'check' : 'send'} size={18} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 1.5 }}>
                      {successMsg
                        ? t('auth.forgotPassword.sentButton')
                        : t('auth.forgotPassword.sendButton')}
                    </Text>
                  </View>
                )}
            </View>
          </ScalePress>

          <View style={{ height: 14 }} />

          {/* Back to login */}
          <ScalePress onPress={() => router.back()}>
            <View style={{
              height: 56, borderRadius: 28, borderWidth: 1.6, borderColor: C.blue,
              alignItems: 'center', justifyContent: 'center',
              flexDirection: 'row', gap: 8, backgroundColor: '#FFFFFF' }}>
              <Feather name="arrow-left" size={16} color={C.blue} />
              <Text style={{ color: C.blue, fontSize: 14, fontWeight: '800' }}>
                {t('auth.forgotPassword.backToLogin')}
              </Text>
            </View>
          </ScalePress>

          <View style={{ height: Platform.OS === 'web' ? 34 : 48 }} />
        </View>
      </SafeAreaView>
    </View>
  );
}
