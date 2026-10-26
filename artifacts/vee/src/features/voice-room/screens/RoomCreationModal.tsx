import type { ComponentProps } from 'react';
import { useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, ScrollView, Animated, Alert, Platform, Image } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import ScalePress from '@/components/ScalePress';
import * as Crypto from 'expo-crypto';
import { useAuth } from '@/src/context/AuthContext';
import { createRoom, getUserColor, getInitials } from '../services/firebaseRoomService';
import { uploadRoomCover } from '@/src/services/cloudinaryService';

// 2026-10-23 (Sumon): light, flat, professional theme — the old near-black
// purple look is gone. White surface, hairline borders, soft grey inputs,
// zero shadows; the violet brand color survives only as an accent.
const C = {
  bg:          '#FFFFFF',
  card:        '#F7F7FA',
  primary:     '#7C3AED',
  glow:        '#8B5CF6',
  text:        '#17131F',
  muted:       '#6F6A82',
  mutedDim:    '#A6A1B5',
  border:      'rgba(23,19,31,0.12)',
  borderFaint: 'rgba(23,19,31,0.07)',
  inputBg:     '#F7F7FA',
  error:       '#E5484D',
  gold:        '#F59E0B' } as const;

const AVATAR_COLORS = [
  '#7C3AED', '#EC4899', '#3B82F6', '#10B981',
  '#F97316', '#A855F7', '#0EA5E9', '#22C55E',
  '#EF4444', '#F59E0B',
];

type Props = {
  visible: boolean;
  onClose: () => void;
  onRoomCreated: (roomId: string) => void;
};

function Field({
  icon, placeholder, value, onChange, multiline, maxLength }: {
  icon: ComponentProps<typeof Feather>['name'];
  placeholder: string;
  value: string;
  onChange: (t: string) => void;
  multiline?: boolean;
  maxLength?: number;
}) {
  const [focused, setFocused] = useState(false);

  // Perf (2026-10-22 audit): the border tint used to be a JS-thread
  // Animated color interpolation on every focus/blur. A direct state-driven
  // borderColor looks the same and costs no animation frames.
  return (
    <Animated.View style={{
      flexDirection: multiline ? 'column' : 'row',
      alignItems: multiline ? 'flex-start' : 'center',
      borderRadius: 14, borderWidth: 1, borderColor: focused ? C.primary : C.border,
      backgroundColor: focused ? '#FFFFFF' : C.inputBg,
      paddingHorizontal: 16, paddingVertical: multiline ? 12 : 0,
      minHeight: multiline ? 90 : 54, marginBottom: 12 }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        marginBottom: multiline ? 6 : 0, marginRight: multiline ? 0 : 10 }}>
        <Feather name={icon} size={16} color={focused ? C.primary : C.mutedDim} />
      </View>
      <TextInput
        style={{ flex: 1, color: C.text, fontSize: 15, fontWeight: '500',
          height: multiline ? undefined : '100%',
          textAlignVertical: multiline ? 'top' : 'center' }}
        placeholder={placeholder}
        placeholderTextColor={C.mutedDim}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        maxLength={maxLength}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoCorrect={false}
      />
      {maxLength && value.length > 0 && (
        <Text style={{ color: C.mutedDim, fontSize: 10, alignSelf: 'flex-end' }}>
          {value.length}/{maxLength}
        </Text>
      )}
    </Animated.View>
  );
}

