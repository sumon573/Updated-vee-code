/**
 * IMO-style login — "Enter Your Phone" (2026-10-11).
 *
 * Matches the imo reference screenshot exactly:
 * back arrow | globe + change-language | "?" help, title, subtitle,
 * terms links, Sync Contacts checkbox, country selector, +dial code,
 * phone input, blue round verify button. Phone | Google tabs.
 *
 * Auth services are placeholders (wired in the next step) — every tap
 * responds with a real message, never silently dead (Sumon's rule).
 */
import { useState, useMemo } from 'react';
import {
  View, Text, TextInput, Pressable, Modal, ScrollView,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CountryPicker from './components/CountryPicker';
import { DEFAULT_COUNTRY, type Country } from '@/src/data/countries';
import { useLanguage } from '@/src/context/LanguageContext';
import { SUPPORTED_LANGUAGES } from '@/src/i18n';
import {
  sendPhoneOtp, getPhoneAuthErrorKey, PHONE_AUTH_NOT_WIRED,
} from '@/src/services/phoneAuthService';
import {
  signInWithGoogle, getGoogleAuthErrorKey,
} from '@/src/services/googleAuthService';

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
  tabBg: '#F1F2F6',
} as const;

const SYNC_CONTACTS_KEY = '@vee/sync_contacts_opt_in';

type Tab = 'phone' | 'google';
type NoticeKind = 'error' | 'info';

/** Keep only digits. */
function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

/** Format BD national number as 01771-680805 while typing. */
function formatNational(digits: string, iso: string): string {
  if (iso === 'BD' && digits.length > 5) {
    return `${digits.slice(0, 5)}-${digits.slice(5, 11)}`;
  }
  return digits;
}

/** Validate the national number for the selected country. */
function isValidNational(digits: string, iso: string): boolean {
  if (iso === 'BD') {
    // Bangladesh mobile: 01[3-9] + 8 digits = 11 digits
    return /^01[3-9]\d{8}$/.test(digits);
  }
  return digits.length >= 7 && digits.length <= 15;
}

/** Build E.164 (drops the BD trunk zero). */
function toE164(digits: string, country: Country): string {
  const national = country.iso === 'BD' && digits.startsWith('0')
    ? digits.slice(1)
    : digits;
  return `+${country.dialCode}${national}`;
}

// ─── Login Screen ─────────────────────────────────────────────────────────────

