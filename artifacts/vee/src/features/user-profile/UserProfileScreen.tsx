/**
 * UserProfileScreen — অন্যের Profile দেখা + Follow/Unfollow + Message
 * Real Firebase data.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Image, Pressable,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AnimatedFrame from '../../components/AnimatedFrame';
import { ref, update } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { useAuth } from '@/src/context/AuthContext';
import { subscribeUser, VeeUser } from '@/src/services/userService';
import {
  followUser, unfollowUser,
  subscribeIsFollowing, subscribeFollowCounts,
} from '@/src/services/followService';
import {
  sendFriendRequest, cancelFriendRequest, acceptFriendRequest,
  subscribeFriendStatus, FriendStatus,
} from '@/src/services/friendRequestService';
import { buildChatId } from '@/src/features/chat/services/firebaseDmService';
import { blockUser, unblockUser, isBlockedByMe } from '@/src/services/blockService';
import { subscribeMyRoomsCombined } from '@/src/features/voice-room/services/firebaseRoomService';
import { subscribeTransactionHistory } from '@/src/features/wallet/walletService';
import { subscribeBadges } from '@/src/services/badgeService';
import { useTranslation } from 'react-i18next';

const C = {
  bg: '#FFFFFF',
  primary: '#7C3AED',
  glow: '#8B5CF6',
  text: '#000000',
  muted: '#B8A6D9',
  mutedDim: '#4A3D6E',
  border: '#E5E5EA',
  surface: '#F2F2F7',
  online: '#22C55E',
  red: '#EF4444',
} as const;

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <View style={{
      flex: 1, alignItems: 'center', paddingVertical: 14,
      backgroundColor: C.surface, borderRadius: 14,
      borderWidth: 1, borderColor: '#E5E5EA',
    }}>
      <Text style={{ color: C.text, fontSize: 20, fontWeight: '900' }}>{value}</Text>
      <Text style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>{label}</Text>
    </View>
  );
}

type Props = {
  uid: string;
  name: string;
};

export default function UserProfileScreen({ uid, name: fallbackName }: Props) {
  const { user: me } = useAuth();
  const { t } = useTranslation();
  const myUid = me?.uid ?? '';

  const [profile, setProfile] = useState<VeeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [followLoading, setFollowLoading] = useState(false);
  const [friendStatus, setFriendStatus] = useState<FriendStatus>('none');
  const [friendActionLoading, setFriendActionLoading] = useState(false);
  const [myProfile, setMyProfile] = useState<VeeUser | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [rooms, setRooms] = useState<any[]>([]);
  const [receivedGifts, setReceivedGifts] = useState<Record<string, number>>({});
  const [grantedBadges, setGrantedBadges] = useState<any[]>([]);

  const topPad = Platform.OS === 'web' ? 67 : 0;

  useEffect(() => {
    const unsub = subscribeUser(uid, (u) => {
      setProfile(u);
      setLoading(false);
    });
    // Offline safety: onValue never fires on a cold start with no network
    // (the RTDB JS SDK has no disk persistence, so there is no cached data
    // to replay) — without this the spinner would run forever. Same 3s
    // timeout pattern already used in app/chat/index.tsx. Rendering with a
    // null profile is safe (optional-chaining fallbacks below).
    const timeout = setTimeout(() => setLoading(false), 3000);
    return () => {
      clearTimeout(timeout);
      unsub();
    };
  }, [uid]);

  useEffect(() => {
    if (!myUid || myUid === uid) return;
    const unsub = subscribeIsFollowing(myUid, uid, setIsFollowing);
    return unsub;
  }, [myUid, uid]);

  useEffect(() => {
    const unsub = subscribeFollowCounts(uid, setFollowCounts);
    return unsub;
  }, [uid]);

  useEffect(() => {
    if (!myUid || myUid === uid) return;
    const unsub = subscribeFriendStatus(myUid, uid, setFriendStatus);
    return unsub;
  }, [myUid, uid]);

  useEffect(() => {
    if (!myUid || myUid === uid) { setMyProfile(null); return; }
    const unsub = subscribeUser(myUid, setMyProfile);
    return unsub;
  }, [myUid, uid]);

  // Check if I have blocked this user
  useEffect(() => {
    if (!myUid || myUid === uid) return;
    // background: safe to swallow — block button defaults to unblocked on failure
    isBlockedByMe(myUid, uid).then(setIsBlocked).catch(() => {});
  }, [myUid, uid]);

  // Load other user's rooms, gifts, badges (imo-style full profile)
  useEffect(() => {
    if (!uid) return;
    return subscribeMyRoomsCombined(uid, setRooms);
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    return subscribeTransactionHistory(uid, (txs: any[]) => {
      const counts: Record<string, number> = {};
      for (const tx of txs) {
        if (tx.type === 'gift_received' && tx.giftId) {
          counts[tx.giftId] = (counts[tx.giftId] ?? 0) + 1;
        }
      }
      setReceivedGifts(counts);
    });
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    return subscribeBadges(uid, setGrantedBadges);
  }, [uid]);

  const handleFriendAction = useCallback(async () => {
    if (!myUid || myUid === uid || !myProfile) return;
    setFriendActionLoading(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (friendStatus === 'none') {
        await sendFriendRequest(myProfile, uid);
      } else if (friendStatus === 'request-sent') {
        await cancelFriendRequest(myUid, uid);
      } else if (friendStatus === 'request-received') {
        await acceptFriendRequest(myUid, uid);
      } else if (friendStatus === 'friends') {
        Alert.alert(t('userProfile.alreadyFriendsTitle'), t('userProfile.alreadyFriendsMsg'));
      }
    } catch (err) {
      Alert.alert(t('userProfile.error'), err instanceof Error ? err.message : t('userProfile.tryAgain'));
    } finally {
      setFriendActionLoading(false);
    }
  }, [myUid, uid, myProfile, friendStatus, t]);

  const handleFollow = useCallback(async () => {
    if (!myUid || myUid === uid) return;
    setFollowLoading(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (isFollowing) {
        await unfollowUser(myUid, uid);
      } else {
        await followUser(myUid, uid);
      }
    } catch {
      Alert.alert(t('userProfile.error'), t('userProfile.tryAgain'));
    } finally {
      setFollowLoading(false);
    }
  }, [myUid, uid, isFollowing, t]);

  const handleBlock = useCallback(() => {
    if (!myUid || myUid === uid || !profile) return;
    if (isBlocked) {
      Alert.alert(
        t('userProfile.unblockTitle'),
        t('userProfile.unblockMsg', { name: profile.name }),
        [
          { text: t('chat.cancel'), style: 'cancel' },
          {
            text: t('userProfile.unblockConfirm'),
            onPress: async () => {
              setBlockLoading(true);
              try {
                await unblockUser(myUid, uid);
                setIsBlocked(false);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } catch {
                Alert.alert(t('userProfile.error'), t('userProfile.tryAgain'));
              } finally {
                setBlockLoading(false);
              }
            },
          },
        ],
      );
    } else {
      Alert.alert(
        t('userProfile.blockTitle'),
        t('userProfile.blockMsg', { name: profile.name }),
        [
          { text: t('chat.cancel'), style: 'cancel' },
          {
            text: t('userProfile.blockConfirm'),
            style: 'destructive',
            onPress: async () => {
              setBlockLoading(true);
              try {
                await blockUser(myUid, uid, profile.name, profile.photoURL ?? undefined);
                setIsBlocked(true);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              } catch {
                Alert.alert(t('userProfile.error'), t('userProfile.tryAgain'));
              } finally {
                setBlockLoading(false);
              }
            },
          },
        ],
      );
    }
  }, [myUid, uid, profile, isBlocked, t]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.glow} size="large" />
      </View>
    );
  }

  // P1 fix (2026-10-12): || not ?? — Firebase can hold an empty-string name.
  // 2026-10-13: also check displayName/avatar/dp (Google users may have data in alternate fields)
  const displayName = profile?.name || (profile as any)?.displayName || fallbackName || 'Unknown';
  const photoURL    = profile?.photoURL || (profile as any)?.avatar || (profile as any)?.dp;
  const bio         = profile?.bio ?? '';
  const vId         = profile?.vId ?? '';
  // Respect the target user's showOnlineStatus privacy toggle.
  const isOnline    = (profile?.privacy?.showOnlineStatus !== false) && (profile?.online ?? false);
  const isMe        = myUid === uid;

  const initials = displayName.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2) || '?';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* Back header */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: 16, paddingTop: topPad + 10, paddingBottom: 8,
          }}>
            <Pressable onPress={() => router.back()} hitSlop={14} style={{ marginRight: 12 }}>
              <Feather name="arrow-left" size={24} color={C.text} />
            </Pressable>
            <Text style={{ color: C.text, fontSize: 18, fontWeight: '800', flex: 1 }} numberOfLines={1}>
              {displayName}
            </Text>
            {!isMe && (
              <Pressable
                onPress={() => {
                  Alert.alert(
                    displayName,
                    '',
                    [
                      {
                        text: isBlocked ? t('userProfile.unblock', 'Unblock') : t('userProfile.block', 'Block'),
                        style: isBlocked ? 'default' : 'destructive',
                        onPress: () => handleBlock(),
                      },
                      { text: t('common.cancel', 'Cancel'), style: 'cancel' },
                    ],
                  );
                }}
                hitSlop={14}
              >
                <Feather name="more-vertical" size={22} color={C.text} />
              </Pressable>
            )}
          </View>

          {/* Cover (imo style) */}
          <View style={{ height: 180, backgroundColor: '#E8E8ED' }}>
            {profile?.coverImageUrl ? (
              <Image source={{ uri: profile.coverImageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            ) : (
              <View style={{ flex: 1, backgroundColor: '#EFEFF4', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 48 }}>🌅</Text>
              </View>
            )}
          </View>

          {/* Avatar (overlapping, imo style) */}
          <View style={{ paddingHorizontal: 16, marginTop: -40 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
              <View style={{ width: 80, height: 80, alignItems: 'center', justifyContent: 'center' }}>
                {photoURL ? (
                  <Image source={{ uri: photoURL }} style={{ width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: '#FFFFFF' }} />
                ) : (
                  <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: '#E8F4FD', borderWidth: 3, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 32, fontWeight: '800', color: '#0A7CC2' }}>{initials}</Text>
                  </View>
                )}
                {/* 2026-10-13 (Sumon): Server-hosted animated frame on profile DP */}
                {!!(profile as any)?.activeFrame && (profile as any).activeFrame !== 'none' && (
                  <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
                    <AnimatedFrame size={80} frameId={(profile as any).activeFrame} />
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Name + Bio (imo style, left-aligned) */}
          <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontSize: 24, fontWeight: '800', color: C.text }}>{displayName}</Text>
              {profile?.officialBadge && (
                <View style={{ marginLeft: 6, backgroundColor: '#1DA1F2', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="check" size={13} color="#fff" />
                </View>
              )}
            </View>
            {bio ? <Text style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>{bio}</Text> : null}
            {/* Online status */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isOnline ? C.online : C.mutedDim }} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: isOnline ? C.online : C.mutedDim }}>
                {isOnline ? t('userProfile.online') : t('userProfile.offline')}
              </Text>
            </View>
          </View>

          {/* Badge Pills (imo style) */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, marginTop: 12, gap: 8 }}>
            {grantedBadges.slice(0, 3).map((badge, i) => (
              <View key={i} style={{ backgroundColor: '#FFF8E1', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#FFE0B2' }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#E65100' }}>{badge.name || badge}</Text>
              </View>
            ))}
            <View style={{ backgroundColor: '#E8F4FD', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#0A7CC2' }}>⭐ {followCounts.followers} Follower</Text>
            </View>
          </View>

          {/* Stats */}
          <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 20, marginBottom: 24 }}>
            <StatBox label={t('userProfile.statFollowers')} value={followCounts.followers} />
            <StatBox label={t('userProfile.statFollowing')} value={followCounts.following} />
          </View>

          {/* VoiceClub Rooms (imo style) */}
          {rooms.length > 0 && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 8, marginBottom: 12 }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: C.text }}>VoiceClub Room</Text>
                <Text style={{ fontSize: 14, color: C.muted }}>{rooms.length} ›</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }} nestedScrollEnabled>
                {rooms.slice(0, 10).map((item, i) => (
                  <Pressable
                    key={item.id || String(i)}
                    onPress={() => router.push({ pathname: '/voice-room', params: { roomId: item.id } } as never)}
                    style={{ width: 120, marginRight: 12 }}
                  >
                    <View style={{ width: 120, height: 120, borderRadius: 16, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 40 }}>🎙️</Text>
                    </View>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: C.text, marginTop: 6 }} numberOfLines={1}>
                      {item.name || 'Room'}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}

          {/* Gifts (imo style) */}
          {Object.keys(receivedGifts).length > 0 && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 16, marginBottom: 12 }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: C.text }}>Gifts</Text>
                <Text style={{ fontSize: 14, color: C.muted }}>
                  {Object.values(receivedGifts).reduce((s, c) => s + c, 0)} ›
                </Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 }}>
                {Object.entries(receivedGifts).slice(0, 8).map(([giftId, count]) => (
                  <View key={giftId} style={{ width: '25%', padding: 4, alignItems: 'center' }}>
                    <View style={{ width: '100%', aspectRatio: 1, backgroundColor: '#F2F2F7', borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 36 }}>🎁</Text>
                    </View>
                    <Text style={{ fontSize: 13, color: C.text, marginTop: 4, fontWeight: '600' }}>x{count}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Action buttons — imo style: 2 buttons side by side */}
          {!isMe && (
            <View style={{
              flexDirection: 'row', gap: 12,
              marginHorizontal: 20, marginBottom: 24,
            }}>
              {/* Left: Chat / Add / Accept / Cancel / Unblock */}
              <Pressable
                onPress={() => {
                  if (isBlocked) {
                    handleBlock();
                  } else if (friendStatus === 'friends') {
                    const chatId = buildChatId(myUid, uid);
                    router.push(`/inbox/${chatId}` as any);
                  } else {
                    handleFriendAction();
                  }
                }}
                disabled={friendActionLoading || blockLoading || (!myProfile && !isBlocked && friendStatus !== 'friends')}
                style={{
                  flex: 1, paddingVertical: 14, borderRadius: 16,
                  backgroundColor: '#E8F4FD',
                  alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'row', gap: 8,
                }}
              >
                {(friendActionLoading || blockLoading) ? (
                  <ActivityIndicator color="#0A7CC2" size="small" />
                ) : (
                  <>
                    <Feather
                      name={
                        isBlocked ? 'slash'
                          : friendStatus === 'friends' ? 'message-circle'
                          : friendStatus === 'request-received' ? 'user-check'
                          : friendStatus === 'request-sent' ? 'x'
                          : 'user-plus'
                      }
                      size={18}
                      color="#0A7CC2"
                    />
                    <Text style={{ color: '#0A7CC2', fontSize: 14, fontWeight: '700' }} numberOfLines={1} adjustsFontSizeToFit>
                      {isBlocked
                        ? t('userProfile.unblock', 'Unblock')
                        : friendStatus === 'friends'
                        ? t('userProfile.chat', 'Chat')
                        : friendStatus === 'request-received'
                        ? t('userProfile.accept', 'Accept')
                        : friendStatus === 'request-sent'
                        ? t('userProfile.cancelRequest', 'Cancel Request')
                        : t('userProfile.add', 'Add')}
                    </Text>
                  </>
                )}
              </Pressable>

              {/* Right: Follow / Following */}
              <Pressable
                onPress={handleFollow}
                disabled={followLoading}
                style={{
                  flex: 1, paddingVertical: 14, borderRadius: 16,
                  backgroundColor: '#E8F4FD',
                  alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'row', gap: 8,
                }}
              >
                {followLoading ? (
                  <ActivityIndicator color="#0A7CC2" size="small" />
                ) : (
                  <>
                    <Feather
                      name={isFollowing ? 'check' : 'plus'}
                      size={18}
                      color="#0A7CC2"
                    />
                    <Text style={{ color: '#0A7CC2', fontSize: 14, fontWeight: '700' }} numberOfLines={1} adjustsFontSizeToFit>
                      {isFollowing ? t('userProfile.following', 'Following') : t('userProfile.follow', 'Follow')}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          )}


          {/* Divider */}
          <View style={{
            marginHorizontal: 20,
            borderTopWidth: 1, borderTopColor: C.border,
            paddingTop: 20,
          }}>
            <Text style={{ color: C.mutedDim, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 }}>
              {t('userProfile.sectionVeeProfile')}
            </Text>
            <View style={{
              backgroundColor: C.surface, borderRadius: 14,
              borderWidth: 1, borderColor: C.border,
              padding: 16, marginTop: 12, gap: 12,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ color: C.muted, fontSize: 14 }}>Vee ID: {vId || 'N/A'}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Feather name="users" size={16} color={C.mutedDim} />
                <Text style={{ color: C.muted, fontSize: 14 }}>
                  {followCounts.followers} {t('userProfile.statFollowers')} · {followCounts.following} {t('userProfile.statFollowing')}
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
