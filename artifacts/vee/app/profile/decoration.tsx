/**
 * Profile — Decoration Screen (NOTE 9, 2026-10-11).
 *
 * Tabs: "Frames" | "Nobel"
 * - Frames: real granted frames ONLY — officially granted (by admin) or
 *   claimed from special events (users/{uid}/frames in Firebase). NO demo
 *   frames. Empty state until any exist. Tap an owned frame to equip it.
 * - Nobel: links to the real Nobel screen (/nobel) — Nobel ranks are earned
 *   by sending diamonds as gifts in voice rooms (NOTE 10).
 *
 * Light mode only. All data is real — no demo content.
 */
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { subscribeUser, updateUser, VeeUser } from '@/src/services/userService';
import {
  subscribeFrames,
  formatObtainedDate,
  type GrantedFrame,
} from '@/src/services/badgeService';
import { getErrorCause } from '@/src/utils/errorDisplay';
import * as Haptics from 'expo-haptics';

const C = {
  bg: '#FFFFFF',
  card: '#F2F2F7',
  text: '#000000',
  muted: '#8E8E93',
  border: '#E5E5EA',
  blue: '#007AFF',
  blueLight: '#E3F2FF',
  goldBg: '#FFF8E6',
  goldBorder: '#F5D67B',
  errorBg: '#FDECEA',
  errorText: '#B3261E',
} as const;

// Nobel rank ladder (product spec — informational only, no user data here).
const NOBEL_RANKS = [
  'Knight', 'Baron', 'Viscount', 'Count', 'Marquis',
  'Duke', 'Royal Duke', 'King', 'SKing', 'SSKing',
];

function FrameIcon({ icon }: { icon: string }) {
  if (/^https?:\/\//i.test(icon)) {
    return (
      <Image
        source={{ uri: icon }}
        style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.card }}
        resizeMode="cover"
      />
    );
  }
  return <Text style={{ fontSize: 40 }}>{icon}</Text>;
}

export default function DecorationScreen() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<VeeUser | null>(null);
  const [frames, setFrames] = useState<GrantedFrame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // NOTE 9: "Nameplates" tab renamed to "Nobel". Nameplates themselves live
  // in the Honor page; this tab is informational until the Nobel screen ships.
  const [tab, setTab] = useState<'frames' | 'nobel'>('frames');

  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    let profileDone = false;
    let framesDone = false;
    const maybeDone = () => {
      if (profileDone && framesDone) setLoading(false);
    };
    const unsubProfile = subscribeUser(user.uid, (u) => {
      profileDone = true;
      setProfile(u);
      maybeDone();
    });
    let unsubFrames: () => void = () => {};
    try {
      unsubFrames = subscribeFrames(user.uid, (f) => {
        framesDone = true;
        setFrames(f);
        maybeDone();
      });
    } catch (e) {
      setError(`Could not load frames: ${getErrorCause(e)}`);
      framesDone = true;
      maybeDone();
    }
    const timeout = setTimeout(() => setLoading(false), 8000);
    return () => {
      clearTimeout(timeout);
      unsubProfile();
      unsubFrames();
    };
  }, [user?.uid]);

  const handleEquip = async (id: string) => {
    if (!user?.uid) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await updateUser(user.uid, { activeFrame: id });
    } catch (e) {
      setError(`Could not equip frame: ${getErrorCause(e)}`);
    }
  };

  const activeFrame = profile?.activeFrame;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 }}>
        <Pressable onPress={() => router.back()} style={{ padding: 8 }} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={C.text} />
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: '800', color: C.text, marginLeft: 4 }}>
          Decoration
        </Text>
      </View>

      {/* Tabs: Frames | Nobel (NOTE 9: Nameplates renamed to Nobel) */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginBottom: 12 }}>
        {(['frames', 'nobel'] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={{
              flex: 1, paddingVertical: 10, alignItems: 'center',
              borderBottomWidth: 2,
              borderBottomColor: tab === t ? C.text : 'transparent',
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: tab === t ? '800' : '500', color: tab === t ? C.text : C.muted }}>
              {t === 'frames' ? 'Frames' : 'Nobel'}
            </Text>
          </Pressable>
        ))}
      </View>

      {error && (
        <View style={{ backgroundColor: C.errorBg, paddingHorizontal: 16, paddingVertical: 10, marginHorizontal: 16, borderRadius: 10, marginBottom: 8 }}>
          <Text style={{ fontSize: 12, color: C.errorText }}>{error}</Text>
        </View>
      )}

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.blue} size="large" />
        </View>
      ) : tab === 'nobel' ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
          <View style={{ backgroundColor: C.goldBg, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: C.goldBorder }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ fontSize: 28, marginRight: 10 }}>👑</Text>
              <Text style={{ fontSize: 17, fontWeight: '800', color: C.text }}>Nobel</Text>
            </View>
            <Text style={{ fontSize: 14, color: C.text, lineHeight: 21 }}>
              Nobel ranks are earned by sending diamonds as gifts in voice rooms.
            </Text>
            <Text style={{ fontSize: 13, color: C.muted, lineHeight: 20, marginTop: 12 }}>
              {NOBEL_RANKS.join('  →  ')}
            </Text>
            {/* NOTE 10: the real Nobel screen now exists — deep-link to it. */}
            <Pressable
              onPress={() => router.push('/nobel')}
              style={{
                marginTop: 16, backgroundColor: C.blue, borderRadius: 14,
                paddingVertical: 13, alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '800', color: '#fff' }}>
                Open My Noble 👑
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : frames.length > 0 ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        >
          {frames.map((frame) => {
            const isActive = activeFrame === frame.id;
            return (
              <Pressable
                key={frame.id}
                onPress={() => handleEquip(frame.id)}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  backgroundColor: C.goldBg, borderRadius: 16, padding: 16, marginBottom: 12,
                  borderWidth: 1, borderColor: isActive ? C.blue : C.goldBorder,
                }}
              >
                <FrameIcon icon={frame.icon} />
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: C.text }}>
                    {frame.name}
                  </Text>
                  <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                    Obtained {formatObtainedDate(frame.obtainedAt)}
                    {frame.source === 'event' ? ' · Event reward' : ' · Official'}
                  </Text>
                </View>
                {isActive ? (
                  <View style={{ backgroundColor: C.blueLight, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: C.blue }}>Active</Text>
                  </View>
                ) : (
                  <Text style={{ fontSize: 13, fontWeight: '600', color: C.blue }}>Tap to equip</Text>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', paddingTop: 72, paddingHorizontal: 48 }}>
          <Text style={{ fontSize: 44, marginBottom: 12 }}>🖼️</Text>
          <Text style={{ fontSize: 15, fontWeight: '700', color: C.text, textAlign: 'center' }}>
            No frames yet
          </Text>
          <Text style={{ fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
            Frames are granted officially or claimed as event rewards.
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}
