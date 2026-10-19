/**
 * App Settings Screen — real Firebase-backed functionality
 * 2026-10-19: restyled to IMO Me-tab design language (#F4F5F5 bg, white
 * cards, 56dp title bar, ~56dp menu rows with 30dp icon tiles). All logic
 * unchanged:
 * Change Password   → sendPasswordResetEmail to current user's email
 * Download My Data  → fetch profile + wallet summary, share as text
 * Delete Account    → reauthenticate with password, deleteUser, remove DB node
 * Toggle settings   → persisted to users/{uid}/appSettings in Firebase
 */

import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, Switch, Alert, Platform, Modal, TextInput, Share } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ref, get, update, remove } from 'firebase/database';
import {
  sendPasswordResetEmail,
  reauthenticateWithCredential,
  EmailAuthProvider,
  deleteUser } from 'firebase/auth';
import { auth, database } from '@/src/config/firebase';
import { useAuth } from '@/src/context/AuthContext';
import { useLanguage } from '@/src/context/LanguageContext';
import { SUPPORTED_LANGUAGES } from '@/src/i18n';

// IMO BIUI light tokens (2026-10-19, Me-tab spec): bg #f4f5f5, white cards,
// primary text #25292d, secondary #788187. Boss button standard #E3F2FD/#007AFF kept.
const C = {
  bg: '#F4F5F5',
  card: '#FFFFFF',
  tile: '#F4F5F5',
  text: '#25292D',
  muted: '#788187',
  mutedLight: '#C7C7CC',
  border: '#F0F1F2',
  blue: '#007AFF',
  blueLight: '#E3F2FD',
  green: '#34C759',
  goldBg: '#FFF8E6',
  goldBorder: '#F5D67B',
  goldText: '#B8860B',
  red: '#EF4444',
  redBg: '#FDECEA' } as const;

// IMO card container: white, 12dp radius, 15dp side margins
const cardStyle = { backgroundColor: C.card, marginHorizontal: 15, marginTop: 12, borderRadius: 12 } as const;

type AppSettings = {
  autoPlayMedia: boolean;
  dataSaver: boolean;
};

const DEFAULTS: AppSettings = {
  autoPlayMedia: true,
  dataSaver: false };

// ─── Sub-components ──────────────────────────────────────────────────────────

// ─── IMO title bar: 56dp, back ‹ left, centered 17sp semibold, no gear ───
function TitleBar({ title }: { title: string }) {
  return (
    <View style={{ height: 56, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }}>
      <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }} hitSlop={8}>
        <Feather name="chevron-left" size={24} color={C.text} />
      </Pressable>
      <Text style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: C.text }} numberOfLines={1}>
        {title}
      </Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

// Section caption above a card group
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontSize: 13, color: C.muted, paddingHorizontal: 15, paddingTop: 14, paddingBottom: 6 }}>
      {children}
    </Text>
  );
}

// IMO menu row with trailing Switch — ~56dp, 30dp icon tile,
// 0.5dp divider inset 57dp from left
function SettingToggle({
  icon, iconBg, iconColor, label, subtitle, value, onChange, last }: {
  icon: React.ComponentProps<typeof Feather>['name'];
  iconBg: string;
  iconColor: string;
  label: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 15 }}>
        <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name={icon} size={16} color={iconColor} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={{ color: C.text, fontSize: 16 }} numberOfLines={1}>{label}</Text>
          {subtitle ? (
            <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }} numberOfLines={2}>{subtitle}</Text>
          ) : null}
        </View>
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ false: C.mutedLight, true: C.blue }}
          thumbColor="#fff"
        />
      </View>
      {!last && <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 57 }} />}
    </View>
  );
}

