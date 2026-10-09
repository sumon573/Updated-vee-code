/**
 * Edit Profile Screen — ধাপ ২
 * নাম, bio পরিবর্তন + Cloudinary photo upload
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, ScrollView, Alert,
  ActivityIndicator, Image, Platform, KeyboardAvoidingView, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import ScalePress from '@/components/ScalePress';
import { useAuth } from '@/src/context/AuthContext';
import { updateUser, VeeUser, subscribeUser } from '@/src/services/userService';
import { uploadProfilePhoto, uploadCoverPhoto, deleteCloudinaryAsset } from '@/src/services/cloudinaryService';
import { useTranslation } from 'react-i18next';
import { alertPermissionPermanentlyDenied } from '@/src/utils/permissionAlert';
import { withTimeout } from '@/src/utils/withTimeout';

/** Max ms to wait for an RTDB write ack before treating the save as queued. */
const SAVE_TIMEOUT_MS = 12_000;

const C = {
  bg: '#FFFFFF',
  primary: '#7C3AED',
  glow: '#8B5CF6',
  text: '#000000',
  muted: '#8E8E93',
  mutedDim: '#C7C7CC',
  border: '#E5E5EA',
  surface: '#F2F2F7',
  error: '#EF4444',
  success: '#22C55E',
} as const;

