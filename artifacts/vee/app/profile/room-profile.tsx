// Room Profile page — 2026-10-29 (boss, imo mirror)
// Opened by the profile's bottom "Edit" button. Exact imo row order:
//   Edit Profile | Bio | Motto | Level | Gender | Birthday |
//   Country/Region | VoiceClub ID | Background
//
// Birthday → age is CALCULATED and shown on the profile chip (never typed).
// VoiceClub ID is display-only (NO chevron) and is the SAME value as the
// "..." popup (profile vId) — never the short 4-digit ID.
// Country/Region row: rendered imo-exact (value + chevron) but its tap is
// a no-op display for now — the boss has not decided automatic-only vs
// picker. Do NOT build a country picker here.
// NOTE: city/hometown/birthday/gender/country are NOT in the VeeUser type
// and sanitizeVeeUser drops them on read, so they are read raw here and
// written via updateUser (a plain update). Follow-up: add these fields to
// VeeUser + sanitize (userService change, separate order).

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Image, Modal, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/src/context/AuthContext';
import { subscribeUser, updateUser } from '@/src/services/userService';
import { subscribeLevel } from '@/src/services/levelService';
import { uploadCoverPhoto } from '@/src/services/cloudinaryService';
import { getErrorCause } from '@/src/utils/errorDisplay';
import PremiumLoader from '@/src/components/PremiumLoader';
import { LevelBadge, calcAge, genderSymbol } from './index';

const C = {
  bg: '#F4F5F5', card: '#FFFFFF', text: '#1A1A1A', muted: '#666666',
  mutedLight: '#999999', border: '#EEEEEE', tile: '#F0F0F0',
  blue: '#007AFF', blueLight: '#E6F2FF', green: '#34C759', red: '#FF3B30',
};

type ExtraFields = {
  city?: string; hometown?: string; birthday?: string; gender?: string; country?: string;
};

function Row({ label, value, sub, onPress, chevron = true, children }: {
  label: string; value?: string; sub?: string[];
  onPress?: () => void; chevron?: boolean; children?: React.ReactNode;
}) {
  const body = (
    <View style={{ paddingVertical: 14, paddingHorizontal: 15 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 16, color: C.text, flex: 1 }}>{label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
          {value ? (
            <Text style={{ fontSize: 15, color: C.muted, marginRight: 6 }} numberOfLines={1}>{value}</Text>
          ) : null}
          {children}
          {chevron && <Feather name="chevron-right" size={18} color={C.mutedLight} />}
        </View>
      </View>
      {sub && sub.length > 0 && (
        <View style={{ marginTop: 6 }}>
          {sub.map((line, i) => (
            <Text key={i} style={{ fontSize: 14, color: C.muted, marginTop: i === 0 ? 0 : 2 }}>{line}</Text>
          ))}
        </View>
      )}
    </View>
  );
  if (!onPress) return <View>{body}</View>;
  return <Pressable onPress={onPress}>{body}</Pressable>;
}

function Divider() {
  return <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 15 }} />;
}