// IMO menu row (BIUIItemView): ~56dp, 30dp rounded icon, 16sp label, chevron
function SettingButton({
  icon, iconBg, iconColor, label, onPress, danger, last }: {
  icon: React.ComponentProps<typeof Feather>['name'];
  iconBg: string;
  iconColor: string;
  label: string;
  onPress: () => void;
  danger?: boolean;
  last?: boolean;
}) {
  return (
    <View>
      <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 15 }}>
        <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name={icon} size={16} color={iconColor} />
        </View>
        <Text style={{ flex: 1, fontSize: 16, color: danger ? C.red : C.text, marginLeft: 12 }} numberOfLines={1}>{label}</Text>
        <Feather name="chevron-right" size={18} color={C.mutedLight} />
      </Pressable>
      {!last && <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 57 }} />}
    </View>
  );
}

// Informational row — IMO menu row without a chevron (nothing fake to toggle)
function SettingInfo({
  icon, iconBg, iconColor, label, subtitle, last }: {
  icon: React.ComponentProps<typeof Feather>['name'];
  iconBg: string;
  iconColor: string;
  label: string;
  subtitle?: string;
  last?: boolean;
}) {
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 15 }}>
        <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name={icon} size={16} color={iconColor} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={{ color: C.text, fontSize: 16 }} numberOfLines={1}>{label}</Text>
          {subtitle ? (
            <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }} numberOfLines={2}>{subtitle}</Text>
          ) : null}
        </View>
      </View>
      {!last && <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 57 }} />}
    </View>
  );
}

// ─── Language selector — fully functional via LanguageContext ────────────────

