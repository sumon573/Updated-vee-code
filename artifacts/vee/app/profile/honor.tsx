/**
 * Profile — Honor Detail Screen (imo style)
 *
 * Tabs: "Badge N" (N = earned count) | "Nameplate"
 * - Badge tab: full achievement catalog. Earned badges in full color,
 *   locked badges greyed out with their unlock requirement. Nothing is
 *   ever shown as earned unless the activity genuinely unlocked it.
 * - Nameplate tab: owned nameplates (real data) in color, locked ones
 *   greyed with requirements.
 *
 * Light mode only. All data is real — no demo content.
 */

import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { subscribeUser, VeeUser } from '@/src/services/userService';
import { subscribeFollowCounts } from '@/src/services/followService';
import { subscribeMyRoomsCombined } from '@/src/features/voice-room/services/firebaseRoomService';
import { subscribeTransactionHistory } from '@/src/features/wallet/walletService';
import {
  ACHIEVEMENTS, NAMEPLATES, HonorStats, evaluateAchievements,
} from '@/src/data/honor';

const C = {
  bg: '#FFFFFF',
  card: '#F2F2F7',
  text: '#000000',
  muted: '#8E8E93',
  mutedDim: '#C7C7CC',
  border: '#E5E5EA',
  primary: '#7C3AED',
  glow: '#8B5CF6',
  gold: '#F5A623',
  lockedBg: '#F2F2F7',
} as const;

function calcLevel(followers: number, rooms: number, gifts: number, following: number): number {
  const xp = followers * 10 + rooms * 20 + gifts * 5 + following * 2;
  if (xp < 100) return 1;
  if (xp < 250) return 2;
  if (xp < 500) return 3;
  if (xp < 1000) return 4;
  return Math.min(99, 5 + Math.floor((xp - 1000) / 1000));
}

