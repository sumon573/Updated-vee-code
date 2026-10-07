/**
 * Profile Section — ধাপ ১ + ধাপ ২ + ধাপ ৬ (Follow system)
 * Real Firebase data + Edit Profile + Follow/Unfollow
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, Platform, Alert,
  ActivityIndicator, Image, Pressable,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ref as dbRef, onValue } from 'firebase/database';
import { database } from '@/src/config/firebase';
import ScalePress from '@/components/ScalePress';
import { useAuth } from '@/src/context/AuthContext';
import { useTheme } from '@/src/context/ThemeContext';
import { subscribeUser, VeeUser } from '@/src/services/userService';
import { subscribeFollowCounts } from '@/src/services/followService';
import { subscribeMyRoomsCombined } from '@/src/features/voice-room/services/firebaseRoomService';
import { useTranslation } from 'react-i18next';

// ─── Sub-components ─────────────────────────────────────────────────────────
// Note: C (colors) now comes from useTheme() — passed as prop to sub-components
// that need it, or they use the theme directly.

function MenuItem({
  icon, label, onPress, danger, badge,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress?: () => void;
  danger?: boolean;
  badge?: number;
}) {
  const { theme: C } = useTheme();
  return (
    <ScalePress onPress={onPress}>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 14,
        borderBottomWidth: 1, borderBottomColor: C.border,
      }}>
        <Feather name={icon} size={20} color={danger ? C.error : C.primary} style={{ marginRight: 14 }} />
        <Text style={{ flex: 1, color: danger ? C.error : C.text, fontSize: 15, fontWeight: '500' }}>
          {label}
        </Text>
        {badge !== undefined && badge > 0 && (
          <View style={{
            backgroundColor: '#22C55E', borderRadius: 10,
            paddingHorizontal: 7, paddingVertical: 2, marginRight: 8,
          }}>
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{badge}</Text>
          </View>
        )}
        <Feather name="chevron-right" size={18} color={C.mutedDim} />
      </View>
    </ScalePress>
  );
}

// ─── Avatar ──────────────────────────────────────────────────────────────────

function Avatar({ photoURL, name }: { photoURL?: string; name?: string }) {
  const initials = name
    ? name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  if (photoURL) {
    return (
      <Image
        source={{ uri: photoURL }}
        style={{ width: 96, height: 96, borderRadius: 48 }}
      />
    );
  }

  return (
    <View style={{
      width: 96, height: 96, borderRadius: 48,
      backgroundColor: 'rgba(139,92,246,0.25)',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ color: '#fff', fontSize: 32, fontWeight: '900' }}>{initials}</Text>
    </View>
  );
}

// ─── Profile Section ─────────────────────────────────────────────────────────

export default function ProfileSection({
  onNavigateToContacts,
}: {
  onNavigateToContacts?: () => void;
} = {}) {
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const { darkMode, toggleTheme, theme } = useTheme();
  // Use theme-aware colors (C now comes from theme)
  const C = theme;
  const [profile, setProfile] = useState<VeeUser | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const topPad = Platform.OS === 'web' ? 67 : 0;

  // Real-time follow counts
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });

  // Total unread DM count — real-time from Firebase
  const [totalUnread, setTotalUnread] = useState(0);

  // Real-time rooms hosted count
  const [roomsHosted, setRoomsHosted] = useState(0);

  // Subscribe to real-time profile updates from Firebase
  useEffect(() => {
    if (!user?.uid) {
      setLoadingProfile(false);
      return;
    }
    const unsubscribe = subscribeUser(user.uid, (veeUser) => {
      setProfile(veeUser);
      setLoadingProfile(false);
    });
    // Offline safety: onValue never fires on a cold start with no network
    // (the RTDB JS SDK has no disk persistence, so there is no cached data
    // to replay) — without this the spinner would run forever. Same 3s
    // timeout pattern already used in app/chat/index.tsx. Rendering with a
    // null profile is safe (fallbacks below).
    const timeout = setTimeout(() => setLoadingProfile(false), 3000);
    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, [user?.uid]);

  // Subscribe to follow counts
  useEffect(() => {
    if (!user?.uid) return;
    return subscribeFollowCounts(user.uid, setFollowCounts);
  }, [user?.uid]);

  // CRITICAL-10 fix: count all rooms (created + joined) in real-time
  useEffect(() => {
    if (!user?.uid) return;
    return subscribeMyRoomsCombined(user.uid, (rooms) => {
      setRoomsHosted(rooms.length);
    });
  }, [user?.uid]);

  // Subscribe to total unread DM count from Firebase
  useEffect(() => {
    if (!user?.uid) return;
    const unsubscribe = onValue(dbRef(database, `userChats/${user.uid}`), (snap) => {
      if (!snap.exists()) { setTotalUnread(0); return; }
      let total = 0;
      snap.forEach((child) => {
        const v = child.val() as { unreadCount?: number };
        total += v.unreadCount ?? 0;
      });
      setTotalUnread(total);
    });
    return unsubscribe;
  }, [user?.uid]);

  // V ID copy + toast
  const [vidCopied, setVidCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the toast timer on unmount so a late callback can't fire after the
  // screen is gone.
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
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
    } catch {/* clipboard unavailable — silently ignore */}
  }, [profile?.vId]);

  const handleLogout = useCallback(() => {
    Alert.alert(
      t('profile.signOutTitle'),
      t('profile.signOutMsg'),
      [
        { text: t('profile.cancel'), style: 'cancel' },
        {
          text: t('profile.menuSignOut'),
          style: 'destructive',
          onPress: async () => {
            try {
              await logout();
            } catch {
              Alert.alert('Error', t('profile.signOutError'));
            }
          },
        },
      ],
    );
  }, [logout, t]);

  if (loadingProfile) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.glow} size="large" />
      </View>
    );
  }

  const displayName = profile?.name ?? user?.displayName ?? 'Vee User';
  const photoURL = profile?.photoURL ?? user?.photoURL ?? undefined;
  const bio = profile?.bio ?? '';
  const vId = profile?.vId ?? '';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* ── Cover + Theme toggle ── */}
          <View style={{ height: 180, position: 'relative' }}>
            <View style={{
              width: '100%', height: 180,
              backgroundColor: darkMode ? '#1A0F2E' : '#E8E2F2',
            }} />
            {/* Back button (top-left) */}
            <Pressable
              onPress={() => router.back()}
              style={{
                position: 'absolute', top: 12, left: 16,
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: 'rgba(0,0,0,0.45)',
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Feather name="arrow-left" size={20} color="#fff" />
            </Pressable>
            {/* Theme toggle — top-right corner, one-click switch */}
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                toggleTheme();
              }}
              style={{
                position: 'absolute', top: 12, right: 16,
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: 'rgba(0,0,0,0.45)',
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
              }}
            >
              <Feather name={darkMode ? 'sun' : 'moon'} size={18} color="#fff" />
            </Pressable>
          </View>

          {/* ── Avatar + Name + Badges (IMO style) ── */}
          <View style={{ paddingHorizontal: 16, marginTop: -48 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
              <ScalePress onPress={() => router.push('/profile/edit' as never)}>
                <View>
                  <Avatar photoURL={photoURL} name={displayName} />
                  <View style={{
                    position: 'absolute', bottom: 0, right: 0,
                    width: 28, height: 28, borderRadius: 14,
                    backgroundColor: C.primary,
                    alignItems: 'center', justifyContent: 'center',
                    borderWidth: 2, borderColor: C.bg,
                  }}>
                    <Feather name="camera" size={12} color="#fff" />
                  </View>
                </View>
              </ScalePress>
            </View>

            {/* Name with edit */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
              <Text style={{ color: C.text, fontSize: 22, fontWeight: '800' }}>
                {displayName}
              </Text>
              <Pressable onPress={() => router.push('/profile/edit' as never)} style={{ marginLeft: 8 }}>
                <Feather name="edit-2" size={14} color={C.muted} />
              </Pressable>
            </View>

            {/* Badges row (IMO style - horizontal scroll) */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              style={{ marginTop: 8 }} contentContainerStyle={{ gap: 6 }}>
              {/* Placeholder badges - will show earned badges */}
              <View style={{
                backgroundColor: C.gold + '22', borderRadius: 12,
                paddingHorizontal: 10, paddingVertical: 4,
                borderWidth: 1, borderColor: C.gold + '44',
              }}>
                <Text style={{ color: C.gold, fontSize: 11, fontWeight: '700' }}>Lv.1</Text>
              </View>
            </ScrollView>

            {/* Stats row (IMO style) */}
            <View style={{ flexDirection: 'row', marginTop: 12, gap: 16 }}>
              <Pressable onPress={() => router.push({ pathname: '/profile/followers', params: { type: 'followers', uid: user?.uid ?? '' } } as never)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Feather name="star" size={14} color={C.muted} />
                <Text style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>{followCounts.followers}</Text>
                <Text style={{ color: C.muted, fontSize: 13 }}>{t('profile.statFollowers')}</Text>
              </Pressable>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Feather name="user" size={14} color={C.muted} />
                <Text style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>{followCounts.following}</Text>
                <Text style={{ color: C.muted, fontSize: 13 }}>{t('profile.statFollowing')}</Text>
              </View>
            </View>

            {/* Vee ID card (IMO style) */}
            {vId ? (
              <Pressable onPress={handleCopyVid}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  backgroundColor: C.surface, borderRadius: 12,
                  padding: 12, marginTop: 12,
                  borderWidth: 1, borderColor: C.border,
                }}>
                <Feather name="at-sign" size={16} color={C.muted} />
                <Text style={{ color: C.muted, fontSize: 14, marginLeft: 8, flex: 1 }}>
                  Vee ID: <Text style={{ color: C.text, fontWeight: '600' }}>{vId}</Text>
                </Text>
                <Feather name={vidCopied ? 'check' : 'copy'} size={14} color={vidCopied ? '#22C55E' : C.muted} />
              </Pressable>
            ) : null}

            {/* Bio */}
            {bio ? (
              <Text style={{ color: C.muted, fontSize: 14, marginTop: 12, lineHeight: 20 }}>
                {bio}
              </Text>
            ) : null}
          </View>

          {/* ── VoiceClub Rooms section (IMO style) ── */}
          <View style={{ marginTop: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 10 }}>
              <Feather name="mic" size={16} color={C.muted} />
              <Text style={{ color: C.text, fontSize: 15, fontWeight: '700', marginLeft: 8, flex: 1 }}>
                {t('profile.voiceRooms', 'Voice Rooms')}
              </Text>
              <Text style={{ color: C.muted, fontSize: 13 }}>{roomsHosted}</Text>
              <Feather name="chevron-right" size={16} color={C.muted} />
            </View>
            {/* Room thumbnails would go here */}
          </View>

          {/* ── Honor section (IMO style) ── */}
          <Pressable onPress={() => router.push('/profile/honor' as never)}
            style={{ marginTop: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 10 }}>
              <Feather name="award" size={16} color={C.muted} />
              <Text style={{ color: C.text, fontSize: 15, fontWeight: '700', marginLeft: 8, flex: 1 }}>
                {t('profile.menuHonor', 'Honor')}
              </Text>
              <Feather name="chevron-right" size={16} color={C.muted} />
            </View>
          </Pressable>

          {/* ── Decoration section ── */}
          <Pressable onPress={() => router.push('/profile/decoration' as never)}
            style={{ marginTop: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 10 }}>
              <Feather name="image" size={16} color={C.muted} />
              <Text style={{ color: C.text, fontSize: 15, fontWeight: '700', marginLeft: 8, flex: 1 }}>
                {t('profile.menuDecoration', 'Decoration')}
              </Text>
              <Feather name="chevron-right" size={16} color={C.muted} />
            </View>
          </Pressable>

          {/* ── Menu items (IMO style - flat) ── */}
          <View style={{ marginTop: 20, paddingHorizontal: 16 }}>
            <MenuItem
              icon="credit-card"
              label={t('profile.menuWallet')}
              onPress={() => router.push('/profile/wallet' as never)}
            />
            <MenuItem
              icon="bell"
              label={t('profile.menuNotifications')}
              badge={totalUnread}
              onPress={() => router.push('/profile/notifications' as never)}
            />
            <MenuItem
              icon="shield"
              label={t('profile.menuPrivacy')}
              onPress={() => router.push('/profile/privacy' as never)}
            />
            <MenuItem
              icon="settings"
              label={t('profile.menuSettings')}
              onPress={() => router.push('/profile/settings' as never)}
            />
            <MenuItem
              icon="help-circle"
              label={t('profile.menuHelp')}
              onPress={() => router.push('/profile/help' as never)}
            />
            <View style={{ marginTop: 8 }}>
              <MenuItem icon="log-out" label={t('profile.menuSignOut')} onPress={handleLogout} danger />
            </View>
          </View>

          {/* ── Edit button (IMO style - bottom) ── */}
          <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
            <Pressable
              onPress={() => router.push('/profile/edit' as never)}
              style={{
                backgroundColor: darkMode ? 'rgba(139,92,246,0.15)' : '#E8E2F2',
                borderRadius: 16, paddingVertical: 14,
                alignItems: 'center',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Feather name="edit-2" size={16} color={C.primary} />
                <Text style={{ color: C.primary, fontSize: 16, fontWeight: '700' }}>
                  {t('profile.edit', 'Edit')}
                </Text>
              </View>
            </Pressable>
          </View>

          {/* ── Version ── */}
          <Text style={{ color: C.mutedDim, fontSize: 11, textAlign: 'center', marginTop: 24 }}>
            {t('profile.version')}
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
