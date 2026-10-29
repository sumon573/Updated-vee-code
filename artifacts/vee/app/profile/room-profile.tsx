// Room Profile page — 2026-10-29 (boss, imo mirror)
// Opened by the profile's bottom "Edit" button. Exact imo row order:
//   Edit Profile | Bio | Motto | Level | Gender | Birthday |
//   Country/Region | Background
//
// Birthday → age is CALCULATED and shown on the profile chip (never typed).
// Country/Region row: imo-exact picker (boss, 2026-10-29) — tap opens the
// "Choose a Country/Region" sheet; the chosen name is saved to `country`
// (the same field the profile country chip + room-card flag disc read).
// Names come from ./countries.ts and match index.tsx's COUNTRY_TO_CODE
// map verbatim where the map has an entry, so flags render.
// NOTE: city/hometown/birthday/gender/country/language/profession are NOT in the VeeUser type
// and sanitizeVeeUser drops them on read, so they are read raw here and
// written via updateUser (a plain update). Follow-up: add these fields to
// VeeUser + sanitize (userService change, separate order).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, FlatList, Image, Modal, Pressable, ScrollView, Text, TextInput, View,
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
import { COUNTRIES } from './countries';

const C = {
  bg: '#F4F5F5', card: '#FFFFFF', text: '#1A1A1A', muted: '#666666',
  mutedLight: '#999999', border: '#EEEEEE', tile: '#F0F0F0',
  blue: '#007AFF', blueLight: '#E6F2FF', green: '#34C759', red: '#FF3B30',
};