export default function HonorScreen() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<VeeUser | null>(null);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [rooms, setRooms] = useState<any[]>([]);
  const [totalGifts, setTotalGifts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'badge' | 'nameplate'>('badge');

  useEffect(() => {
    if (!user?.uid) { setLoading(false); return; }
    const unsub = subscribeUser(user.uid, (u) => { setProfile(u); setLoading(false); });
    const timeout = setTimeout(() => setLoading(false), 3000);
    return () => { clearTimeout(timeout); unsub(); };
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    return subscribeFollowCounts(user.uid, setFollowCounts);
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    return subscribeMyRoomsCombined(user.uid, setRooms);
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    return subscribeTransactionHistory(user.uid, (txs) => {
      let n = 0;
      for (const tx of txs) if (tx.type === 'gift_received') n += 1;
      setTotalGifts(n);
    });
  }, [user?.uid]);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={C.glow} />
      </SafeAreaView>
    );
  }

  const stats: HonorStats = {
    roomsHosted: rooms.length,
    totalGifts,
    followers: followCounts.followers,
    following: followCounts.following,
    level: calcLevel(followCounts.followers, rooms.length, totalGifts, followCounts.following),
  };
  const { earned, locked } = evaluateAchievements(stats);
  const ownedNameplates: string[] = profile?.ownedNameplates || [];
  const activeNameplate: string | undefined = (profile as any)?.activeNameplate;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 12, paddingVertical: 10,
        borderBottomWidth: 1, borderBottomColor: C.border,
      }}>
        <Pressable onPress={() => router.back()} style={{ padding: 8 }}>
          <Feather name="chevron-left" size={24} color={C.text} />
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: '800', color: C.text, marginLeft: 4 }}>
          Honor
        </Text>
      </View>

      {/* Tabs (imo style: Nameplate | Badge N) */}
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border }}>
        {(['nameplate', 'badge'] as const).map((t) => {
          const active = tab === t;
          const label = t === 'badge' ? `Badge ${earned.length}` : 'Nameplate';
          return (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={{ flex: 1, alignItems: 'center', paddingVertical: 12 }}
            >
              <Text style={{
                fontSize: 15, fontWeight: active ? '800' : '500',
                color: active ? C.text : C.muted,
              }}>
                {label}
              </Text>
              <View style={{
                height: 3, width: 32, borderRadius: 2, marginTop: 6,
                backgroundColor: active ? C.gold : 'transparent',
              }} />
            </Pressable>
          );
        })}
      </View>

      {tab === 'badge' ? (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          <Text style={{
            fontSize: 13, fontWeight: '700', color: C.muted,
            paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
          }}>
            Achievement
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingBottom: 24 }}>
            {/* Earned first, in full color */}
            {earned.map((a) => (
              <View key={a.id} style={{ width: '25%', padding: 6, alignItems: 'center' }}>
                <View style={{
                  width: '100%', aspectRatio: 1, borderRadius: 16,
                  backgroundColor: '#FFF8E6', borderWidth: 1, borderColor: '#F5D67B',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ fontSize: 34 }}>{a.icon}</Text>
                </View>
                <Text style={{ fontSize: 11, fontWeight: '700', color: C.text, marginTop: 5, textAlign: 'center' }}>
                  {a.label}
                </Text>
              </View>
            ))}
            {/* Locked: greyed with requirement */}
            {locked.map((a) => (
              <View key={a.id} style={{ width: '25%', padding: 6, alignItems: 'center' }}>
                <View style={{
                  width: '100%', aspectRatio: 1, borderRadius: 16,
                  backgroundColor: C.lockedBg, borderWidth: 1, borderColor: C.border,
                  alignItems: 'center', justifyContent: 'center', opacity: 0.75,
                }}>
                  <Text style={{ fontSize: 30, opacity: 0.45 }}>{a.icon}</Text>
                  <Feather name="lock" size={12} color={C.mutedDim}
                    style={{ position: 'absolute', bottom: 6, right: 6 }} />
                </View>
                <Text style={{ fontSize: 11, fontWeight: '600', color: C.muted, marginTop: 5, textAlign: 'center' }}>
                  {a.label}
                </Text>
                <Text style={{ fontSize: 9, color: C.mutedDim, textAlign: 'center', marginTop: 1 }}>
                  {a.requirement}
                </Text>
              </View>
            ))}
          </View>
          {earned.length === 0 && (
            <Text style={{
              textAlign: 'center', color: C.muted, fontSize: 13,
              paddingHorizontal: 40, marginTop: 8,
            }}>
              No badges earned yet — complete the requirements above to unlock them.
            </Text>
          )}
        </ScrollView>
      ) : (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          <Text style={{
            fontSize: 13, fontWeight: '700', color: C.muted,
            paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
          }}>
            Nameplate
          </Text>
          <View style={{ paddingHorizontal: 16, paddingBottom: 24, gap: 10 }}>
            {NAMEPLATES.map((n) => {
              const owned = ownedNameplates.includes(n.id);
              const isActive = activeNameplate === n.id;
              return (
                <View
                  key={n.id}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    backgroundColor: owned ? '#FFF8E6' : C.lockedBg,
                    borderWidth: 1, borderColor: owned ? '#F5D67B' : C.border,
                    borderRadius: 14, padding: 12, opacity: owned ? 1 : 0.75,
                  }}
                >
                  <Text style={{ fontSize: 30, opacity: owned ? 1 : 0.45 }}>{n.icon}</Text>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: owned ? C.text : C.muted }}>
                      {n.name}
                    </Text>
                    <Text style={{ fontSize: 11, color: C.mutedDim, marginTop: 2 }}>
                      {owned ? (isActive ? 'Equipped' : 'Owned') : n.requirement}
                    </Text>
                  </View>
                  {!owned && <Feather name="lock" size={16} color={C.mutedDim} />}
                  {isActive && <Feather name="check-circle" size={18} color={C.glow} />}
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
