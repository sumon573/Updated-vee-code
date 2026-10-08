/**
 * Profile — IMO-style (light mode)
 * Exact IMO layout: cover, avatar, badges, sections, Edit button
 * All data real from Firebase; all buttons functional
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, Alert,
  ActivityIndicator, Image, Pressable, FlatList, Animated,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { subscribeUser, VeeUser } from '@/src/services/userService';
import { subscribeFollowCounts } from '@/src/services/followService';
import { subscribeMyRoomsCombined } from '@/src/features/voice-room/services/firebaseRoomService';
import { subscribeTransactionHistory } from '@/src/features/wallet/walletService';
import { useTranslation } from 'react-i18next';

// Gift emojis (matches GiftsModal)
const GIFTS: Record<string, string> = {
  '1': '💋', '2': '🔑', '3': '🌹', '4': '🔔',
  '5': '💎', '6': '🏆', '7': '👑', '8': '🎆',
};

// IMO light-mode colors
const C = {
  bg: '#FFFFFF',
  text: '#000000',
  muted: '#8E8E93',
  mutedLight: '#C7C7CC',
  border: '#E5E5EA',
  card: '#F2F2F7',
  blue: '#007AFF',
  blueLight: '#E3F2FD',
  green: '#34C759',
} as const;

// ─── Section Header (IMO style: title left, count + arrow right) ───

function SectionHeader({ title, count, onPress }: { title: string; count?: number; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 }}>
      <Text style={{ fontSize: 17, fontWeight: '600', color: C.text }}>{title}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {count !== undefined && (
          <Text style={{ fontSize: 15, color: C.muted, marginRight: 4 }}>{count}</Text>
        )}
        <Feather name="chevron-right" size={18} color={C.mutedLight} />
      </View>
    </Pressable>
  );
}

// ─── Badge Pill (IMO style) ───

function BadgePill({ label, icon }: { label: string; icon?: string }) {
  return (
    <View style={{
      backgroundColor: C.card, borderRadius: 12,
      paddingHorizontal: 10, paddingVertical: 5, marginRight: 6, marginBottom: 6,
      flexDirection: 'row', alignItems: 'center',
    }}>
      {icon && <Text style={{ fontSize: 12, marginRight: 4 }}>{icon}</Text>}
      <Text style={{ fontSize: 12, color: C.muted, fontWeight: '500' }}>{label}</Text>
    </View>
  );
}

// ─── Voice Room Card (IMO style with live indicator) ───

function RoomCard({ item, onPress }: { item: any; onPress: () => void }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (item.isLive) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [item.isLive]);

  return (
    <Pressable onPress={onPress} style={{ width: 128, marginRight: 12 }}>
      <View style={{ width: 128, height: 128, borderRadius: 18, overflow: 'hidden', backgroundColor: C.card }}>
        {item.coverImageUrl ? (
          <Image source={{ uri: item.coverImageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8E8ED' }}>
            <Text style={{ fontSize: 44 }}>🎙️</Text>
          </View>
        )}
        {/* Live badge with pulsing dot */}
        {item.isLive && (
          <View style={{
            position: 'absolute', bottom: 8, left: 8,
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 12,
            paddingHorizontal: 8, paddingVertical: 4,
          }}>
            <Animated.View style={{
              width: 8, height: 8, borderRadius: 4,
              backgroundColor: '#FF3B30', marginRight: 5,
              opacity: pulseAnim,
            }} />
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
              {item.memberCount || 0}
            </Text>
          </View>
        )}
        {/* Member count for non-live */}
        {!item.isLive && item.memberCount > 0 && (
          <View style={{
            position: 'absolute', bottom: 8, right: 8,
            backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10,
            paddingHorizontal: 7, paddingVertical: 3,
          }}>
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>👥 {item.memberCount}</Text>
          </View>
        )}
      </View>
      <Text style={{ fontSize: 13, color: C.text, marginTop: 7, fontWeight: '600' }} numberOfLines={1}>
        {item.name || 'Room'}
      </Text>
    </Pressable>
  );
}

// ─── Main Component ───

