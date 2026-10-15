/**
 * Vee Signup — white/light design matching login + email-login.
 * Name / email / password / confirm / avatar / terms. All logic unchanged.
 */
import { useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, Alert, ScrollView, Platform, Image } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import ScalePress from '@/components/ScalePress';
import { signUp, getAuthErrorMessage } from '@/src/services/authService';
import { alertPermissionPermanentlyDenied } from '@/src/utils/permissionAlert';
import { deleteUser } from 'firebase/auth';
import { createUser, setupPresence, generateAndReserveVId } from '@/src/services/userService';
import { validateRegistrationEmail } from '@/src/data/disposableEmails';
import { initializeWallet } from '@/src/features/wallet/walletService';
import { uploadImage } from '@/src/services/cloudinaryService';
import generateVId from '@/src/utils/generateVId';

const C = {
  bg: '#FFFFFF',
  text: '#0A1A33',
  muted: '#6B7280',
  blue: '#1E9BF0',
  blueDark: '#1879C4',
  error: '#FF4B4B',
  errorBg: 'rgba(255,75,75,0.10)',
  inputBg: '#F7F7FA',
  inputBorder: '#E8E8EC' } as const;

// ─── Field Component ──────────────────────────────────────────────────────────

function Field({
  icon, placeholder, value, onChange, secure, keyboard, hint }: {
  icon: React.ComponentProps<typeof Feather>['name'];
  placeholder: string;
  value: string;
  onChange: (t: string) => void;
  secure?: boolean;
  keyboard?: 'email-address' | 'default';
  hint?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);

  return (
    <View style={{ marginBottom: hint ? 6 : 16 }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        borderRadius: 16, borderWidth: 1,
        borderColor: focused ? C.blue : C.inputBorder,
        backgroundColor: C.inputBg, paddingHorizontal: 16, height: 56 }}>
        <Feather name={icon} size={18} color={focused ? C.blue : C.muted} style={{ marginRight: 12 }} />
        <TextInput
          style={{ flex: 1, color: C.text, fontSize: 16, height: '100%' }}
          placeholder={placeholder} placeholderTextColor={C.muted}
          value={value} onChangeText={onChange}
          secureTextEntry={secure && !visible}
          keyboardType={keyboard ?? 'default'}
          autoCapitalize={keyboard === 'email-address' ? 'none' : 'words'}
          autoCorrect={false}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {secure && (
          <Pressable onPress={() => setVisible(!visible)} hitSlop={12}>
            <Feather name={visible ? 'eye' : 'eye-off'} size={18} color={C.muted} />
          </Pressable>
        )}
      </View>
      {!!hint && (
        <Text style={{ color: C.muted, fontSize: 12, marginTop: 6, marginLeft: 16 }}>
          {hint}
        </Text>
      )}
    </View>
  );
}

// ─── Signup Screen ────────────────────────────────────────────────────────────

