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
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { subscribeUser, updateUser, VeeUser } from '@/src/services/userService';
import {
  subscribeFrames,
  formatObtainedDate,
  formatValidity,
  type GrantedFrame,
} from '@/src/services/badgeService';
import { getErrorCause } from '@/src/utils/errorDisplay';
import * as Haptics from 'expo-haptics';
// 2026-10-11 Issue #7: Nobel content renders INLINE in this tab — no extra
// click to another screen.
import NobelScreen from '@/src/features/nobel/NobelScreen';

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

// (2026-10-11 Issue #7: Nobel ranks now render inline via NobelScreen;
// the static NOBEL_RANKS list was removed.)

import AnimatedFrame from '@/src/components/AnimatedFrame';

function FrameIcon({ icon, frameId, frameName }: { icon: string; frameId?: string; frameName?: string }) {
  // 2026-10-13 (Sumon): Official frames show the live AnimatedFrame preview
  const isOfficial = (frameId || '').toLowerCase().includes('official') ||
    (frameName || '').toLowerCase().includes('official');
  if (isOfficial) {
    return (
      <View style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#E3F2FD' }} />
        <View style={{ position: 'absolute' }}>
          {/* 2026-10-14 (Sumon): frameId pass — server APNG preview */}
          <AnimatedFrame size={36} frameId={frameId} />
        </View>
      </View>
    );
  }
  if (/^https?:\/\//i.test(icon) && !/\.mp4$/i.test(icon)) {
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
  const { uid: paramUid } = useLocalSearchParams<{ uid?: string }>();
  const targetUid = paramUid ?? user?.uid;
  const isMe = !paramUid || paramUid === user?.uid;
  const [profile, setProfile] = useState<VeeUser | null>(null);
  const [frames, setFrames] = useState<GrantedFrame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // NOTE 9: "Nameplates" tab renamed to "Nobel". Nameplates themselves live
  // in the Honor page; this tab is informational until the Nobel screen ships.
  const [tab, setTab] = useState<'frames' | 'nobel'>('frames');

  useEffect(() => {
    if (!targetUid) {
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
    const unsubProfile = subscribeUser(targetUid, (u) => {
      profileDone = true;
      setProfile(u);
      maybeDone();
    });
    let unsubFrames: () => void = () => {};
    try {
      unsubFrames = subscribeFrames(targetUid, (f) => {
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
  }, [targetUid]);

  const handleEquip = async (id: string) => {
    if (!isMe || !user?.uid) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await updateUser(user.uid, { activeFrame: id });
    } catch (e) {
      setError(`Could not equip frame: ${getErrorCause(e)}`);
    }
  };

  // 2026-10-13 (Sumon): Remove frame — DP shows without frame.
  const handleRemove = async () => {
    if (!isMe || !user?.uid) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await updateUser(user.uid, { activeFrame: null as unknown as undefined });
    } catch (e) {
      setError(`Could not remove frame: ${getErrorCause(e)}`);
    }
  };

  const activeFrame = profile?.activeFrame;

  // P1-2 (2026-10-12): if the equipped frame expired (or was removed), clear
  // the pointer — an expired frame must be visible nowhere, including as the
  // equipped one. `frames` here is already expiry-filtered by subscribeFrames.
  useEffect(() => {
    if (!isMe || !user?.uid || !activeFrame) return;
    if (!frames.some((f) => f.id === activeFrame)) {
      // null deletes the field via Firebase update()
      updateUser(user.uid, { activeFrame: null as unknown as undefined }).catch(() => {});
    }
  }, [isMe, user?.uid, activeFrame, frames]);

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

      {/* Tabs: Frames | Nobel (NOTE 9: Nameplates renamed to Nobel).
          Nobel tab is OWNER-ONLY — visitors see only the Nobel name on the profile. */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginBottom: 12 }}>
        {(isMe ? (['frames', 'nobel'] as const) : (['frames'] as const)).map((t) => (
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
        // 2026-10-11 Issue #7: Nobel content inline — no "Open My Noble" button.
        <View style={{ flex: 1 }}>
          <NobelScreen embedded />
        </View>
      ) : frames.length > 0 ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        >
          {frames.map((frame) => {
            const isActive = activeFrame === frame.id;
            return (
              <View
                key={frame.id}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  backgroundColor: C.goldBg, borderRadius: 16, padding: 16, marginBottom: 12,
                  borderWidth: 1, borderColor: isActive ? C.blue : C.goldBorder,
                }}
              >
                <FrameIcon icon={frame.icon} frameId={frame.id} frameName={frame.name} />
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: C.text }}>
                    {frame.name}
                  </Text>
                  <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                    Obtained {formatObtainedDate(frame.obtainedAt)}
                    {frame.source === 'event' ? ' · Event reward' : ' · Official'}
                  </Text>
                  {/* P1-10 (2026-10-12): validity visible to the owner only,
                      mirroring honor.tsx — visitors see just the obtained date. */}
                  {isMe && (
                    <Text style={{ fontSize: 11, color: '#8A6D00', marginTop: 2, fontWeight: '700' }}>
                      {formatValidity(frame.validity)}
                    </Text>
                  )}
                </View>
                {isMe ? (
                  isActive ? (
                    <Pressable
                      style={{ backgroundColor: '#FDECEA', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 }}
                      onPress={handleRemove}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#B3261E' }}>Remove</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={{ backgroundColor: C.blueLight, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 }}
                      onPress={() => handleEquip(frame.id)}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '700', color: C.blue }}>Use</Text>
                    </Pressable>
                  )
                ) : isActive ? (
                  <View style={{ backgroundColor: C.blueLight, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: C.blue }}>Active</Text>
                  </View>
                ) : null}
              </View>
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