type ExtraFields = {
  city?: string; hometown?: string; birthday?: string; gender?: string; country?: string;
  language?: string; profession?: string;
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

// ── Birthday wheel column (imo-exact): one vertical FlatList acting as a
// scroll wheel. Items snap to WHEEL_ITEM_H so the settled offset is always
// an exact multiple of it; the centered item is the selected value (the
// light-grey band in the sheet sits behind the list at that position).
// Selection updates only on scroll END (drag end / momentum end) — never
// on every scroll frame — so scrolling stays native and jank-free.
const WHEEL_ITEM_H = 56;

function WheelColumn({ values, value, onValueChange, listRef }: {
  values: number[]; value: number; onValueChange: (v: number) => void;
  listRef: React.RefObject<FlatList<number> | null>;
}) {
  const selectedIndex = values.indexOf(value);
  const settle = (offsetY: number) => {
    const idx = Math.min(values.length - 1, Math.max(0, Math.round(offsetY / WHEEL_ITEM_H)));
    const v = values[idx];
    if (v !== value) onValueChange(v);
  };
  return (
    <View style={{ flex: 1, height: WHEEL_ITEM_H * 3 }}>
      <FlatList
        ref={listRef}
        data={values}
        keyExtractor={(v) => String(v)}
        getItemLayout={(_, index) => ({ length: WHEEL_ITEM_H, offset: WHEEL_ITEM_H + index * WHEEL_ITEM_H, index })}
        snapToInterval={WHEEL_ITEM_H}
        snapToAlignment="start"
        decelerationRate="fast"
        bounces={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: WHEEL_ITEM_H, paddingBottom: WHEEL_ITEM_H }}
        onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.y)}
        onScrollEndDrag={(e) => settle(e.nativeEvent.contentOffset.y)}
        renderItem={({ item, index }) => {
          const selected = index === selectedIndex;
          return (
            <View style={{ height: WHEEL_ITEM_H, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: selected ? 20 : 17, fontWeight: selected ? '600' : '400', color: selected ? C.text : '#BBBBBB' }}>
                {item}
              </Text>
            </View>
          );
        }}
      />
    </View>
  );
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
  const [languageDraft, setLanguageDraft] = useState('');
  const [professionDraft, setProfessionDraft] = useState('');
  const [mottoModal, setMottoModal] = useState(false);
  const [mottoDraft, setMottoDraft] = useState('');
  const [birthdayModal, setBirthdayModal] = useState(false);
  const [birthdayYear, setBirthdayYear] = useState(2000);
  const [birthdayMonth, setBirthdayMonth] = useState(1);
  const [birthdayDay, setBirthdayDay] = useState(1);
  const yearListRef = useRef<FlatList<number> | null>(null);
  const monthListRef = useRef<FlatList<number> | null>(null);
  const dayListRef = useRef<FlatList<number> | null>(null);
  const birthdayTargetRef = useRef({ y: 2000, m: 1, d: 1 });
  const [countryPicker, setCountryPicker] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [countryDraft, setCountryDraft] = useState<string | null>(null);
  const [genderPicker, setGenderPicker] = useState(false);
  const [genderDraft, setGenderDraft] = useState<string | null>(null);

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
            language: pick('language'), profession: pick('profession'),
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

  // ── 2026-10-29 (boss, cover viewer): Background row mirrors the profile
  // cover tap — show the cover full-screen FIRST (same viewer + same
  // Change pill); Change opens the change flow. No cover set -> the tap
  // goes directly to the change flow.
  const handleBackgroundTap = useCallback(() => {
    if (profile?.coverImageUrl) {
      router.push({ pathname: '/profile/dp-viewer', params: { kind: 'cover' } } as never);
    } else {
      void handleChangeCover();
    }
  }, [profile?.coverImageUrl, handleChangeCover]);

  // Gender picker: imo-exact bottom sheet (replaces the old native Alert
  // selector). The sheet opens with the current gender pre-selected;
  // the blue confirm button saves via the existing saveFields path.
  const openGenderPicker = useCallback(() => {
    if (!isMe) return;
    setGenderDraft(extra.gender ?? null);
    setGenderPicker(true);
  }, [isMe, extra.gender]);

  const openCountryPicker = useCallback(() => {
    if (!isMe) return;
    setCountryDraft(extra.country ?? null);
    setCountrySearch('');
    setCountryPicker(true);
  }, [isMe, extra.country]);

  // ── Birthday wheel picker (boss, imo-exact): Year | Month | Day wheels.
  // Day count follows the selected month/year (leap years handled by Date);
  // the day clamps when month/year changes. The row display stays
  // "YYYY-MM-DD"; the sheet has no age preview (imo-exact). Years run
  // 1900 through the current year (computed at render, so the top year
  // is always the current one).
  const daysInMonth = (y: number, m: number): number => new Date(y, m, 0).getDate();
  const currentYear = new Date().getFullYear();
  const wheelYears = Array.from({ length: currentYear - 1900 + 1 }, (_, i) => 1900 + i);
  const wheelMonths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const wheelDays = Array.from({ length: daysInMonth(birthdayYear, birthdayMonth) }, (_, i) => i + 1);

  const scrollWheelTo = (ref: React.RefObject<FlatList<number> | null>, index: number) => {
    ref.current?.scrollToOffset({ offset: index * WHEEL_ITEM_H, animated: false });
  };

  const scrollWheelsToTarget = () => {
    const t = birthdayTargetRef.current;
    scrollWheelTo(yearListRef, wheelYears.indexOf(t.y));
    scrollWheelTo(monthListRef, t.m - 1);
    scrollWheelTo(dayListRef, t.d - 1);
  };

  const openBirthdayPicker = useCallback(() => {
    if (!isMe) return;
    // Parse the stored birthday; fall back to 2000-01-01 when none is set
    // or the stored value is invalid (wheels always need a position).
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((extra.birthday ?? '').trim());
    let y = 2000; let mo = 1; let d = 1;
    if (m) {
      const yy = Number(m[1]); const mm = Number(m[2]); const dd = Number(m[3]);
      const dt = new Date(yy, mm - 1, dd);
      if (dt.getFullYear() === yy && dt.getMonth() === mm - 1 && dt.getDate() === dd && dt.getTime() <= Date.now()) {
        y = yy; mo = mm; d = dd;
      }
    }
    birthdayTargetRef.current = { y, m: mo, d };
    setBirthdayYear(y); setBirthdayMonth(mo); setBirthdayDay(d);
    setBirthdayModal(true);
    // Visual scroll position only — the saved value always comes from state,
    // so a scroll race can never corrupt the date. The timeout scrolls
    // during the slide-in; onShow re-scrolls after presentation as backup.
    setTimeout(scrollWheelsToTarget, 100);
  }, [isMe, extra.birthday]);

  const displayName = profile?.name ?? 'User';
  const photoURL = profile?.photoURL ?? null;
  const bio = profile?.bio ?? '';
  const totalLevel = levelInfo?.totalLevel ?? 1;
  const genderSym = genderSymbol(extra.gender);
  const age = calcAge(extra.birthday);
  const cityLines = [extra.city, extra.hometown, extra.language, extra.profession].filter((x): x is string => !!x);
  const countryQuery = countrySearch.trim().toLowerCase();
  const filteredCountries = countryQuery
    ? COUNTRIES.filter((n) => n.toLowerCase().includes(countryQuery))
    : COUNTRIES;

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
            onPress={isMe ? () => { setCityDraft(extra.city ?? ''); setHometownDraft(extra.hometown ?? ''); setLanguageDraft(extra.language ?? ''); setProfessionDraft(extra.profession ?? ''); setBioModal(true); } : undefined}
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
              <LevelBadge level={totalLevel} />
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
            onPress={isMe ? openBirthdayPicker : undefined}
          />
          <Divider />

          {/* Country/Region: tap opens the imo-exact picker sheet. */}
          <Row
            label="Country/Region"
            value={extra.country ?? ''}
            onPress={isMe ? openCountryPicker : undefined}
          />
          <Divider />

          <Row
            label="Background"
            onPress={isMe ? handleBackgroundTap : undefined}
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

      </ScrollView>

      {/* Bio editor: current city + hometown + language + profession */}
      <Modal visible={bioModal} transparent animationType="fade" onRequestClose={() => setBioModal(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 }} onPress={() => setBioModal(false)}>
          <Pressable style={{ width: '100%', backgroundColor: C.card, borderRadius: 16, padding: 20 }} onPress={() => {}}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: C.text, marginBottom: 12 }}>Bio</Text>
            <Text style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>Current City</Text>
            <TextInput value={cityDraft} onChangeText={setCityDraft} placeholder="Current City" placeholderTextColor={C.mutedLight} style={{ borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 15, color: C.text, marginBottom: 12 }} />
            <Text style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>Hometown</Text>
            <TextInput value={hometownDraft} onChangeText={setHometownDraft} placeholder="Hometown" placeholderTextColor={C.mutedLight} style={{ borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 15, color: C.text, marginBottom: 12 }} />
            <Text style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>Language</Text>
            <TextInput value={languageDraft} onChangeText={setLanguageDraft} placeholder="Language" placeholderTextColor={C.mutedLight} style={{ borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 15, color: C.text, marginBottom: 12 }} />
            <Text style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>Profession</Text>
            <TextInput value={professionDraft} onChangeText={setProfessionDraft} placeholder="Profession" placeholderTextColor={C.mutedLight} style={{ borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 15, color: C.text }} />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 }}>
              <Pressable onPress={() => setBioModal(false)} style={{ paddingVertical: 10, paddingHorizontal: 16 }}>
                <Text style={{ fontSize: 15, color: C.muted }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => { void saveFields({ city: cityDraft.trim(), hometown: hometownDraft.trim(), language: languageDraft.trim(), profession: professionDraft.trim() }); setBioModal(false); }}
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

      {/* Birthday picker: imo-exact wheel sheet — Year | Month | Day wheels
          with a light-grey selected band + blue confirm button. No age
          preview inside the sheet (imo-exact); age shows on the profile
          chips row after save. The old YYYY-MM-DD text modal is fully
          replaced — no second path remains. */}
      <Modal visible={birthdayModal} transparent animationType="slide" onRequestClose={() => setBirthdayModal(false)} onShow={scrollWheelsToTarget}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.4)' }}
            onPress={() => setBirthdayModal(false)}
          />
          <View style={{ backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden', paddingTop: 20, paddingHorizontal: 16, paddingBottom: 16 }}>
            <View style={{ position: 'relative' }}>
              <View style={{ position: 'absolute', top: WHEEL_ITEM_H, left: 0, right: 0, height: WHEEL_ITEM_H, backgroundColor: C.tile }} pointerEvents="none" />
              <View style={{ flexDirection: 'row' }}>
                <WheelColumn
                  values={wheelYears}
                  value={birthdayYear}
                  listRef={yearListRef}
                  onValueChange={(y) => {
                    setBirthdayYear(y);
                    const max = daysInMonth(y, birthdayMonth);
                    if (birthdayDay > max) {
                      setBirthdayDay(max);
                      setTimeout(() => scrollWheelTo(dayListRef, max - 1), 50);
                    }
                  }}
                />
                <WheelColumn
                  values={wheelMonths}
                  value={birthdayMonth}
                  listRef={monthListRef}
                  onValueChange={(mo) => {
                    setBirthdayMonth(mo);
                    const max = daysInMonth(birthdayYear, mo);
                    if (birthdayDay > max) {
                      setBirthdayDay(max);
                      setTimeout(() => scrollWheelTo(dayListRef, max - 1), 50);
                    }
                  }}
                />
                <WheelColumn
                  values={wheelDays}
                  value={birthdayDay}
                  listRef={dayListRef}
                  onValueChange={setBirthdayDay}
                />
              </View>
            </View>
            <View style={{ marginTop: 16 }}>
              <Pressable
                onPress={() => {
                  const pad = (n: number) => String(n).padStart(2, '0');
                  const dt = new Date(birthdayYear, birthdayMonth - 1, birthdayDay);
                  if (dt.getTime() > Date.now()) {
                    Alert.alert('Invalid date', 'Please choose a past date.');
                    return;
                  }
                  void saveFields({ birthday: `${birthdayYear}-${pad(birthdayMonth)}-${pad(birthdayDay)}` });
                  setBirthdayModal(false);
                }}
                style={{ height: 52, borderRadius: 12, backgroundColor: '#0098F8', alignItems: 'center', justifyContent: 'center' }}
              >
                <Feather name="check" size={24} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Country picker: imo-exact sheet — title + Search + alphabetical
          list (FlatList, smooth native scroll) + blue confirm button.
          Selection starts at the current country; ✓ saves + closes;
          backdrop/back closes WITHOUT saving. */}
      <Modal visible={countryPicker} transparent animationType="slide" onRequestClose={() => setCountryPicker(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.4)' }}
            onPress={() => setCountryPicker(false)}
          />
          <View style={{ height: '86%', backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' }}>
            <View style={{ alignItems: 'center', paddingTop: 10 }}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#DDDDDD' }} />
            </View>
            <Text style={{ fontSize: 21, fontWeight: '700', color: C.text, paddingHorizontal: 16, marginTop: 12, marginBottom: 16 }}>
              Choose a Country/Region
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F8F8', borderRadius: 12, marginHorizontal: 16, paddingHorizontal: 12, height: 46, marginBottom: 8 }}>
              <Feather name="search" size={19} color={C.mutedLight} />
              <TextInput
                value={countrySearch}
                onChangeText={setCountrySearch}
                placeholder="Search"
                placeholderTextColor={C.mutedLight}
                autoCorrect={false}
                style={{ flex: 1, marginLeft: 8, fontSize: 16, color: C.text }}
              />
            </View>
            <FlatList
              data={filteredCountries}
              keyExtractor={(name) => name}
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const selected = countryDraft === item;
                return (
                  <Pressable onPress={() => setCountryDraft(item)}>
                    <View style={{ paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: selected ? C.blueLight : 'transparent' }}>
                      <Text style={{ fontSize: 17, color: selected ? C.blue : C.text }}>{item}</Text>
                      {selected && <Feather name="check" size={19} color={C.blue} />}
                    </View>
                    <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 16 }} />
                  </Pressable>
                );
              }}
            />
            <View style={{ padding: 16, paddingTop: 8 }}>
              <Pressable
                onPress={() => {
                  if (countryDraft && countryDraft !== extra.country) void saveFields({ country: countryDraft });
                  setCountryPicker(false);
                }}
                style={{ height: 52, borderRadius: 12, backgroundColor: '#0098F8', alignItems: 'center', justifyContent: 'center' }}
              >
                <Feather name="check" size={24} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Gender picker: imo-exact sheet — small grey title + Male /
          Female / Other rows (blue check on the selected row only, no
          row highlight, per the screenshot) + blue confirm button.
          Row tap moves the selection; the blue check saves via the
          existing gender save path and closes; backdrop/back closes
          WITHOUT saving. The old Alert selector is fully replaced —
          no second path remains. */}
      <Modal visible={genderPicker} transparent animationType="slide" onRequestClose={() => setGenderPicker(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.4)' }}
            onPress={() => setGenderPicker(false)}
          />
          <View style={{ backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden', paddingTop: 20, paddingHorizontal: 16, paddingBottom: 16 }}>
            <Text style={{ fontSize: 15, color: C.muted, marginBottom: 8 }}>Gender</Text>
            {(['Male', 'Female', 'Other'] as const).map((g, i) => {
              const selected = genderDraft === g;
              return (
                <Pressable key={g} onPress={() => setGenderDraft(g)}>
                  <View style={{ paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 17, color: C.text }}>{g}</Text>
                    {selected && <Feather name="check" size={19} color={C.blue} />}
                  </View>
                  {i < 2 && <View style={{ height: 0.5, backgroundColor: C.border }} />}
                </Pressable>
              );
            })}
            <View style={{ marginTop: 16 }}>
              <Pressable
                onPress={() => {
                  if (genderDraft && genderDraft !== extra.gender) void saveFields({ gender: genderDraft });
                  setGenderPicker(false);
                }}
                style={{ height: 52, borderRadius: 12, backgroundColor: '#0098F8', alignItems: 'center', justifyContent: 'center' }}
              >
                <Feather name="check" size={24} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