function InputField({
  label, value, onChangeText, placeholder, multiline, maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
}) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700', marginBottom: 8, letterSpacing: 0.5 }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.mutedDim}
        multiline={multiline}
        maxLength={maxLength}
        style={{
          backgroundColor: C.surface,
          borderRadius: 14,
          paddingHorizontal: 16,
          paddingVertical: 14,
          color: C.text,
          fontSize: 15,
          borderWidth: 1,
          borderColor: C.border,
          minHeight: multiline ? 90 : undefined,
          textAlignVertical: multiline ? 'top' : 'auto',
        }}
      />
      {maxLength && (
        <Text style={{ color: C.mutedDim, fontSize: 11, textAlign: 'right', marginTop: 4 }}>
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
      // RC8-B2: Delete old Cloudinary asset before uploading a new one to prevent
      // orphaned images accumulating in the Cloudinary account. The publicId is
      // stored in users/{uid}/photoPublicId by the previous upload call.
      const oldPublicId = profile?.photoPublicId;
      if (oldPublicId) {
        deleteCloudinaryAsset(oldPublicId).catch(() => {/* non-critical */});
      }

      const result = await uploadProfilePhoto(localUri);
      setPhotoURI(result.url);
      await updateUser(user.uid, {
        photoURL: result.url,
        ...(result.publicId ? { photoPublicId: result.publicId } : {}),
      });
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
      quality: 0.8,
    });
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
      quality: 0.85,
    });

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
      quality: 0.85,
    });

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
          bio: bio.trim(),
        }),
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
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 60, paddingTop: topPad + 12 }}
          >
            {/* Header */}
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 18, marginBottom: 32,
            }}>
              <ScalePress onPress={() => router.back()}>
                <View style={{
                  width: 38, height: 38, borderRadius: 19,
                  backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                  alignItems: 'center', justifyContent: 'center', marginRight: 14,
                }}>
                  <Feather name="arrow-left" size={18} color={C.text} />
                </View>
              </ScalePress>
              <Text style={{ color: C.text, fontSize: 20, fontWeight: '900', flex: 1 }}>
                {t('editProfile.title')}
              </Text>
              <ScalePress onPress={handleSave} disabled={saving || uploadingPhoto}>
                <View style={{
                  backgroundColor: C.primary, borderRadius: 22,
                  paddingHorizontal: 20, paddingVertical: 10,
                  opacity: saving ? 0.6 : 1,
                  shadowColor: C.glow, shadowOpacity: 0.4, shadowRadius: 12,
                }}>
                  {saving
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>{t('editProfile.save')}</Text>}
                </View>
              </ScalePress>
            </View>

            {/* Cover picker */}
            <View style={{ marginBottom: 24 }}>
              <Text style={{ color: C.muted, fontSize: 14, fontWeight: '600', marginBottom: 10 }}>
                Cover Photo
              </Text>
              <Pressable onPress={pickCover} style={{ borderRadius: 16, overflow: 'hidden' }}>
                <View style={{ height: 140, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}>
                  {uploadingCover ? (
                    <ActivityIndicator color={C.glow} size="large" />
                  ) : coverURI ? (
                    <Image source={{ uri: coverURI }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  ) : (
                    <View style={{ alignItems: 'center' }}>
                      <Feather name="image" size={32} color={C.muted} />
                      <Text style={{ color: C.muted, fontSize: 13, marginTop: 8 }}>Tap to add cover</Text>
                    </View>
                  )}
                </View>
              </Pressable>
            </View>

            {/* Avatar picker */}
            <View style={{ alignItems: 'center', marginBottom: 36 }}>
              <ScalePress onPress={handlePhotoPress}>
                <View style={{ position: 'relative' }}>
                  {/* Avatar */}
                  <View style={{
                    width: 110, height: 110, borderRadius: 55,
                    borderWidth: 3, borderColor: C.glow,
                    shadowColor: C.glow, shadowOpacity: 0.45, shadowRadius: 22,
                    overflow: 'hidden',
                    backgroundColor: 'rgba(139,92,246,0.2)',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {uploadingPhoto ? (
                      <ActivityIndicator color={C.glow} size="large" />
                    ) : photoURI ? (
                      <Image source={{ uri: photoURI }} style={{ width: 110, height: 110 }} />
                    ) : (
                      <Text style={{ color: C.glow, fontSize: 36, fontWeight: '900' }}>{initials}</Text>
                    )}
                  </View>

                  {/* Camera badge */}
                  <View style={{
                    position: 'absolute', bottom: 2, right: 2,
                    width: 34, height: 34, borderRadius: 17,
                    backgroundColor: C.primary,
                    borderWidth: 2.5, borderColor: C.bg,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Feather name="camera" size={15} color="#fff" />
                  </View>
                </View>
              </ScalePress>

              <Text style={{ color: C.muted, fontSize: 13, marginTop: 12 }}>
                {t('editProfile.photoTapHint')}
              </Text>
            </View>

            {/* Form */}
            <View style={{ paddingHorizontal: 22 }}>
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

              {/* Vee ID (read-only) */}
              <View style={{ marginBottom: 18 }}>
                <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700', marginBottom: 8, letterSpacing: 0.5 }}>
                  {t('editProfile.fieldVeeId')}
                </Text>
                <View style={{
                  backgroundColor: C.surface,
                  borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
                  borderWidth: 1, borderColor: C.border,
                  flexDirection: 'row', alignItems: 'center', gap: 8,
                }}>
                  <Feather name="hash" size={15} color={C.mutedDim} />
                  <Text style={{ color: C.mutedDim, fontSize: 15 }}>
                    {profile?.vId ?? '...'}
                  </Text>
                  <Feather name="lock" size={13} color={C.mutedDim} style={{ marginLeft: 'auto' }} />
                </View>
              </View>

              {/* Email (read-only) */}
              <View style={{ marginBottom: 18 }}>
                <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700', marginBottom: 8, letterSpacing: 0.5 }}>
                  {t('editProfile.fieldEmail')}
                </Text>
                <View style={{
                  backgroundColor: C.surface,
                  borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
                  borderWidth: 1, borderColor: C.border,
                  flexDirection: 'row', alignItems: 'center', gap: 8,
                }}>
                  <Feather name="mail" size={15} color={C.mutedDim} />
                  <Text style={{ color: C.mutedDim, fontSize: 15 }}>
                    {user?.email ?? '...'}
                  </Text>
                  <Feather name="lock" size={13} color={C.mutedDim} style={{ marginLeft: 'auto' }} />
                </View>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