export default function ImoLoginScreen() {
  const { t } = useTranslation();
  const { language, changeLanguage } = useLanguage();

  const [tab, setTab] = useState<Tab>('phone');
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [national, setNational] = useState('');
  const [syncContacts, setSyncContacts] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [docOpen, setDocOpen] = useState<'terms' | 'privacy' | null>(null);
  const [notice, setNotice] = useState<{ kind: NoticeKind; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);

  const digits = useMemo(() => digitsOnly(national), [national]);
  const valid = useMemo(() => isValidNational(digits, country.iso), [digits, country.iso]);

  function showNotice(kind: NoticeKind, text: string) {
    setNotice({ kind, text });
  }

  function clearNotice() {
    setNotice(null);
  }

  // ─── Phone input ────────────────────────────────────────────────────────────

  function handlePhoneChange(text: string) {
    clearNotice();
    const d = digitsOnly(text).slice(0, country.iso === 'BD' ? 11 : 15);
    setNational(formatNational(d, country.iso));
  }

  function handleCountrySelect(c: Country) {
    setCountry(c);
    setNational('');
    clearNotice();
    Haptics.selectionAsync();
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

  // ─── Verify (phone) ─────────────────────────────────────────────────────────

  async function handleVerify() {
    clearNotice();
    if (!valid || sending) return;
    try {
      setSending(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const e164 = toE164(digits, country);
      const { verificationId } = await sendPhoneOtp(e164);
      // Real wiring navigates to the OTP screen with the verificationId.
      router.push({
        pathname: '/auth/verify-otp',
        params: {
          phone: e164,
          verificationId,
          syncContacts: syncContacts ? '1' : '0',
        },
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      const key = getPhoneAuthErrorKey(err);
      showNotice(code === PHONE_AUTH_NOT_WIRED ? 'info' : 'error', t(key as any));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSending(false);
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
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
            <Pressable onPress={handleBack} hitSlop={14} style={{ padding: 10 }}>
              <Feather name="arrow-left" size={26} color="#000000" />
            </Pressable>

            <Pressable
              onPress={() => setLangOpen(true)}
              hitSlop={10}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                paddingVertical: 10,
              }}
            >
              <Feather name="globe" size={30} color="#000000" />
              <Text style={{ fontSize: 21, fontWeight: '700', color: '#000000' }}>
                {t('auth.phoneLogin.changeLanguage')}
              </Text>
            </Pressable>

            <Pressable onPress={handleHelp} hitSlop={14} style={{ padding: 10 }}>
              <Feather name="help-circle" size={30} color="#000000" />
            </Pressable>
          </View>

          {/* ── Tabs: Phone | Google ────────────────────────────────── */}
          <View style={{ paddingHorizontal: 40, marginTop: 10, marginBottom: 4 }}>
            <View
              style={{
                flexDirection: 'row',
                backgroundColor: C.tabBg,
                borderRadius: 24,
                padding: 4,
              }}
            >
              {(['phone', 'google'] as Tab[]).map((key) => {
                const active = tab === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => { setTab(key); clearNotice(); Haptics.selectionAsync(); }}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: 20,
                      backgroundColor: active ? '#FFFFFF' : 'transparent',
                      alignItems: 'center',
                      shadowColor: '#000',
                      shadowOpacity: active ? 0.08 : 0,
                      shadowRadius: 6,
                      shadowOffset: { width: 0, height: 2 },
                      elevation: active ? 2 : 0,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 15,
                        fontWeight: active ? '800' : '600',
                        color: active ? C.text : C.muted,
                      }}
                    >
                      {t(key === 'phone' ? 'auth.phoneLogin.phoneTab' : 'auth.phoneLogin.googleTab')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 30, paddingBottom: 30 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {tab === 'phone' ? (
              <>
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
                  {t('auth.phoneLogin.title')}
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
                  {t('auth.phoneLogin.subtitle')}
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

                {/* Spacer pushes country/phone to the bottom like IMO */}
                <View style={{ height: 120 }} />

                {/* ── Country selector ──────────────────────────────── */}
                <Pressable
                  onPress={() => setCountryOpen(true)}
                  style={{ alignItems: 'center', paddingVertical: 10 }}
                  hitSlop={10}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ fontSize: 26, color: C.text, fontWeight: '400' }}>
                      {country.name}
                    </Text>
                    <Text style={{ fontSize: 16, color: C.text, marginLeft: 4 }}>▼</Text>
                  </View>
                </Pressable>
                <View
                  style={{
                    height: 1,
                    backgroundColor: '#E8E8EC',
                    marginHorizontal: 4,
                    marginBottom: 6,
                  }}
                />

                {/* ── Phone row ─────────────────────────────────────── */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingBottom: 10,
                  }}
                >
                  <Text style={{ fontSize: 24, color: C.text, fontWeight: '400' }}>
                    +{country.dialCode}
                  </Text>
                  <View
                    style={{
                      height: 34,
                      width: 1,
                      backgroundColor: '#E8E8EC',
                      marginHorizontal: 14,
                    }}
                  />
                  <TextInput
                    style={{
                      flex: 1,
                      fontSize: 24,
                      color: C.text,
                      paddingVertical: 8,
                      borderBottomWidth: 2,
                      borderBottomColor: valid ? C.blue : '#D8D8DE',
                    }}
                    placeholder={t('auth.phoneLogin.phonePlaceholder')}
                    placeholderTextColor="#C4C4CC"
                    keyboardType="phone-pad"
                    value={national}
                    onChangeText={handlePhoneChange}
                    maxLength={country.iso === 'BD' ? 12 : 15}
                    autoCorrect={false}
                    returnKeyType="done"
                    onSubmitEditing={handleVerify}
                  />
                  <Pressable
                    onPress={handleVerify}
                    disabled={!valid || sending}
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 32,
                      backgroundColor: valid && !sending ? C.blue : C.disabled,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginLeft: 14,
                      shadowColor: C.blue,
                      shadowOpacity: valid ? 0.35 : 0,
                      shadowRadius: 10,
                      shadowOffset: { width: 0, height: 4 },
                      elevation: valid ? 5 : 0,
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('auth.phoneLogin.title')}
                  >
                    {sending ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Feather name="check" size={30} color="#FFFFFF" />
                    )}
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                {/* ── Google tab ────────────────────────────────────── */}
                <Text
                  style={{
                    fontSize: 28,
                    fontWeight: '800',
                    color: C.text,
                    textAlign: 'center',
                    marginTop: 40,
                  }}
                >
                  {t('auth.phoneLogin.googleTab')}
                </Text>
                <Text
                  style={{
                    fontSize: 16,
                    color: C.muted,
                    textAlign: 'center',
                    marginTop: 12,
                    lineHeight: 24,
                    paddingHorizontal: 20,
                  }}
                >
                  {t('auth.phoneLogin.subtitle')}
                </Text>

                {!!notice && (
                  <View
                    style={{
                      marginTop: 18,
                      backgroundColor: C.infoBg,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: C.infoBorder,
                      paddingHorizontal: 14,
                      paddingVertical: 11,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <Feather name="info" size={17} color={C.blue} />
                    <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: C.text }}>
                      {notice.text}
                    </Text>
                  </View>
                )}

                <View style={{ height: 60 }} />

                <Pressable
                  onPress={handleGoogle}
                  disabled={googleLoading}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 58,
                    borderRadius: 29,
                    backgroundColor: pressed ? '#F5F5F7' : '#FFFFFF',
                    borderWidth: 1.5,
                    borderColor: '#DADCE0',
                    gap: 12,
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
                      <Text style={{ fontSize: 24, fontWeight: '800', color: '#4285F4' }}>G</Text>
                      <Text style={{ fontSize: 17, fontWeight: '600', color: '#3C4043' }}>
                        {t('auth.phoneLogin.continueWithGoogle')}
                      </Text>
                    </>
                  )}
                </Pressable>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>

        {/* ── Country picker ─────────────────────────────────────────── */}
        <CountryPicker
          visible={countryOpen}
          selected={country}
          onSelect={handleCountrySelect}
          onClose={() => setCountryOpen(false)}
        />

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
