/**
 * Email Login — for existing users with email/password.
 * White/light mode only.
 *
 * Reached from: login.tsx (Continue with Email) and
 * signup.tsx (ALREADY HAVE AN ACCOUNT? LOGIN).
 */
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { login, getAuthErrorMessage } from '@/src/services/authService';

const C = {
  bg: '#FFFFFF',
  text: '#0A1A33',
  muted: '#6B7280',
  blue: '#1E9BF0',
  blueDark: '#1879C4',
  error: '#FF4B4B',
  inputBg: '#F7F7FA',
  inputBorder: '#E8E8EC' } as const;

export default function EmailLoginScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleLogin() {
    setErrorMsg('');
    if (!email.trim() || !password) {
      setErrorMsg(t('auth.login.errorEmptyFields'));
      return;
    }
    try {
      setLoading(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await login(email.trim(), password);
      // AuthGuard routes onward (existing users have profiles -> /home)
    } catch (err) {
      setErrorMsg(t(getAuthErrorMessage(err) as any));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Back */}
            <Pressable
              onPress={() => router.back()}
              hitSlop={12}
              style={{ alignSelf: 'flex-start', padding: 8, marginTop: 8, marginLeft: -8 }}
            >
              <Feather name="arrow-left" size={24} color={C.text} />
            </Pressable>

            {/* Header */}
            <Text style={{ fontSize: 28, fontWeight: '800', color: C.text, marginTop: 16 }}>
              {t('auth.login.headerTitle')}
            </Text>
            <Text style={{ fontSize: 16, color: C.muted, marginTop: 8 }}>
              {t('auth.login.headerSubtitle')}
            </Text>

            {/* Email */}
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              marginTop: 32, height: 56, borderRadius: 16,
              backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.inputBorder,
              paddingHorizontal: 16 }}>
              <Feather name="mail" size={20} color={C.muted} />
              <TextInput
                style={{ flex: 1, marginLeft: 12, fontSize: 16, color: C.text }}
                placeholder={t('auth.login.emailPlaceholder')}
                placeholderTextColor="#A9A9B3"
                value={email}
                onChangeText={(v) => { setEmail(v); setErrorMsg(''); }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            {/* Password */}
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              marginTop: 16, height: 56, borderRadius: 16,
              backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.inputBorder,
              paddingHorizontal: 16 }}>
              <Feather name="lock" size={20} color={C.muted} />
              <TextInput
                style={{ flex: 1, marginLeft: 12, fontSize: 16, color: C.text }}
                placeholder={t('auth.login.passwordPlaceholder')}
                placeholderTextColor="#A9A9B3"
                value={password}
                onChangeText={(v) => { setPassword(v); setErrorMsg(''); }}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
              <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={10}>
                <Feather name={showPassword ? 'eye' : 'eye-off'} size={20} color={C.muted} />
              </Pressable>
            </View>

            {/* Forgot password */}
            <Pressable
              onPress={() => router.push('/auth/forgot-password')}
              style={{ alignSelf: 'flex-end', marginTop: 12, padding: 4 }}
            >
              <Text style={{ fontSize: 14, color: C.blue, fontWeight: '600' }}>
                {t('auth.login.forgotPassword')}
              </Text>
            </Pressable>

            {/* Error */}
            {!!errorMsg && (
              <Text style={{ color: C.error, fontSize: 14, marginTop: 12, textAlign: 'center' }}>
                {errorMsg}
              </Text>
            )}

            {/* Login button */}
            <Pressable
              onPress={handleLogin}
              disabled={loading}
              style={({ pressed }) => ({
                marginTop: 24,
                height: 56,
                borderRadius: 28,
                backgroundColor: pressed ? C.blueDark : C.blue,
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
                  {t('auth.login.loginButton')}
                </Text>
              )}
            </Pressable>

            {/* New user -> signup */}
            <Pressable
              onPress={() => router.replace('/auth/signup')}
              style={{
                marginTop: 16,
                height: 56,
                borderRadius: 28,
                borderWidth: 1.5,
                borderColor: C.blue,
                alignItems: 'center',
                justifyContent: 'center' }}
            >
              <Text style={{ color: C.blue, fontSize: 14, fontWeight: '800', letterSpacing: 0.8 }}>
                {t('auth.login.newUser')}
              </Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
