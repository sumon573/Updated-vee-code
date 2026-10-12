/**
 * Vee login — Google + Email (2026-10-12).
 *
 * Google (primary) + Email/Password (secondary). Phone system removed.
 * back arrow | globe + change-language | "?" help, title, subtitle,
 * terms links, Google button, Email button.
 */
import { useState } from 'react';
import {
  View, Text, Pressable, Modal, ScrollView,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/src/context/LanguageContext';
import { SUPPORTED_LANGUAGES } from '@/src/i18n';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  signInWithGoogle, getGoogleAuthErrorKey,
} from '@/src/services/googleAuthService';

const SYNC_CONTACTS_KEY = '@vee/sync_contacts_opt_in';

const C = {
  bg: '#FFFFFF',
  text: '#0A1A33',
  muted: '#6B7280',
  lightMuted: '#A9A9B0',
  blue: '#1E9BF0',
  blueDark: '#1879C4',
  disabled: '#B9D9F2',
  error: '#FF4B4B',
  errorBg: 'rgba(255,75,75,0.10)',
  infoBg: 'rgba(30,155,240,0.10)',
  infoBorder: 'rgba(30,155,240,0.35)',
} as const;

type NoticeKind = 'error' | 'info';

// ─── Login Screen ─────────────────────────────────────────────────────────────