export default function SignupScreen() {
  const { t } = useTranslation();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [photoLocalUri, setPhotoLocalUri] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [docOpen, setDocOpen] = useState<'terms' | 'privacy' | null>(null);

  // ─── Avatar picker ────────────────────────────────────────────────────────

  async function handlePickAvatar() {
    // #4 fix: wrap in try/catch to avoid unhandled rejection if picker throws.
    try {
      const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        const title = t('auth.signup.photoUploadTitle');
        const msg = t('auth.signup.permissionDenied', 'Gallery access is required to upload a photo.');
        // Permanently denied ("Don't ask again") — re-requesting will never show
        // the system dialog, so point at Settings instead of a dead-end retry.
        if (canAskAgain === false) alertPermissionPermanentlyDenied(title, msg);
        else Alert.alert(title, msg);
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8 });
      if (!result.canceled && result.assets[0]) {
        setPhotoLocalUri(result.assets[0].uri);
      }
    } catch {
      // Silently ignore — user can retry or skip the photo.
    }
  }

  // ─── Validation ───────────────────────────────────────────────────────────

  function validate(): string | null {
    if (!name.trim())                         return t('auth.signup.errorNoName');
    const emailErr = validateRegistrationEmail(email);
    if (emailErr)                             return t(emailErr as any);
    if (password.length < 6)                  return t('auth.signup.errorShortPassword');
    if (password !== confirmPass)             return t('auth.signup.errorPasswordMismatch');
    if (!agreed)                              return t('auth.signup.errorNoTerms');
    return null;
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  async function handleSignUp() {
    setErrorMsg('');
    const err = validate();
    if (err) { setErrorMsg(err); return; }

    try {
      setLoading(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const firebaseUser = await signUp(email, password, name);

      // Generate a unique Vee ID (atomic reserve — safe under concurrent signups)
      let vId: string;
      try {
        vId = await generateAndReserveVId(firebaseUser.uid, generateVId);
      } catch (vidErr) {
        // VID reservation failed — roll back the Firebase Auth account so the
        // user can retry cleanly (otherwise they'd have an orphaned auth entry).
        // background: safe to swallow — rollback is best-effort; the error is rethrown below
        await deleteUser(firebaseUser).catch(() => {});
        throw vidErr;
      }

      // Upload avatar to Cloudinary if selected
      let photoURL = '';
      if (photoLocalUri) {
        try {
          setPhotoUploading(true);
          const uploaded = await uploadImage(photoLocalUri, { folder: 'vee/avatars', transformation: 'c_fill,w_400,h_400,q_auto' });
          photoURL = uploaded.url;
        } catch {
          // #5 fix: tell the user the photo failed so they don't think it was set.
          // Non-blocking — account creation continues.
          Alert.alert(
            t('auth.signup.photoUploadTitle'),
            t('auth.signup.photoUploadFailed', 'Photo upload failed. You can add it later in Edit Profile.'),
          );
        } finally {
          setPhotoUploading(false);
        }
      }

      // Save user profile to Firebase Realtime DB.
      // If this fails, roll back the Firebase Auth account so the user isn't
      // stuck with an auth entry that has no corresponding DB profile.
      try {
        await createUser({
          uid: firebaseUser.uid,
          vId,
          name: name.trim(),
          email: firebaseUser.email ?? email.trim(),
          photoURL,
          bio: '',
          createdAt: Date.now(),
          lastSeen: Date.now(),
          online: true });
      } catch (dbErr) {
        // background: safe to swallow — rollback is best-effort; the error is rethrown below
        await deleteUser(firebaseUser).catch(() => {});
        throw dbErr;
      }

      // Give new user 500 free diamonds to start (server-authoritative).
      // background: safe to swallow — lazy-initialized on first wallet balance touch
      await initializeWallet(firebaseUser.uid).catch(() => {});

      setupPresence(firebaseUser.uid);
      // AuthGuard handles redirect to /home
    } catch (err) {
      setErrorMsg(t(getAuthErrorMessage(err) as any));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

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
              {t('auth.signup.headerTitle')}
            </Text>
            <Text style={{ fontSize: 14, color: C.muted, marginTop: 2 }}>
              {t('auth.signup.headerSubtitle')}
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Avatar picker */}
          <View style={{ alignItems: 'center', marginBottom: 24 }}>
            <Pressable onPress={handlePickAvatar} disabled={photoUploading}>
              <View style={{
                width: 96, height: 96, borderRadius: 48,
                backgroundColor: C.inputBg,
                borderWidth: 2, borderColor: C.inputBorder,
                borderStyle: photoLocalUri ? 'solid' : 'dashed',
                alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden' }}>
                {photoLocalUri
                  ? <Image source={{ uri: photoLocalUri }} style={{ width: 96, height: 96, borderRadius: 48 }} />
                  : photoUploading
                    ? <PremiumLoader size="medium" />
                    : <Feather name="user" size={32} color={C.muted} />
                }
              </View>
              <View style={{
                position: 'absolute', bottom: 2, right: 2,
                width: 30, height: 30, borderRadius: 15,
                backgroundColor: C.blue, borderWidth: 2, borderColor: C.bg,
                alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="camera" size={13} color="#fff" />
              </View>
            </Pressable>
          </View>

          {/* Error message */}
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

          <Field icon="user" placeholder={t('auth.signup.namePlaceholder')} value={name} onChange={setName} />
          <Field icon="mail" placeholder={t('auth.signup.emailPlaceholder')} value={email} onChange={setEmail} keyboard="email-address" />
          <Field
            icon="lock"
            placeholder={t('auth.signup.passwordPlaceholder')}
            value={password} onChange={setPassword} secure
            hint={t('auth.signup.passwordHint')}
          />
          <View style={{ height: 10 }} />
          <Field icon="lock" placeholder={t('auth.signup.confirmPasswordPlaceholder')} value={confirmPass} onChange={setConfirmPass} secure />

          {/* Terms checkbox */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 24, gap: 10 }}>
            <Pressable onPress={() => setAgreed(!agreed)} hitSlop={8}>
              <View style={{
                width: 22, height: 22, borderRadius: 6, marginTop: 1,
                borderWidth: 1.8, borderColor: C.blue,
                backgroundColor: agreed ? C.blue : 'transparent',
                alignItems: 'center', justifyContent: 'center' }}>
                {agreed && <Feather name="check" size={13} color="#fff" />}
              </View>
            </Pressable>
            <Text style={{ color: C.muted, fontSize: 13, flex: 1, lineHeight: 19 }}>
              {t('auth.signup.termsPrefix')}
              <Text style={{ color: C.blue, fontWeight: '700' }} onPress={() => setDocOpen('terms')}>
                {t('auth.signup.termsLink')}
              </Text>
              {t('auth.signup.termsAnd')}
              <Text style={{ color: C.blue, fontWeight: '700' }} onPress={() => setDocOpen('privacy')}>
                {t('auth.signup.privacyLink')}
              </Text>
              {t('auth.signup.termsSuffix')}
            </Text>
          </View>

          {/* Signup button */}
          <ScalePress onPress={handleSignUp} disabled={loading}>
            <View style={{
              height: 56, borderRadius: 28, backgroundColor: loading ? C.blueDark : C.blue,
              alignItems: 'center', justifyContent: 'center' }}>
              {loading
                ? <PremiumLoader size="medium" />
                : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 1.5 }}>
                    {t('auth.signup.createButton')}
                  </Text>}
            </View>
          </ScalePress>

          <View style={{ height: 14 }} />

          <ScalePress onPress={() => router.replace('/auth/email-login')}>
            <View style={{
              height: 56, borderRadius: 28, borderWidth: 1.6, borderColor: C.blue,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: '#FFFFFF' }}>
              <Text style={{ color: C.blue, fontSize: 13, fontWeight: '800', letterSpacing: 1.2 }}>
                {t('auth.signup.alreadyHaveAccount')}
              </Text>
            </View>
          </ScalePress>

          <View style={{ height: Platform.OS === 'web' ? 34 : 48 }} />
        </ScrollView>

        {/* Terms / Privacy modal */}
        <Modal
          visible={docOpen !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setDocOpen(null)}
        >
          <Pressable
            style={{
              flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
              alignItems: 'center', justifyContent: 'center', padding: 30 }}
            onPress={() => setDocOpen(null)}
          >
            <Pressable
              style={{
                backgroundColor: '#FFFFFF', borderRadius: 18,
                padding: 22, maxHeight: '70%', width: '100%' }}
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
                  marginTop: 18, backgroundColor: C.blue,
                  borderRadius: 24, paddingVertical: 12, alignItems: 'center' }}
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
