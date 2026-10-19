/**
 * Edit Profile Screen — ধাপ ২
 * নাম, bio পরিবর্তন + Cloudinary photo upload
 * 2026-10-19: restyled to IMO Me-tab design language (#F4F5F5 bg, white
 * cards, 56dp title bar, white input boxes). Save persists via existing
 * updateUser service calls — logic unchanged.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TextInput, ScrollView, Alert, Image, Platform, KeyboardAvoidingView, Pressable } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { updateUser, VeeUser, subscribeUser } from '@/src/services/userService';
import { uploadProfilePhoto, uploadCoverPhoto, deleteCloudinaryAsset } from '@/src/services/cloudinaryService';
import { useTranslation } from 'react-i18next';
import { alertPermissionPermanentlyDenied } from '@/src/utils/permissionAlert';
import { withTimeout } from '@/src/utils/withTimeout';

/** Max ms to wait for an RTDB write ack before treating the save as queued. */
const SAVE_TIMEOUT_MS = 12_000;

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
  goldText: '#B8860B' } as const;

// IMO card container: white, 12dp radius, 15dp side margins
const cardStyle = { backgroundColor: C.card, marginHorizontal: 15, marginTop: 12, borderRadius: 12 } as const;

// ─── IMO title bar: 56dp, back ‹ left, centered 17sp semibold, no gear ───
function TitleBar({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={{ height: 56, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }}>
      <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }} hitSlop={8}>
        <Feather name="chevron-left" size={24} color={C.text} />
      </Pressable>
      <Text style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: C.text }} numberOfLines={1}>
        {title}
      </Text>
      {right ?? <View style={{ width: 40 }} />}
    </View>
  );
}

function InputField({
  label, value, onChangeText, placeholder, multiline, maxLength }: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
}) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={{ color: C.muted, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.mutedLight}
        multiline={multiline}
        maxLength={maxLength}
        style={{
          backgroundColor: C.card,
          borderRadius: 12,
          paddingHorizontal: 16,
          paddingVertical: 14,
          color: C.text,
          fontSize: 15,
          borderWidth: 0.5,
          borderColor: C.border,
          minHeight: multiline ? 90 : undefined,
          textAlignVertical: multiline ? 'top' : 'auto' }}
      />
      {maxLength && (
        <Text style={{ color: C.mutedLight, fontSize: 11, textAlign: 'right', marginTop: 4 }}>
          {value.length}/{maxLength}
        </Text>
      )}
    </View>
  );
}