function LanguageSelector({ last }: { last?: boolean }) {
  const { language, changeLanguage } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const active = SUPPORTED_LANGUAGES.find((l) => l.code === language);

  return (
    <View>
      <Pressable onPress={() => setExpanded((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 15 }}>
        <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: C.blueLight, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="globe" size={16} color={C.blue} />
        </View>
        <Text style={{ flex: 1, color: C.text, fontSize: 16, marginLeft: 12 }} numberOfLines={1}>
          Language
        </Text>
        {active && (
          <Text style={{ color: C.muted, fontSize: 14, marginRight: 8 }}>
            {active.flag} {active.nativeName}
          </Text>
        )}
        <Feather name={expanded ? 'chevron-down' : 'chevron-right'} size={18} color={C.mutedLight} />
      </Pressable>
      {expanded && (
        <View style={{ paddingLeft: 57, paddingRight: 15, paddingBottom: 8 }}>
          {SUPPORTED_LANGUAGES.map((opt) => {
            const selected = opt.code === language;
            return (
              <Pressable key={opt.code} onPress={() => changeLanguage(opt.code)}>
                <View style={{
                  flexDirection: 'row', alignItems: 'center',
                  paddingVertical: 12,
                  borderTopWidth: 0.5, borderTopColor: C.border }}>
                  <Text style={{ fontSize: 18, marginRight: 12 }}>{opt.flag}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.text, fontSize: 15, fontWeight: selected ? '700' : '400' }}>
                      {opt.nativeName}
                    </Text>
                    <Text style={{ color: C.muted, fontSize: 12 }}>{opt.name}</Text>
                  </View>
                  {selected && <Feather name="check" size={18} color={C.blue} />}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
      {!last && <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 57 }} />}
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();

  // ── Logout (2026-10-09: user asked for a logout option inside Settings) ──
  const handleLogout = useCallback(() => {
    Alert.alert(
      t('settings.logoutTitle'),
      t('settings.logoutMsg'),
      [
        { text: t('settings.cancel'), style: 'cancel' },
        { text: t('settings.logoutConfirm'), style: 'destructive', onPress: () => logout() },
      ],
    );
  }, [logout, t]);
  const topPad = Platform.OS === 'web' ? 67 : 0;

  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULTS);

  // Delete account modal state
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  // 2026-10-19: Google-created accounts have no password — the delete modal
  // offers Google re-confirmation instead of a password field.
  const deleteProviderIds = (auth.currentUser?.providerData || []).map((p) => p.providerId);
  const deleteIsGoogleOnly =
    !deleteProviderIds.includes('password') && deleteProviderIds.includes('google.com');

  // ── Load toggle settings from Firebase ────────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;
    get(ref(database, `users/${user.uid}/appSettings`))
      .then((snap) => {
        if (snap.exists()) {
          setAppSettings((prev) => ({ ...prev, ...(snap.val() as Partial<AppSettings>) }));
        }
      })
      .catch(() => {
        Alert.alert(t('settings.error'), t('settings.loadError'));
      });
  }, [user?.uid, t]);

  // ── Toggle + persist ─────────────────────────────────────────────────
  const toggleSetting = useCallback(
    (key: keyof AppSettings) => {
      const next = { ...appSettings, [key]: !appSettings[key] };
      setAppSettings(next);
      if (user?.uid) {
        update(ref(database, `users/${user.uid}/appSettings`), { [key]: next[key] })
          .catch(() => {
            Alert.alert(t('settings.error'), t('settings.saveError'));
          });
      }
    },
    [appSettings, user?.uid, t],
  );

  // ── Change Password ───────────────────────────────────────────────────
  const handleChangePassword = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser?.email) {
      Alert.alert(t('settings.error'), t('settings.noEmail'));
      return;
    }
    try {
      await sendPasswordResetEmail(auth, currentUser.email);
      Alert.alert(
        t('settings.resetEmailSentTitle'),
        t('settings.resetEmailSentMsg', { email: currentUser.email }),
      );
    } catch {
      Alert.alert(t('settings.error'), t('settings.resetEmailError'));
    }
  }, [t]);

  // ── Download My Data ──────────────────────────────────────────────────
  const handleDownloadData = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const [profileSnap, walletSnap] = await Promise.all([
        get(ref(database, `users/${user.uid}`)),
        get(ref(database, `wallets/${user.uid}/balance`)),
      ]);

      const profile = profileSnap.exists() ? profileSnap.val() : {};
      const balance = walletSnap.exists() ? walletSnap.val() : 0;

      const exportData = {
        exportedAt: new Date().toISOString(),
        profile: {
          name: profile.name ?? '',
          email: profile.email ?? '',
          vId: profile.vId ?? '',
          bio: profile.bio ?? '',
          createdAt: profile.createdAt
            ? new Date(profile.createdAt).toISOString()
            : '' },
        wallet: {
          diamondBalance: balance } };

      await Share.share({
        title: 'My Vee Account Data',
        message: JSON.stringify(exportData, null, 2) });
    } catch {
      Alert.alert(t('settings.error'), t('settings.downloadError'));
    }
  }, [user?.uid, t]);

  // ── Delete Account ────────────────────────────────────────────────────
  // 2026-10-19: branch reauth by sign-in provider. Google-created accounts
  // have no password, so EmailAuthProvider reauth could never succeed for
  // them — they re-run the Google sign-in flow for a fresh credential.
  const handleDeleteAccount = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert(t('settings.error'), t('settings.noSession'));
      return;
    }
    const providerIds = (currentUser.providerData || []).map((p) => p.providerId);
    const hasPasswordProvider = providerIds.includes('password');
    const hasGoogleProvider = providerIds.includes('google.com');

    if (hasPasswordProvider) {
      if (!currentUser.email) {
        Alert.alert(t('settings.error'), t('settings.noSession'));
        return;
      }
      if (!deletePassword.trim()) {
        Alert.alert(t('settings.error'), t('settings.enterPassword'));
        return;
      }
    } else if (!hasGoogleProvider) {
      // Unknown provider — no supported reauth path.
      Alert.alert('Error', 'This account cannot be deleted here. Please contact support.');
      return;
    }

    setDeleteLoading(true);
    try {
      // Reauthenticate first (required for sensitive operations)
      if (hasPasswordProvider) {
        const credential = EmailAuthProvider.credential(currentUser.email!, deletePassword);
        await reauthenticateWithCredential(currentUser, credential);
      } else {
        // Google-created account — re-run the Google sign-in flow.
        const { reauthenticateWithGoogle, GOOGLE_AUTH_CANCELLED } =
          await import('@/src/services/googleAuthService');
        try {
          await reauthenticateWithGoogle(currentUser);
        } catch (reauthErr) {
          if ((reauthErr as { code?: string })?.code === GOOGLE_AUTH_CANCELLED) {
            Alert.alert('Error', 'Google confirmation was cancelled.');
            return;
          }
          throw reauthErr;
        }
      }

      // Remove user data from Firebase RTDB (best-effort cleanup; the
      // auth deletion below is what matters for the user's request)
      await remove(ref(database, `users/${user?.uid}`)).catch(() => {/* background: safe to swallow */});

      // Delete the Firebase Auth user
      await deleteUser(currentUser);

      // Auth state change in AuthContext will redirect to login
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? '';
      let msg = 'Could not delete account. Please try again.';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        msg = 'Incorrect password. Please try again.';
      } else if (code === 'auth/requires-recent-login') {
        msg = 'Session expired. Please sign out and sign in again before deleting.';
      }
      Alert.alert('Error', msg);
    } finally {
      setDeleteLoading(false);
    }
  }, [deletePassword, user?.uid, t]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <View style={{ paddingTop: topPad }}>
        <TitleBar title={t('settings.title')} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Appearance */}
        <SectionLabel>{t('settings.sectionAppearance')}</SectionLabel>
        <View style={[cardStyle, { marginTop: 0, paddingVertical: 2 }]}>
          {/* The whole app ships in light mode — informational row, no fake toggle. */}
          <SettingInfo
            icon="sun" iconBg={C.goldBg} iconColor={C.goldText}
            label="Light Mode"
            subtitle="Light mode is active across the app"
            last
          />
        </View>

        {/* Preferences */}
        <SectionLabel>PREFERENCES</SectionLabel>
        <View style={[cardStyle, { marginTop: 0, paddingVertical: 2 }]}>
          <SettingButton
            icon="bell" iconBg="#EDE9FE" iconColor="#8B5CF6"
            label="Notifications"
            onPress={() => router.push('/profile/notifications')}
          />
          <SettingButton
            icon="shield" iconBg={C.tile} iconColor={C.muted}
            label="Privacy"
            onPress={() => router.push('/profile/privacy')}
          />
          <LanguageSelector last />
        </View>

        {/* Media */}
        <SectionLabel>{t('settings.sectionMedia')}</SectionLabel>
        <View style={[cardStyle, { marginTop: 0, paddingVertical: 2 }]}>
          <SettingToggle
            icon="play-circle" iconBg={C.blueLight} iconColor={C.blue}
            label={t('settings.autoPlayMedia')}
            subtitle={t('settings.autoPlayMediaSub')}
            value={appSettings.autoPlayMedia}
            onChange={() => toggleSetting('autoPlayMedia')}
          />
          <SettingToggle
            icon="wifi-off" iconBg={C.tile} iconColor={C.muted}
            label={t('settings.dataSaver')}
            subtitle={t('settings.dataSaverSub')}
            value={appSettings.dataSaver}
            onChange={() => toggleSetting('dataSaver')}
            last
          />
        </View>

        {/* Account */}
        <SectionLabel>{t('settings.sectionAccount')}</SectionLabel>
        <View style={[cardStyle, { marginTop: 0, paddingVertical: 2 }]}>
          <SettingButton
            icon="credit-card" iconBg={C.goldBg} iconColor={C.goldText}
            label="Wallet"
            onPress={() => router.push('/profile/wallet')}
          />
          <SettingButton
            icon="lock" iconBg={C.tile} iconColor={C.muted}
            label={t('settings.changePassword')}
            onPress={handleChangePassword}
          />
          <SettingButton
            icon="download" iconBg="#E8F5E9" iconColor={C.green}
            label={t('settings.downloadData')}
            onPress={handleDownloadData}
          />
          <SettingButton
            icon="help-circle" iconBg="#E8F5E9" iconColor={C.green}
            label="Help"
            onPress={() => router.push('/profile/help')}
          />
          <SettingButton
            icon="info" iconBg={C.tile} iconColor={C.muted}
            label="About"
            onPress={() => router.push('/profile/about')}
          />
          <SettingButton
            icon="log-out" iconBg={C.redBg} iconColor={C.red}
            label={t('settings.logout')}
            onPress={handleLogout}
          />
          <SettingButton
            icon="trash-2" iconBg={C.redBg} iconColor={C.red}
            label={t('settings.deleteAccount')}
            danger
            last
            onPress={() => {
              setDeletePassword('');
              Alert.alert(
                t('settings.deleteAccountTitle'),
                t('settings.deleteAccountMsg'),
                [
                  { text: t('settings.cancel'), style: 'cancel' },
                  {
                    text: t('settings.deleteAccountConfirm'),
                    style: 'destructive',
                    onPress: () => setDeleteModalVisible(true) },
                ],
              );
            }}
          />
        </View>

        <Text style={{
          color: C.mutedLight, fontSize: 11,
          textAlign: 'center', marginTop: 24 }}>
          {t('settings.version')}
        </Text>
      </ScrollView>

      {/* ── Delete Account Confirm Modal ──────────────────────────────────── */}
      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteModalVisible(false)}
      >
        <View style={{
          flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
          alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{
            width: '100%', backgroundColor: C.card,
            borderRadius: 12, padding: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <View style={{
                width: 30, height: 30, borderRadius: 8,
                backgroundColor: C.redBg,
                alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                <Feather name="alert-triangle" size={16} color={C.red} />
              </View>
              <Text style={{ color: C.red, fontSize: 17, fontWeight: '600' }}>
                Delete Account
              </Text>
            </View>
            <Text style={{ color: C.muted, fontSize: 13, lineHeight: 20, marginBottom: 20 }}>
              This action is permanent and cannot be undone. All your data will be deleted.{'\n\n'}
              {deleteIsGoogleOnly
                ? 'Confirm with your Google account to continue — no password needed.'
                : 'Enter your current password to confirm.'}
            </Text>

            {deleteIsGoogleOnly ? (
              <View style={{
                backgroundColor: C.tile,
                borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
                marginBottom: 20,
                flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Feather name="shield" size={18} color={C.blue} />
                <Text style={{ color: C.text, fontSize: 14, flex: 1, lineHeight: 20 }}>
                  You'll sign in with Google again to confirm it's you.
                </Text>
              </View>
            ) : (
              <TextInput
                value={deletePassword}
                onChangeText={setDeletePassword}
                placeholder="Enter your password"
                placeholderTextColor={C.mutedLight}
                secureTextEntry
                autoCapitalize="none"
                style={{
                  backgroundColor: C.tile,
                  borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
                  color: C.text, fontSize: 15,
                  borderWidth: 0.5, borderColor: C.border,
                  marginBottom: 20 }}
              />
            )}

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable
                onPress={() => { setDeleteModalVisible(false); setDeletePassword(''); }}
                style={{
                  flex: 1, paddingVertical: 14, borderRadius: 12,
                  backgroundColor: C.tile,
                  alignItems: 'center' }}
              >
                <Text style={{ color: C.muted, fontWeight: '600' }}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={handleDeleteAccount}
                disabled={deleteLoading}
                style={{
                  flex: 1, paddingVertical: 14, borderRadius: 12,
                  backgroundColor: C.redBg,
                  alignItems: 'center' }}
              >
                {deleteLoading
                  ? <PremiumLoader size="small" />
                  : <Text style={{ color: C.red, fontWeight: '700' }}>
                      {deleteIsGoogleOnly ? 'Confirm with Google' : 'Delete Forever'}
                    </Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