export default function RoomProfileScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ uid?: string }>();
  const displayUid = typeof params.uid === 'string' ? params.uid : user?.uid;
  const isMe = !!displayUid && displayUid === user?.uid;

  const [profile, setProfile] = useState<any>(null);
  const [extra, setExtra] = useState<ExtraFields>({});
  const [levelInfo, setLevelInfo] = useState<{ totalLevel: number; xp: number } | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);

  const [bioModal, setBioModal] = useState(false);
  const [cityDraft, setCityDraft] = useState('');
  const [hometownDraft, setHometownDraft] = useState('');
  const [mottoModal, setMottoModal] = useState(false);
  const [mottoDraft, setMottoDraft] = useState('');
  const [birthdayModal, setBirthdayModal] = useState(false);
  const [birthdayDraft, setBirthdayDraft] = useState('');

  useEffect(() => {
    if (!displayUid) return;
    return subscribeUser(displayUid, setProfile);
  }, [displayUid]);

  useEffect(() => {
    if (!displayUid) { setExtra({}); return; }
    let cancelled = false;
    let unsub: (() => void) | undefined;
    void (async () => {
      try {
        const { ref, onValue } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        if (cancelled) return;
        unsub = onValue(ref(database, `users/${displayUid}`), (snap) => {
          const v = snap.val() as any;
          if (!v || typeof v !== 'object') { setExtra({}); return; }
          const pick = (k: string) => (typeof v[k] === 'string' ? v[k] : undefined);
          setExtra({
            city: pick('city'), hometown: pick('hometown'),
            birthday: pick('birthday'), gender: pick('gender'), country: pick('country'),
          });
        });
      } catch {}
    })();
    return () => { cancelled = true; unsub?.(); };
  }, [displayUid]);

  useEffect(() => {
    if (!displayUid) return;
    return subscribeLevel(displayUid, (lvl) => setLevelInfo(lvl));
  }, [displayUid]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/home' as never);
  }, [router]);

  const saveFields = useCallback(async (fields: Record<string, string>) => {
    if (!displayUid) return;
    try {
      await updateUser(displayUid, fields as any);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Could not save', `Reason: ${getErrorCause(err)}`);
    }
  }, [displayUid]);

  const handleChangeCover = useCallback(async () => {
    if (!user?.uid || !isMe) return;
    Alert.alert('Cover photo', 'Change your profile cover photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Change photo',
        onPress: async () => {
          try {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
              Alert.alert('Permission needed', 'Please allow gallery access to choose a cover photo.');
              return;
            }
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              allowsEditing: true,
              aspect: [16, 9],
              quality: 0.85 });
            if (result.canceled || !result.assets[0]) return;
            setUploadingCover(true);
            try {
              const upload = await uploadCoverPhoto(result.assets[0].uri);
              await updateUser(user.uid, { coverImageUrl: upload.url });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (err) {
              Alert.alert('Could not update cover', `Reason: ${getErrorCause(err)}`);
            } finally {
              setUploadingCover(false);
            }
          } catch (err) {
            Alert.alert('Could not open gallery', `Reason: ${getErrorCause(err)}`);
          }
        } },
    ]);
  }, [user?.uid, isMe]);

  const openGenderPicker = useCallback(() => {
    if (!isMe) return;
    Alert.alert('Gender', 'Choose your gender', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Male', onPress: () => void saveFields({ gender: 'Male' }) },
      { text: 'Female', onPress: () => void saveFields({ gender: 'Female' }) },
      { text: 'Other', onPress: () => void saveFields({ gender: 'Other' }) },
    ]);
  }, [isMe, saveFields]);

  const validBirthday = (s: string): boolean => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!m) return false;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return false;
    return d.getTime() <= Date.now();
  };

  const displayName = profile?.name ?? 'User';
  const photoURL = profile?.photoURL ?? null;
  const vId = profile?.vId ?? null;
  const bio = profile?.bio ?? '';
  const totalLevel = levelInfo?.totalLevel ?? 1;
  const genderSym = genderSymbol(extra.gender);
  const age = calcAge(extra.birthday);
  const cityLines = [extra.city, extra.hometown].filter((x): x is string => !!x);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      {/* Header: 56dp, back left, title centered 17sp semibold */}
      <View style={{
        height: 56, flexDirection: 'row', alignItems: 'center',
        backgroundColor: C.card, borderBottomWidth: 0.5, borderBottomColor: C.border }}>
        <Pressable onPress={goBack} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }} hitSlop={8}>
          <Feather name="arrow-left" size={24} color={C.text} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: C.text }}>Room Profile</Text>
        </View>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ backgroundColor: C.card, borderRadius: 12, marginHorizontal: 12, marginTop: 12, overflow: 'hidden' }}>
          <Row
            label="Edit Profile"
            onPress={isMe ? () => router.push('/profile/edit') : undefined}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 6 }}>
              {photoURL ? (
                <Image source={{ uri: photoURL }} style={{ width: 40, height: 40, borderRadius: 20, marginRight: 8 }} />
              ) : (
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.blueLight, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: C.blue }}>{displayName[0]?.toUpperCase()}</Text>
                </View>
              )}
              <Text style={{ fontSize: 15, color: C.text }} numberOfLines={1}>{displayName}</Text>
            </View>
          </Row>
          <Divider />

          <Row
            label="Bio"
            sub={cityLines}
            onPress={isMe ? () => { setCityDraft(extra.city ?? ''); setHometownDraft(extra.hometown ?? ''); setBioModal(true); } : undefined}
          />
          <Divider />

          <Row
            label="Motto"
            sub={bio ? [bio] : undefined}
            onPress={isMe ? () => { setMottoDraft(bio); setMottoModal(true); } : undefined}
          />
          <Divider />

          <Row
            label="Level"
            onPress={() => {
              Alert.alert('Level', `You are Level ${totalLevel}${levelInfo ? ` (${levelInfo.xp} XP).` : '.'}`);
            }}
          >
            <View style={{ marginRight: 6 }}>
              <LevelBadge level={totalLevel} width={100} />
            </View>
          </Row>
          <Divider />

          <Row
            label="Gender"
            value={extra.gender ?? ''}
            onPress={isMe ? openGenderPicker : undefined}
          />
          <Divider />

          <Row
            label="Birthday"
            value={extra.birthday ?? ''}
            onPress={isMe ? () => { setBirthdayDraft(extra.birthday ?? ''); setBirthdayModal(true); } : undefined}
          />
          <Divider />

          {/* Country/Region: imo-exact row, tap is a no-op display for now.
              Boss decision pending: automatic-only vs picker. No picker built. */}
          <Row label="Country/Region" value={extra.country ?? ''} />
          <Divider />

          {/* VoiceClub ID: display-only, NO chevron. Same value as the "..." popup. */}
          <Row label="VoiceClub ID" value={vId ?? ''} chevron={false} />
          <Divider />

          <Row
            label="Background"
            onPress={isMe ? handleChangeCover : undefined}
          >
            <View style={{ marginRight: 6 }}>
              {uploadingCover ? (
                <PremiumLoader size="small" />
              ) : profile?.coverImageUrl ? (
                <Image source={{ uri: profile.coverImageUrl }} style={{ width: 64, height: 40, borderRadius: 8 }} resizeMode="cover" />
              ) : (
                <View style={{ width: 64, height: 40, borderRadius: 8, backgroundColor: C.tile, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="image" size={18} color={C.mutedLight} />
                </View>
              )}
            </View>
          </Row>
        </View>

        {age !== null && (
          <Text style={{ fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 16 }}>
            {genderSym ? `${genderSym} ` : ''}Age {age} — calculated from your birthday
          </Text>
        )}
      </ScrollView>

      {/* Bio editor: city + hometown */}
      <Modal visible={bioModal} transparent animationType="fade" onRequestClose={() => setBioModal(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 }} onPress={() => setBioModal(false)}>
          <Pressable style={{ width: '100%', backgroundColor: C.card, borderRadius: 16, padding: 20 }} onPress={() => {}}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: C.text, marginBottom: 12 }}>Bio</Text>
            <Text style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>City</Text>
            <TextInput value={cityDraft} onChangeText={setCityDraft} placeholder="City" placeholderTextColor={C.mutedLight} style={{ borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 15, color: C.text, marginBottom: 12 }} />
            <Text style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>Hometown</Text>
            <TextInput value={hometownDraft} onChangeText={setHometownDraft} placeholder="Hometown" placeholderTextColor={C.mutedLight} style={{ borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 15, color: C.text }} />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 }}>
              <Pressable onPress={() => setBioModal(false)} style={{ paddingVertical: 10, paddingHorizontal: 16 }}>
                <Text style={{ fontSize: 15, color: C.muted }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => { void saveFields({ city: cityDraft.trim(), hometown: hometownDraft.trim() }); setBioModal(false); }}
                style={{ paddingVertical: 10, paddingHorizontal: 16 }}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: C.blue }}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Motto editor: tagline = profile bio */}
      <Modal visible={mottoModal} transparent animationType="fade" onRequestClose={() => setMottoModal(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 }} onPress={() => setMottoModal(false)}>
          <Pressable style={{ width: '100%', backgroundColor: C.card, borderRadius: 16, padding: 20 }} onPress={() => {}}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: C.text, marginBottom: 12 }}>Motto</Text>
            <TextInput value={mottoDraft} onChangeText={setMottoDraft} placeholder="Your tagline" placeholderTextColor={C.mutedLight} multiline style={{ borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 15, color: C.text, minHeight: 80, textAlignVertical: 'top' }} />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 }}>
              <Pressable onPress={() => setMottoModal(false)} style={{ paddingVertical: 10, paddingHorizontal: 16 }}>
                <Text style={{ fontSize: 15, color: C.muted }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => { void saveFields({ bio: mottoDraft.trim() }); setMottoModal(false); }}
                style={{ paddingVertical: 10, paddingHorizontal: 16 }}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: C.blue }}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Birthday editor: YYYY-MM-DD, age preview calculated live */}
      <Modal visible={birthdayModal} transparent animationType="fade" onRequestClose={() => setBirthdayModal(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 }} onPress={() => setBirthdayModal(false)}>
          <Pressable style={{ width: '100%', backgroundColor: C.card, borderRadius: 16, padding: 20 }} onPress={() => {}}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: C.text, marginBottom: 12 }}>Birthday</Text>
            <TextInput value={birthdayDraft} onChangeText={setBirthdayDraft} placeholder="YYYY-MM-DD" placeholderTextColor={C.mutedLight} keyboardType="numbers-and-punctuation" style={{ borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 15, color: C.text }} />
            <Text style={{ fontSize: 13, color: C.muted, marginTop: 8 }}>
              {validBirthday(birthdayDraft)
                ? `Age shown on your profile: ${calcAge(birthdayDraft.trim())}`
                : 'Enter a valid past date (YYYY-MM-DD). Your age is calculated from it.'}
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 }}>
              <Pressable onPress={() => setBirthdayModal(false)} style={{ paddingVertical: 10, paddingHorizontal: 16 }}>
                <Text style={{ fontSize: 15, color: C.muted }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (!validBirthday(birthdayDraft)) {
                    Alert.alert('Invalid date', 'Please enter a valid past date as YYYY-MM-DD.');
                    return;
                  }
                  void saveFields({ birthday: birthdayDraft.trim() });
                  setBirthdayModal(false);
                }}
                style={{ paddingVertical: 10, paddingHorizontal: 16 }}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: C.blue }}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