export default function EditProfileScreen() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const topPad = Platform.OS === 'web' ? 67 : 0;

  const [profile, setProfile] = useState<VeeUser | null>(null);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [photoURI, setPhotoURI] = useState<string>('');
  const [coverURI, setCoverURI] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);

  // Track whether we've already done the initial load from Firebase.
  // Without this, every Firebase update (e.g. after photo upload writes
  // the new URL) would reset the user's in-progress name/bio edits.
  const hasLoadedRef = useRef(false);

  // Load current profile from Firebase — only seed name/bio on first snapshot.
  useEffect(() => {
    if (!user?.uid) return;
    hasLoadedRef.current = false; // reset on uid change (re-mount)
    const unsub = subscribeUser(user.uid, (veeUser) => {
      if (!veeUser) return;
      setProfile(veeUser);
      // Always keep photo in sync (upload may update it at any time)
      setPhotoURI(veeUser.photoURL ?? '');
      setCoverURI(veeUser.coverImageUrl ?? '');
      // Only seed the text fields once — do not reset the user's in-progress edits
      if (!hasLoadedRef.current) {
        hasLoadedRef.current = true;
        setName(veeUser.name ?? '');
        setBio(veeUser.bio ?? '');
      }
    });
    return () => { hasLoadedRef.current = false; unsub(); };
  }, [user?.uid]);

  // ── Upload to Cloudinary + save URL to Firebase ───────────────────────────
  const uploadPhoto = useCallback(async (localUri: string) => {
    if (!user?.uid) return;
    setUploadingPhoto(true);
    try {
      // The old asset's publicId is stored in users/{uid}/photoPublicId by
      // the previous upload call.
      const oldPublicId = profile?.photoPublicId;

      const result = await uploadProfilePhoto(localUri);
      setPhotoURI(result.url);
      await updateUser(user.uid, {
        photoURL: result.url,
        ...(result.publicId ? { photoPublicId: result.publicId } : {}) });

      // 2026-10-19 (Sumon): delete the old asset ONLY AFTER the new upload
      // succeeded. Deleting before (the old RC8-B2 order) meant a failed
      // upload left Firebase pointing at a deleted image = black screen.
      // (Currently a no-op: Telegram storage has no delete; kept for the
      // safe ordering in case a future backend re-implements it.)
      if (oldPublicId && oldPublicId !== result.publicId) {
        deleteCloudinaryAsset(oldPublicId).catch(() => {/* non-critical */});
      }
    } catch (err) {
      Alert.alert(t('editProfile.error'), err instanceof Error ? err.message : t('editProfile.uploadFailedMsg'));
    } finally {
      setUploadingPhoto(false);
    }
  }, [user?.uid, profile?.photoPublicId, t]);

  // ── Upload cover to Cloudinary + save URL to Firebase ──────────────────────
  const uploadCover = useCallback(async (localUri: string) => {
    if (!user?.uid) return;
    setUploadingCover(true);
    try {
      const result = await uploadCoverPhoto(localUri);
      setCoverURI(result.url);
      await updateUser(user.uid, { coverImageUrl: result.url });
    } catch (err) {
      Alert.alert(t('editProfile.error'), err instanceof Error ? err.message : t('editProfile.uploadFailedMsg'));
    } finally {
      setUploadingCover(false);
    }
  }, [user?.uid, t]);

  // ── Pick cover from gallery ────────────────────────────────────────────────
  const pickCover = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow gallery access to choose a cover photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      await uploadCover(result.assets[0].uri);
    }
  }, [uploadCover]);

  // ── Pick photo from gallery ────────────────────────────────────────────────
  const pickPhoto = useCallback(async () => {
    const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      const title = t('editProfile.permissionNeeded');
      const msg = t('editProfile.galleryPermission');
      if (canAskAgain === false) alertPermissionPermanentlyDenied(title, msg);
      else Alert.alert(title, msg);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85 });

    if (!result.canceled && result.assets[0]) {
      await uploadPhoto(result.assets[0].uri);
    }
  }, [uploadPhoto, t]);

  // ── Take photo with camera ────────────────────────────────────────────────
  const takePhoto = useCallback(async () => {
    const { status, canAskAgain } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      const title = t('editProfile.permissionNeeded');
      const msg = t('editProfile.cameraPermission');
      if (canAskAgain === false) alertPermissionPermanentlyDenied(title, msg);
      else Alert.alert(title, msg);
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85 });

    if (!result.canceled && result.assets[0]) {
      await uploadPhoto(result.assets[0].uri);
    }
  }, [uploadPhoto, t]);

  // ── Show photo picker options ─────────────────────────────────────────────
  const handlePhotoPress = useCallback(() => {
    Alert.alert(t('editProfile.photoPicker'), '', [
      { text: t('editProfile.photoCamera'), onPress: takePhoto },
      { text: t('editProfile.photoGallery'), onPress: pickPhoto },
      { text: t('editProfile.photoCancel'), style: 'cancel' },
    ]);
  }, [takePhoto, pickPhoto, t]);

  // ── Save name + bio to Firebase ───────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!user?.uid) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert(t('editProfile.error'), t('editProfile.errorNoName'));
      return;
    }
    setSaving(true);
    try {
      // Offline resilience: an RTDB write promise only resolves on server
      // ack, so a bare await hangs forever with no feedback while offline.
      // Race the write against a timeout — the write is NOT cancelled (RTDB
      // queues it and replays on reconnect); we just stop showing the saving
      // state and tell the user it is queued.
      const result = await withTimeout(
        updateUser(user.uid, {
          name: trimmedName,
          bio: bio.trim() }),
        SAVE_TIMEOUT_MS,
      );
      if (result.timedOut) {
        Alert.alert(t('editProfile.saveQueuedTitle'), t('editProfile.saveQueuedMsg'));
        return;
      }
      Alert.alert(t('editProfile.savedTitle'), t('editProfile.savedMsg'), [
        { text: t('editProfile.savedOk'), onPress: () => router.back() },
      ]);
    } catch (err) {
      Alert.alert(t('editProfile.error'), err instanceof Error ? err.message : t('editProfile.saveError'));
    } finally {
      setSaving(false);
    }
  }, [user?.uid, name, bio, t]);

  const initials = name
    ? name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <View style={{ paddingTop: topPad }}>
        <TitleBar
          title={t('editProfile.title')}
          right={
            <Pressable
              onPress={handleSave}
              disabled={saving || uploadingPhoto}
              style={{ minWidth: 40, height: 40, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 12, opacity: saving ? 0.6 : 1 }}
              hitSlop={8}
            >
              {saving
                ? <PremiumLoader size="small" />
                : <Text style={{ color: C.blue, fontSize: 16, fontWeight: '600' }}>{t('editProfile.save')}</Text>}
            </Pressable>
          }
        />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* Cover picker */}
          <View style={[cardStyle, { padding: 12 }]}>
            <Pressable onPress={pickCover} style={{ borderRadius: 12, overflow: 'hidden' }}>
              <View style={{ height: 140, backgroundColor: C.tile, alignItems: 'center', justifyContent: 'center' }}>
                {uploadingCover ? (
                  <PremiumLoader size="large" />
                ) : coverURI ? (
                  <Image source={{ uri: coverURI }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                ) : (
                  <View style={{ alignItems: 'center' }}>
                    <Feather name="image" size={32} color={C.mutedLight} />
                    <Text style={{ color: C.muted, fontSize: 13, marginTop: 8 }}>Tap to add cover</Text>
                  </View>
                )}
              </View>
            </Pressable>
          </View>

          {/* Avatar picker */}
          <View style={{ alignItems: 'center', marginTop: 20, marginBottom: 8 }}>
            <Pressable onPress={handlePhotoPress} hitSlop={8}>
              <View style={{ position: 'relative' }}>
                {/* Avatar */}
                <View style={{
                  width: 110, height: 110, borderRadius: 55,
                  borderWidth: 3, borderColor: C.blueLight,
                  overflow: 'hidden',
                  backgroundColor: C.blueLight,
                  alignItems: 'center', justifyContent: 'center' }}>
                  {uploadingPhoto ? (
                    <PremiumLoader size="large" />
                  ) : photoURI ? (
                    <Image source={{ uri: photoURI }} style={{ width: 110, height: 110 }} />
                  ) : (
                    <Text style={{ color: C.blue, fontSize: 36, fontWeight: '800' }}>{initials}</Text>
                  )}
                </View>

                {/* Camera badge */}
                <View style={{
                  position: 'absolute', bottom: 2, right: 2,
                  width: 34, height: 34, borderRadius: 17,
                  backgroundColor: C.blue,
                  borderWidth: 2.5, borderColor: C.bg,
                  alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="camera" size={15} color="#fff" />
                </View>
              </View>
            </Pressable>

            <Text style={{ color: C.muted, fontSize: 13, marginTop: 12 }}>
              {t('editProfile.photoTapHint')}
            </Text>
          </View>

          {/* Form — name + bio */}
          <View style={[cardStyle, { padding: 15 }]}>
            <InputField
              label={t('editProfile.fieldName')}
              value={name}
              onChangeText={setName}
              placeholder={t('editProfile.namePlaceholder')}
              maxLength={40}
            />
            <InputField
              label={t('editProfile.fieldBio')}
              value={bio}
              onChangeText={setBio}
              placeholder={t('editProfile.bioPlaceholder')}
              multiline
              maxLength={150}
            />

            {/* Vee ID (read-only) — NO # prefix (sacred) */}
            <View style={{ marginBottom: 18 }}>
              <Text style={{ color: C.muted, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>
                {t('editProfile.fieldVeeId')}
              </Text>
              <View style={{
                backgroundColor: C.tile,
                borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
                borderWidth: 0.5, borderColor: C.border,
                flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: C.muted, fontSize: 15 }}>
                  {profile?.vId ?? '...'}
                </Text>
                <Feather name="lock" size={13} color={C.mutedLight} style={{ marginLeft: 'auto' }} />
              </View>
            </View>

            {/* Email (read-only) */}
            <View>
              <Text style={{ color: C.muted, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>
                {t('editProfile.fieldEmail')}
              </Text>
              <View style={{
                backgroundColor: C.tile,
                borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
                borderWidth: 0.5, borderColor: C.border,
                flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Feather name="mail" size={15} color={C.mutedLight} />
                <Text style={{ color: C.muted, fontSize: 15 }} numberOfLines={1}>
                  {user?.email ?? '...'}
                </Text>
                <Feather name="lock" size={13} color={C.mutedLight} style={{ marginLeft: 'auto' }} />
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