export default function RoomCreationModal({ visible, onClose, onRoomCreated }: Props) {
  const { user } = useAuth();
  const { t } = useTranslation();

  type RoomCategory = 'adda' | 'music' | 'game' | 'talk' | 'study';

  const CATEGORY_OPTIONS: { key: RoomCategory; label: string; emoji: string }[] = [
    { key: 'adda',  label: t('voiceRoom.creation.categoryAdda',  { defaultValue: 'Hangout' }), emoji: '💬' },
    { key: 'music', label: t('voiceRoom.creation.categoryMusic', { defaultValue: 'Music'  }), emoji: '🎵' },
    { key: 'game',  label: t('voiceRoom.creation.categoryGame',  { defaultValue: 'Game'   }), emoji: '🎮' },
    { key: 'talk',  label: t('voiceRoom.creation.categoryTalk',  { defaultValue: 'Talk'   }), emoji: '🗣️' },
    { key: 'study', label: t('voiceRoom.creation.categoryStudy', { defaultValue: 'Study'  }), emoji: '📚' },
  ];

  const [name,        setName]        = useState('');
  const [topic,       setTopic]       = useState('');
  const [description, setDescription] = useState('');
  const [isPublic,    setIsPublic]    = useState(true);
  const [category,    setCategory]    = useState<RoomCategory>('adda');
  const [profileColor, setProfileColor] = useState(AVATAR_COLORS[0]);
  const [profileImage, setProfileImage] = useState<string | undefined>(undefined);
  const [creating,    setCreating]    = useState(false);
  const [pin,         setPin]         = useState('');
  const [pinError,    setPinError]    = useState('');

  const pickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (!res.canceled && res.assets[0]) {
      setProfileImage(res.assets[0].uri);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert(t('voiceRoom.creation.title'), t('voiceRoom.creation.errorNoName')); return;
    }
    if (!user) {
      Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.creation.errorNotLoggedIn')); return;
    }
    setCreating(true);
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      let coverImageUrl: string | undefined;
      if (profileImage) {
        try {
          const uploaded = await uploadRoomCover(profileImage);
          coverImageUrl = uploaded.url;
        } catch {
          // Non-fatal — the room is still created without a cover image.
          Alert.alert(
            t('voiceRoom.creation.coverUploadFailedTitle'),
            t('voiceRoom.creation.coverUploadFailedMsg'),
          );
        }
      }

      // Fix 6: Silently try to attach geolocation to the room (best-effort)
      let location: { lat: number; lng: number } | undefined;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced });
          location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        }
      } catch { /* non-critical — room is created without location */ }

      // Room creation limit — 2026-10-13: মোডালের নিজস্ব pre-check সরানো হলো।
      // আগে এখানে "max 1 public" বলত, অথচ createRoom() সার্ভিসে Sumon-এর নিয়ম
      // "max 2 public + 1 private" enforce হয় (ROOM_LIMIT_PUBLIC/PRIVATE) —
      // দুই জায়গার অমিলে ২য় public room বানাতে গেলে ভুল বার্তা আসত।
      // এখন একমাত্র সার্ভিসই limit দেখে; নিচের catch-এ সেটার বার্তাই দেখায়।

      // Validate PIN for private room
      if (!isPublic) {
        if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
          Alert.alert('PIN Required', 'Please enter a 4-digit numeric PIN for your Private Room.');
          setCreating(false);
          return;
        }
      }

      // Hash PIN for secure storage
      let hashedPin: string | undefined;
      if (!isPublic && pin) {
        hashedPin = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pin);
      }

      const roomId = await createRoom({
        name: name.trim(),
        topic: topic.trim() || t('voiceRoom.creation.defaultTopic'),
        description: description.trim(),
        isPublic,
        category,
        themeColor: profileColor,
        hostId: user.uid,
        // 2026-10-13: DB profile থেকে নাম (Auth displayName Google user-দের
        // ক্ষেত্রে খালি থাকতে পারে) —
        // 2026-10-13 fix: photoURL-ও DB থেকে নাও; আগে শুধু auth photoURL
        // ব্যবহার হতো বলে Google user-দের seat 0-তে DP আসত না।
        ...await (async () => {
          try {
            const { get: dbGet, ref: dbRef } = await import('firebase/database');
            const { database: db } = await import('@/src/config/firebase');
            const snap = await dbGet(dbRef(db, `users/${user.uid}`));
            if (snap.exists()) {
              const p = snap.val() as any;
              return {
                // 2026-10-26 (boss: one name only): no Auth fallback.
                hostName: p.name || p.displayName || t('voiceRoom.screen.defaultUserName'),
                // P1 fix (2026-10-12): || not ?? — খালি-string photoURL অকেজো
                hostPhotoURL: p.photoURL || user.photoURL || undefined };
            }
          } catch { /* fallback */ }
          return {
            hostName: t('voiceRoom.screen.defaultUserName'),
            hostPhotoURL: user.photoURL || undefined };
        })(),
        coverImageUrl,
        location,
        hashedPin });

      // Reset form
      setName('');
      setTopic('');
      setDescription('');
      setIsPublic(true);
      setPin('');
      setPinError('');
      setCategory('adda');
      setProfileColor(AVATAR_COLORS[0]);
      setProfileImage(undefined);

      onRoomCreated(roomId);
    } catch (e: any) {
      // ROOM LIMITS (2026-10-10): show specific message for limit errors
      const msg = e?.message || '';
      if (msg === 'ROOM_LIMIT_PUBLIC') {
        Alert.alert(
          t('voiceRoom.screen.error'),
          'You can create max 2 public rooms. Delete one to create a new one.'
        );
      } else if (msg === 'ROOM_LIMIT_PRIVATE') {
        Alert.alert(
          t('voiceRoom.screen.error'),
          'You can create max 1 private room. Delete it to create a new one.'
        );
      } else {
        // PERMANENT (2026-10-10, Sumon's order): Always show the ACTUAL error
        // cause, not just a generic message. This way if any problem happens
        // in the future, the cause is visible immediately for diagnosis.
        // Format: user-friendly line + technical details below.
        Alert.alert(
          t('voiceRoom.screen.error'),
          `Could not create room.\n\nReason: ${msg}\n\nIf this keeps happening, please send a screenshot.`
        );
      }
    } finally {
      setCreating(false);
    }
  };

  const roomTypeOptions = [
    { label: t('voiceRoom.creation.publicLabel'), value: true,  desc: t('voiceRoom.creation.publicDesc') },
    { label: t('voiceRoom.creation.privateLabel'), value: false, desc: t('voiceRoom.creation.privateDesc') },
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              paddingTop: Platform.OS === 'web' ? 68 : 12,
              marginBottom: 28 }}>
              <Pressable onPress={onClose} style={{ padding: 6, marginRight: 12 }}>
                <Feather name="x" size={22} color={C.muted} />
              </Pressable>
              <Text style={{ color: C.text, fontSize: 22, fontWeight: '900', flex: 1 }}>
                {t('voiceRoom.creation.title')}
              </Text>
            </View>

            {/* Profile image picker */}
            <View style={{ alignItems: 'center', marginBottom: 28 }}>
              <Pressable onPress={pickImage}>
                <View style={{
                  width: 96, height: 96, borderRadius: 24,
                  backgroundColor: profileImage ? 'transparent' : profileColor,
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: 'rgba(23,19,31,0.08)',
                  overflow: 'hidden' }}>
                  {profileImage
                    ? <Image source={{ uri: profileImage }} style={{ width: '100%', height: '100%' }} />
                    : <Feather name="mic" size={36} color="rgba(255,255,255,0.9)" />
                  }
                </View>
              </Pressable>
              <Text style={{ color: C.mutedDim, fontSize: 12, marginTop: 8 }}>
                {t('voiceRoom.creation.coverPhotoLabel')}
              </Text>
            </View>

            {/* Color picker */}
            <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700', marginBottom: 10, letterSpacing: 0.5 }}>
              {t('voiceRoom.creation.roomColorLabel')}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
              {AVATAR_COLORS.map((color) => (
                <Pressable key={color} onPress={() => setProfileColor(color)}>
                  <View style={{
                    width: 34, height: 34, borderRadius: 17,
                    backgroundColor: color,
                    borderWidth: profileColor === color ? 3 : 1,
                    borderColor: profileColor === color ? C.text : 'rgba(23,19,31,0.10)' }} />
                </Pressable>
              ))}
            </View>

            {/* Fields */}
            <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700', marginBottom: 10, letterSpacing: 0.5 }}>
              {t('voiceRoom.creation.roomInfoLabel')}
            </Text>

            <Field
              icon="mic"
              placeholder={t('voiceRoom.creation.namePlaceholder')}
              value={name}
              onChange={setName}
              maxLength={40}
            />
            <Field
              icon="tag"
              placeholder={t('voiceRoom.creation.topicPlaceholder')}
              value={topic}
              onChange={setTopic}
              maxLength={50}
            />
            <Field
              icon="align-left"
              placeholder={t('voiceRoom.creation.descriptionPlaceholder')}
              value={description}
              onChange={setDescription}
              multiline
              maxLength={150}
            />

            {/* Public / Private toggle */}
            <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700', marginBottom: 10, marginTop: 4, letterSpacing: 0.5 }}>
              {t('voiceRoom.creation.roomTypeLabel')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 28 }}>
              {roomTypeOptions.map((opt) => (
                <ScalePress key={String(opt.value)} onPress={() => setIsPublic(opt.value)}>
                  <View style={{
                    flex: 1, borderRadius: 14, padding: 14,
                    backgroundColor: isPublic === opt.value ? C.primary + '14' : C.inputBg,
                    borderWidth: 1,
                    borderColor: isPublic === opt.value ? C.primary : C.border }}>
                    <Text style={{ color: C.text, fontWeight: '800', fontSize: 14 }}>
                      {opt.label}
                    </Text>
                    <Text style={{ color: C.mutedDim, fontSize: 11, marginTop: 3 }}>
                      {opt.desc}
                    </Text>
                  </View>
                </ScalePress>
              ))}
            </View>

            {/* 4-digit PIN for Private rooms */}
            {!isPublic && (
              <View style={{ marginBottom: 16 }}>
                <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700', marginBottom: 10, letterSpacing: 0.5 }}>
                  Room PIN (4-digit number)
                </Text>
                <View style={{
                  flexDirection: 'row', alignItems: 'center',
                  borderRadius: 14, borderWidth: 1,
                  borderColor: pinError ? C.error : C.border,
                  backgroundColor: C.inputBg, paddingHorizontal: 16,
                  minHeight: 54 }}>
                  <Feather name={'lock'} size={16} color={pinError ? C.error : C.mutedDim} style={{ marginRight: 10 }} />
                  <TextInput
                    style={{ flex: 1, color: C.text, fontSize: 22, fontWeight: '700', letterSpacing: 10 }}
                    placeholder={'0000'}
                    placeholderTextColor={C.mutedDim}
                    value={pin}
                    onChangeText={(txt) => {
                      const digits = txt.replace(/[^0-9]/g, '').slice(0, 4);
                      setPin(digits);
                      if (pinError) setPinError('');
                    }}
                    keyboardType={'number-pad'}
                    maxLength={4}
                    secureTextEntry={true}
                    autoCorrect={false}
                  />
                  <Text style={{ color: C.mutedDim, fontSize: 11 }}>{pin.length}/4</Text>
                </View>
                {pinError ? (
                  <Text style={{ color: C.error, fontSize: 12, marginTop: 5 }}>{pinError}</Text>
                ) : (
                  <Text style={{ color: C.mutedDim, fontSize: 11, marginTop: 5 }}>
                    This PIN is required to join your Private Room
                  </Text>
                )}
              </View>
            )}

            {/* Category picker */}
            <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700', marginBottom: 10, marginTop: 4, letterSpacing: 0.5 }}>
              {t('voiceRoom.creation.categoryLabel', { defaultValue: 'Room Category' })}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 28 }}>
              {CATEGORY_OPTIONS.map((opt) => {
                const isActive = category === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => { setCategory(opt.key); }}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 6,
                      borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9,
                      backgroundColor: isActive ? C.primary + '14' : C.inputBg,
                      borderWidth: 1,
                      borderColor: isActive ? C.primary : C.border }}
                  >
                    <Text style={{ fontSize: 14 }}>{opt.emoji}</Text>
                    <Text style={{ color: isActive ? C.text : C.muted, fontSize: 13, fontWeight: isActive ? '800' : '600' }}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Create button */}
            <ScalePress onPress={handleCreate} disabled={creating}>
              <View style={{
                borderRadius: 14, padding: 16,
                backgroundColor: C.primary,
                alignItems: 'center',
                opacity: creating ? 0.7 : 1 }}>
                {creating
                  ? <PremiumLoader size="medium" />
                  : <Text style={{ color: '#fff', fontSize: 17, fontWeight: '900', letterSpacing: 0.3 }}>
                      {t('voiceRoom.creation.createButton')}
                    </Text>
                }
              </View>
            </ScalePress>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