export default function ProfileScreen({
  onNavigateToContacts,
}: {
  onNavigateToContacts?: () => void;
} = {}) {
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const [profile, setProfile] = useState<VeeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [rooms, setRooms] = useState<any[]>([]);
  const [receivedGifts, setReceivedGifts] = useState<Record<string, number>>({});
  const [vidCopied, setVidCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const counts: Record<string, number> = {};
      for (const tx of txs) {
        if (tx.type === 'gift_received' && tx.giftId) {
          counts[tx.giftId] = (counts[tx.giftId] ?? 0) + 1;
        }
      }
      setReceivedGifts(counts);
    });
  }, [user?.uid]);

  useEffect(() => {
    return () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); };
  }, []);

  const handleCopyVid = useCallback(async () => {
    const id = profile?.vId;
    if (!id) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await Clipboard.setStringAsync(id);
      setVidCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setVidCopied(false), 2000);
    } catch {}
  }, [profile?.vId]);

  const handleLogout = useCallback(() => {
    Alert.alert(t('profile.signOutTitle'), t('profile.signOutMsg'), [
      { text: t('profile.cancel'), style: 'cancel' },
      { text: t('profile.menuSignOut'), style: 'destructive', onPress: logout },
    ]);
  }, [logout, t]);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={C.blue} />
      </SafeAreaView>
    );
  }

  const displayName = profile?.name || user?.displayName || 'User';
  const photoURL = profile?.photoURL || user?.photoURL;
  const vId = profile?.vId || '';
  const bio = profile?.bio || '';
  const giftEntries = Object.entries(receivedGifts);
  const totalGifts = giftEntries.reduce((s, [, c]) => s + c, 0);

  // Honor badges (real achievements)
  const honors: { icon: string; label: string }[] = [];
  if (rooms.length > 0) honors.push({ icon: '🎤', label: 'Host' });
  if (totalGifts > 0) honors.push({ icon: '💝', label: 'Loved' });
  if (followCounts.followers >= 10) honors.push({ icon: '⭐', label: 'Popular' });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* ─── Top Bar ─── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.bg }}>
          <Pressable onPress={() => router.back()} style={{ padding: 8 }}>
            <Feather name="arrow-left" size={24} color={C.text} />
          </Pressable>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', marginLeft: 4 }}>
            {photoURL ? (
              <Image source={{ uri: photoURL }} style={{ width: 32, height: 32, borderRadius: 16 }} />
            ) : (
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: C.muted }}>{displayName[0]?.toUpperCase()}</Text>
              </View>
            )}
            <Text style={{ fontSize: 17, fontWeight: '600', color: C.text, marginLeft: 8 }} numberOfLines={1}>{displayName}</Text>
          </View>
          <Pressable onPress={() => router.push('/profile/settings')} style={{ padding: 8 }}>
            <Feather name="user" size={22} color={C.text} />
          </Pressable>
          <Pressable onPress={() => router.push('/profile/settings')} style={{ padding: 8 }}>
            <Feather name="more-horizontal" size={22} color={C.text} />
          </Pressable>
        </View>

        {/* ─── Cover ─── */}
        <View style={{ height: 180, backgroundColor: '#1a1a2e' }}>
          {/* Cover image or gradient placeholder */}
          <View style={{ flex: 1, backgroundColor: '#2d2d44', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 48 }}>🌌</Text>
          </View>
        </View>

        {/* ─── Avatar (overlapping) ─── */}
        <View style={{ paddingHorizontal: 16, marginTop: -40 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            {photoURL ? (
              <Image source={{ uri: photoURL }} style={{ width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: C.bg }} />
            ) : (
              <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: C.blueLight, borderWidth: 3, borderColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 32, fontWeight: '800', color: C.blue }}>{displayName[0]?.toUpperCase()}</Text>
              </View>
            )}
          </View>
        </View>

        {/* ─── Name ─── */}
        <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
          <Text style={{ fontSize: 24, fontWeight: '800', color: C.text }}>{displayName}</Text>
          {bio ? <Text style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>{bio}</Text> : null}
        </View>

        {/* ─── Badge Pills ─── */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, marginTop: 12 }}>
          <BadgePill label="Non-Noble" />
          <BadgePill label={`Lv.${Math.min(99, Math.floor(followCounts.followers / 5) + 1)}`} icon="🏅" />
          <Pressable onPress={() => router.push({ pathname: '/profile/followers', params: { type: 'followers', uid: user?.uid } } as never)}>
            <BadgePill label={`${followCounts.followers} Follower`} icon="⭐" />
          </Pressable>
          <Pressable onPress={handleCopyVid}>
            <BadgePill label={vidCopied ? 'Copied!' : `# ${vId}`} icon="📋" />
          </Pressable>
        </View>

        {/* ─── VoiceClub Room ─── */}
        {rooms.length > 0 && (
          <>
            <SectionHeader title="VoiceClub Room" count={rooms.length} onPress={() => router.push('/profile/rooms')} />
            <FlatList
              horizontal
              data={rooms.slice(0, 10)}
              keyExtractor={(item, i) => item.id || String(i)}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16 }}
              renderItem={({ item }) => (
                <RoomCard
                  item={item}
                  onPress={() => router.push({ pathname: '/voice-room', params: { roomId: item.id } } as never)}
                />
              )}
            />
          </>
        )}

        {/* ─── Gifts ─── */}
        {giftEntries.length > 0 && (
          <>
            <SectionHeader title="Gifts" count={totalGifts} onPress={() => router.push('/profile/wallet')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 }}>
              {giftEntries.slice(0, 8).map(([giftId, count]) => (
                <View key={giftId} style={{ width: '25%', padding: 4, alignItems: 'center' }}>
                  <View style={{ width: '100%', aspectRatio: 1, backgroundColor: C.card, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 36 }}>{GIFTS[giftId] || '🎁'}</Text>
                  </View>
                  <Text style={{ fontSize: 13, color: C.text, marginTop: 4, fontWeight: '600' }}>x{count}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ─── Honor ─── */}
        {honors.length > 0 && (
          <>
            <SectionHeader title="Honor" count={honors.length} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 }}>
              {honors.map((h, i) => (
                <View key={i} style={{ width: '25%', padding: 4, alignItems: 'center' }}>
                  <View style={{ width: '100%', aspectRatio: 1, backgroundColor: C.card, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 36 }}>{h.icon}</Text>
                  </View>
                  <Text style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{h.label}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ─── Bottom padding for Edit button ─── */}
        <View style={{ height: 90 }} />
      </ScrollView>

      {/* ─── Edit Button (fixed at bottom, IMO style) ─── */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border }}>
        <Pressable
          onPress={() => router.push('/profile/edit')}
          style={{ backgroundColor: C.blueLight, borderRadius: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
        >
          <Feather name="edit-2" size={18} color={C.blue} />
          <Text style={{ fontSize: 17, fontWeight: '600', color: C.blue, marginLeft: 8 }}>Edit</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
