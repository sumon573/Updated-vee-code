/**
 * Verify OTP — 4-digit code screen (2026-10-11).
 *
 * - 4 boxes, auto-advance, backspace moves back, paste distributes
 * - 60s resend timer; resend re-sends via the phone service
 * - Back button returns to login
 * - Verification service is a placeholder (wired next step): every tap
 *   responds with a real message, never silently dead.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import {
  sendPhoneOtp, verifyPhoneOtp, getPhoneAuthErrorKey,
} from '@/src/services/phoneAuthService';

const C = {
  bg: '#FFFFFF',
  text: '#0A1A33',
  muted: '#6B7280',
  blue: '#1E9BF0',
  boxBorder: '#D8D8DE',
  error: '#FF4B4B',
  errorBg: 'rgba(255,75,75,0.10)',
  infoBg: 'rgba(30,155,240,0.10)',
  infoBorder: 'rgba(30,155,240,0.35)',
} as const;

const CODE_LENGTH = 4;
const RESEND_SECONDS = 60;

export default function VerifyOtpScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    phone?: string;
    verificationId?: string;
    syncContacts?: string;
  }>();
  const phone = params.phone ?? '';
  const verificationId = params.verificationId ?? '';

  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const inputs = useRef<Array<TextInput | null>>([]);

  // ─── Resend countdown ───────────────────────────────────────────────────────
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  // ─── Auto-focus first box ───────────────────────────────────────────────────
  useEffect(() => {
    const id = setTimeout(() => inputs.current[0]?.focus(), 350);
    return () => clearTimeout(id);
  }, []);

  function focusBox(i: number) {
    inputs.current[i]?.focus();
  }

  function handleChange(index: number, text: string) {
    setNotice(null);
    const d = text.replace(/\D/g, '');
    const next = [...code];
    if (d.length === 0) {
      next[index] = '';
      setCode(next);
      return;
    }
    // Fill forward (handles typing one digit and pasting several)
    let pos = index;
    for (const ch of d) {
      if (pos >= CODE_LENGTH) break;
      next[pos] = ch;
      pos++;
    }
    setCode(next);
    if (pos < CODE_LENGTH) {
      focusBox(pos);
    } else {
      inputs.current[CODE_LENGTH - 1]?.blur();
    }
  }

  function handleKeyPress(index: number, key: string) {
    if (key === 'Backspace' && code[index] === '' && index > 0) {
      const next = [...code];
      next[index - 1] = '';
      setCode(next);
      focusBox(index - 1);
    }
  }

  const isComplete = code.every((c) => c !== '');

  // ─── Verify ─────────────────────────────────────────────────────────────────
  const handleVerify = useCallback(async () => {
    const joined = code.join('');
    if (joined.length !== CODE_LENGTH || verifying) return;
    setNotice(null);
    try {
      setVerifying(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await verifyPhoneOtp(verificationId, joined);
      // Real wiring: signed in — AuthGuard routes onward.
    } catch (err) {
      const key = getPhoneAuthErrorKey(err);
      const isPending = key === 'auth.phoneLogin.phonePending';
      setNotice({ kind: isPending ? 'info' : 'error', text: t(key as any) });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setVerifying(false);
    }
  }, [code, verifying, verificationId, t]);

  // Auto-verify when the 4th digit lands
  useEffect(() => {
    if (isComplete && !verifying) {
      handleVerify();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComplete]);

  // ─── Resend ────────────────────────────────────────────────────────────────
  async function handleResend() {
    if (secondsLeft > 0 || resending || !phone) return;
    setNotice(null);
    try {
      setResending(true);
      await sendPhoneOtp(phone);
      setSecondsLeft(RESEND_SECONDS);
      setCode(Array(CODE_LENGTH).fill(''));
      focusBox(0);
      setNotice({ kind: 'info', text: t('auth.phoneLogin.codeResent') });
    } catch (err) {
      const key = getPhoneAuthErrorKey(err);
      const isPending = key === 'auth.phoneLogin.phonePending';
      setNotice({ kind: isPending ? 'info' : 'error', text: t(key as any) });
    } finally {
      setResending(false);
    }
  }

  function handleBack() {
    if (router.canGoBack()) router.back();
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Top bar */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 6 }}>
            <Pressable onPress={handleBack} hitSlop={14} style={{ padding: 10 }}>
              <Feather name="arrow-left" size={26} color="#000000" />
            </Pressable>
          </View>

          <View style={{ flex: 1, paddingHorizontal: 30, paddingTop: 26 }}>
            <Text style={{ fontSize: 28, fontWeight: '800', color: C.text, textAlign: 'center' }}>
              {t('auth.phoneLogin.otpTitle')}
            </Text>
            <Text style={{ fontSize: 16, color: C.muted, textAlign: 'center', marginTop: 12, lineHeight: 24 }}>
              {t('auth.phoneLogin.otpSubtitle', { phone })}
            </Text>

            {/* Notice */}
            {!!notice && (
              <View
                style={{
                  marginTop: 18,
                  backgroundColor: notice.kind === 'error' ? C.errorBg : C.infoBg,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: notice.kind === 'error' ? 'rgba(255,75,75,0.3)' : C.infoBorder,
                  paddingHorizontal: 14,
                  paddingVertical: 11,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <Feather
                  name={notice.kind === 'error' ? 'alert-circle' : 'info'}
                  size={17}
                  color={notice.kind === 'error' ? C.error : C.blue}
                />
                <Text style={{
                  flex: 1, fontSize: 14, lineHeight: 20,
                  color: notice.kind === 'error' ? C.error : C.text,
                }}>
                  {notice.text}
                </Text>
              </View>
            )}

            {/* Code boxes */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 34 }}>
              {code.map((digit, i) => (
                <TextInput
                  key={i}
                  ref={(r) => { inputs.current[i] = r; }}
                  style={{
                    width: 62,
                    height: 72,
                    borderWidth: 1.5,
                    borderRadius: 14,
                    borderColor: digit ? C.blue : C.boxBorder,
                    backgroundColor: digit ? 'rgba(30,155,240,0.06)' : '#FAFAFC',
                    fontSize: 30,
                    fontWeight: '700',
                    color: C.text,
                    textAlign: 'center',
                  }}
                  keyboardType="number-pad"
                  maxLength={4}
                  value={digit}
                  onChangeText={(text) => handleChange(i, text)}
                  onKeyPress={({ nativeEvent }) => handleKeyPress(i, nativeEvent.key)}
                  selectTextOnFocus
                  autoCorrect={false}
                />
              ))}
            </View>

            {verifying && (
              <View style={{ alignItems: 'center', marginTop: 22 }}>
                <ActivityIndicator color={C.blue} />
              </View>
            )}

            {/* Resend */}
            <View style={{ alignItems: 'center', marginTop: 30 }}>
              {secondsLeft > 0 ? (
                <Text style={{ fontSize: 15, color: C.muted }}>
                  {t('auth.phoneLogin.resendIn', { seconds: secondsLeft })}
                </Text>
              ) : (
                <Pressable onPress={handleResend} disabled={resending} hitSlop={10}>
                  <Text style={{
                    fontSize: 16,
                    fontWeight: '700',
                    color: resending ? C.muted : C.blue,
                  }}>
                    {t('auth.phoneLogin.resendCode')}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