// Official multicolor Google "G" logo (SVG paths from Google brand assets)
function GoogleGLogo({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

export default function ImoLoginScreen() {
  const { t } = useTranslation();
  const { language, changeLanguage } = useLanguage();

  const [syncContacts, setSyncContacts] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [docOpen, setDocOpen] = useState<'terms' | 'privacy' | null>(null);
  const [notice, setNotice] = useState<{ kind: NoticeKind; text: string } | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);

  function showNotice(kind: NoticeKind, text: string) {
    setNotice({ kind, text });
  }

  function clearNotice() {
    setNotice(null);
  }

  // ─── Sync Contacts checkbox ─────────────────────────────────────────────────

  async function handleToggleSyncContacts() {
    if (syncLoading) return;
    const next = !syncContacts;
    if (!next) {
      setSyncContacts(false);
      await AsyncStorage.setItem(SYNC_CONTACTS_KEY, 'false');
      return;
    }
    // Enabling: save preference. The OS contacts permission is requested
    // when the user opens the Contacts tab (existing flow, no new native module).
    try {
      setSyncLoading(true);
      setSyncContacts(true);
      await AsyncStorage.setItem(SYNC_CONTACTS_KEY, 'true');
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      Alert.alert(
        t('auth.phoneLogin.syncContacts'),
        t('auth.errors.generic'),
      );
    } finally {
      setSyncLoading(false);
    }
  }

  // ─── Google ─────────────────────────────────────────────────────────────────

  async function handleGoogle() {
    clearNotice();
    if (googleLoading) return;
    try {
      setGoogleLoading(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await signInWithGoogle();
      // Real wiring lands here signed-in; AuthGuard routes onward.
    } catch (err) {
      showNotice('info', t(getGoogleAuthErrorKey(err) as any));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setGoogleLoading(false);
    }
  }

  // ─── Email ──────────────────────────────────────────────────────────────────

  function handleEmail() {
    clearNotice();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/auth/signup');
  }

  // ─── Header actions ─────────────────────────────────────────────────────────

  function handleBack() {
    if (router.canGoBack()) router.back();
  }

  function handleHelp() {
    Alert.alert(t('auth.phoneLogin.helpTitle'), t('auth.phoneLogin.helpMessage'));
  }

  async function handleChangeLanguage(code: (typeof SUPPORTED_LANGUAGES)[number]['code']) {
    if (code !== language) {
      await changeLanguage(code);
      await Haptics.selectionAsync();
    }
    setLangOpen(false);
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
          {/* ── Top bar ─────────────────────────────────────────────── */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 8,
              paddingTop: 6,
              paddingBottom: 2,
            }}
          >
            <Pressable onPress={handleBack} hitSlop={14} style={{ padding: 8 }}>
              <Feather name="arrow-left" size={22} color="#000000" />
            </Pressable>

            <Pressable
              onPress={() => setLangOpen(true)}
              hitSlop={10}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: 8,
              }}
            >
              <Feather name="globe" size={18} color="#000000" />
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#000000' }}>
                {t('auth.phoneLogin.changeLanguage')}
              </Text>
            </Pressable>

            <Pressable onPress={handleHelp} hitSlop={14} style={{ padding: 8 }}>
              <Feather name="help-circle" size={20} color="#000000" />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 30, paddingBottom: 30 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
                {/* ── Title ─────────────────────────────────────────── */}
                <Text
                  style={{
                    fontSize: 34,
                    fontWeight: '800',
                    color: C.text,
                    textAlign: 'center',
                    marginTop: 18,
                  }}
                >
                  {t('auth.login.title')}
                </Text>
                <Text
                  style={{
                    fontSize: 19,
                    color: C.text,
                    textAlign: 'center',
                    marginTop: 14,
                    lineHeight: 27,
                    paddingHorizontal: 8,
                  }}
                >
                  {t('auth.login.subtitle')}
                </Text>

                {/* ── Terms ─────────────────────────────────────────── */}
                <Text
                  style={{
                    fontSize: 15,
                    color: C.lightMuted,
                    textAlign: 'center',
                    marginTop: 12,
                    lineHeight: 22,
                    paddingHorizontal: 16,
                  }}
                >
                  {t('auth.phoneLogin.termsPrefix')}
                  <Text
                    style={{ textDecorationLine: 'underline', color: C.lightMuted }}
                    onPress={() => setDocOpen('terms')}
                  >
                    {t('auth.phoneLogin.termsOfService')}
                  </Text>
                  {t('auth.phoneLogin.termsAnd')}
                  <Text
                    style={{ textDecorationLine: 'underline', color: C.lightMuted }}
                    onPress={() => setDocOpen('privacy')}
                  >
                    {t('auth.phoneLogin.privacyPolicy')}
                  </Text>
                  {t('auth.phoneLogin.termsSuffix')}
                </Text>

                {/* ── Sync Contacts ─────────────────────────────────── */}
                <Pressable
                  onPress={handleToggleSyncContacts}
                  disabled={syncLoading}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginTop: 22,
                    gap: 12,
                    opacity: syncLoading ? 0.6 : 1,
                  }}
                  hitSlop={10}
                >
                  <View
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 15,
                      borderWidth: 2,
                      borderColor: syncContacts ? C.blue : '#9AA0A8',
                      backgroundColor: syncContacts ? C.blue : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {syncContacts && <Feather name="check" size={17} color="#FFFFFF" />}
                  </View>
                  <Text style={{ fontSize: 21, color: C.text, fontWeight: '400' }}>
                    {t('auth.phoneLogin.syncContacts')}
                  </Text>
                </Pressable>

                {/* ── Notice banner ─────────────────────────────────── */}
                {!!notice && (
                  <View
                    style={{
                      marginTop: 18,
                      backgroundColor: notice.kind === 'error' ? C.errorBg : C.infoBg,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: notice.kind === 'error'
                        ? 'rgba(255,75,75,0.3)'
                        : C.infoBorder,
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
                    <Text
                      style={{
                        flex: 1,
                        fontSize: 14,
                        lineHeight: 20,
                        color: notice.kind === 'error' ? C.error : C.text,
                      }}
                    >
                      {notice.text}
                    </Text>
                  </View>
                )}

                {/* ── Google sign-in (native picker) ──────────────────── */}
                <Pressable
                  onPress={handleGoogle}
                  disabled={googleLoading}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: pressed ? '#F5F5F7' : '#FFFFFF',
                    borderWidth: 1,
                    borderColor: '#E0E0E0',
                    gap: 12,
                    marginTop: 24,
                    shadowColor: '#000',
                    shadowOpacity: 0.08,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 3 },
                    elevation: 3,
                    opacity: googleLoading ? 0.7 : 1,
                  })}
                >
                  {googleLoading ? (
                    <ActivityIndicator color={C.blue} />
                  ) : (
                    <>
                      <GoogleGLogo size={22} />
                      <Text style={{ fontSize: 16, fontWeight: '600', color: '#3C4043' }}>
                        {t('auth.phoneLogin.continueWithGoogle')}
                      </Text>
                    </>
                  )}
                </Pressable>

                {/* ── Email sign-in ───────────────────────────────────── */}
                <Pressable
                  onPress={handleEmail}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: pressed ? '#F5F5F7' : '#FFFFFF',
                    borderWidth: 1,
                    borderColor: '#E0E0E0',
                    gap: 12,
                    marginTop: 16,
                    shadowColor: '#000',
                    shadowOpacity: 0.08,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 3 },
                    elevation: 3,
                  })}
                >
                  <Feather name="mail" size={22} color={C.blue} />
                  <Text style={{ fontSize: 16, fontWeight: '600', color: '#3C4043' }}>
                    {t('auth.login.continueWithEmail')}
                  </Text>
                </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>

        {/* ── Language sheet ─────────────────────────────────────────── */}
        <Modal
          visible={langOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setLangOpen(false)}
        >
          <Pressable
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
            onPress={() => setLangOpen(false)}
          >
            <Pressable
              style={{
                backgroundColor: '#FFFFFF',
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                paddingTop: 10,
                paddingBottom: 30,
                paddingHorizontal: 20,
              }}
              onPress={() => {}}
            >
              <View style={{ alignItems: 'center', paddingBottom: 12 }}>
                <View style={{ width: 72, height: 5, borderRadius: 3, backgroundColor: '#E3E3E8' }} />
              </View>
              {SUPPORTED_LANGUAGES.map((lang) => {
                const isActive = language === lang.code;
                return (
                  <Pressable
                    key={lang.code}
                    onPress={() => handleChangeLanguage(lang.code)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 14,
                      paddingHorizontal: 8,
                      borderBottomWidth: 1,
                      borderBottomColor: '#F0F0F4',
                      backgroundColor: pressed ? '#F7F7FA' : '#FFFFFF',
                    })}
                  >
                    <Text style={{ fontSize: 28, marginRight: 14 }}>{lang.flag}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 18, fontWeight: isActive ? '700' : '400', color: C.text }}>
                        {lang.nativeName}
                      </Text>
                      <Text style={{ fontSize: 13, color: C.muted }}>{lang.name}</Text>
                    </View>
                    {isActive && <Feather name="check" size={22} color={C.blue} />}
                  </Pressable>
                );
              })}
            </Pressable>
          </Pressable>
        </Modal>

        {/* ── Terms / Privacy modal ──────────────────────────────────── */}
        <Modal
          visible={docOpen !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setDocOpen(null)}
        >
          <Pressable
            style={{
              flex: 1,
              backgroundColor: 'rgba(0,0,0,0.45)',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 30,
            }}
            onPress={() => setDocOpen(null)}
          >
            <Pressable
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 18,
                padding: 22,
                maxHeight: '70%',
                width: '100%',
              }}
              onPress={() => {}}
            >
              <Text style={{ fontSize: 20, fontWeight: '800', color: C.text, marginBottom: 12 }}>
                {docOpen === 'terms'
                  ? t('auth.phoneLogin.termsTitle')
                  : t('auth.phoneLogin.privacyTitle')}
              </Text>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={{ fontSize: 15, lineHeight: 23, color: '#3C4043' }}>
                  {docOpen === 'terms'
                    ? t('auth.phoneLogin.termsMessage')
                    : t('auth.phoneLogin.privacyMessage')}
                </Text>
              </ScrollView>
              <Pressable
                onPress={() => setDocOpen(null)}
                style={{
                  marginTop: 18,
                  backgroundColor: C.blue,
                  borderRadius: 24,
                  paddingVertical: 12,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>OK</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      </SafeAreaView>
    </View>
  );
}
