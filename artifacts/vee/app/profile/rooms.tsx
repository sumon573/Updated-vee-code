/**
 * Profile — My Rooms Screen (CRITICAL-10 fix)
 *
 * Shows all rooms the user is associated with, sorted by role:
 *   1. Owner (golden badge)
 *   2. Admin (purple badge)
 *   3. Member (muted badge)
 *
 * Tapping a room navigates into it. Active rooms show a green live dot;
 * closed rooms show a grey dot so the user can still see their history.
 * 2026-10-19 (Sumon): restyled to IMO Me-tab design language —
 * #F4F5F5 bg, white 12dp card, 56dp title bar. All logic untouched.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Image, Alert, Platform } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ref as dbRef, onValue } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { useAuth } from '@/src/context/AuthContext';
import {
  subscribeMyRoomsCombined,
  disbandRoom,
  cleanupStaleReservations,
  type RoomInfo } from '@/src/features/voice-room/services/firebaseRoomService';
import { usePrivateRoomGate } from '@/src/components/PrivateRoomGate';

// ─── Design tokens ────────────────────────────────────────────────────────────
// IMO BIUI light tokens (matches app/profile/index.tsx)
const C = {
  bg: '#F4F5F5',
  card: '#FFFFFF',
  tile: '#F4F5F5',
  text: '#25292D',
  muted: '#788187',
  mutedLight: '#C7C7CC',
  border: '#F0F1F2',
  blue: '#007AFF',
  blueLight: '#E3F2FD',
  green: '#34C759',
  red: '#FF3B30',
  gold: '#F59E0B',
  goldBg: '#FFF8E6',
  goldBorder: '#F5D67B',
  purple: '#7C3AED',
  purpleLight: '#F1E8FF' } as const;

// IMO card container: white, 12dp radius, 15dp side margins
const cardStyle = { backgroundColor: C.card, marginHorizontal: 15, marginTop: 12, borderRadius: 12 } as const;

// IMO title bar: 56dp, back left, 17sp semibold title centered, NO gear on inner screens
function TitleBar({ title, count }: { title: string; count?: number }) {
  const topPad = Platform.OS === 'web' ? 67 : 0;
  return (
    <View style={{ backgroundColor: C.card, paddingTop: topPad }}>
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }}>
        <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }} hitSlop={8}>
          <Feather name="chevron-left" size={24} color={C.text} />
        </Pressable>
        <Text style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: C.text }} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ width: 40, alignItems: 'center' }}>
          {count !== undefined && (
            <Text style={{ fontSize: 14, color: C.muted }}>{count}</Text>
          )}
        </View>
      </View>
    </View>
  );
}

// ─── Role helpers ─────────────────────────────────────────────────────────────

type UserRole = 'owner' | 'admin' | 'member';

const ROLE_ORDER: Record<UserRole, number> = { owner: 0, admin: 1, member: 2 };

const ROLE_CONFIG: Record<UserRole, { color: string; bg: string; border: string; label: string }> = {
  owner:  { color: C.gold,    bg: C.goldBg,        border: C.goldBorder,  label: 'Owner'  },
  admin:  { color: C.purple,  bg: C.purpleLight,   border: '#D9C8F5',     label: 'Admin'  },
  member: { color: C.muted,   bg: C.tile,          border: C.border,       label: 'Member' } };

function RoleBadge({ role }: { role: UserRole }) {
  const cfg = ROLE_CONFIG[role] ?? ROLE_CONFIG.member; // Fallback for unexpected roles
  return (
    <View style={{
      paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
      backgroundColor: cfg.bg, borderWidth: 1, borderColor: cfg.border }}>
      <Text style={{ color: cfg.color, fontSize: 11, fontWeight: '700' }}>{cfg.label}</Text>
    </View>
  );
}

// ─── Room row ─────────────────────────────────────────────────────────────────

function RoomRow({
  room, role, onDelete, onRoomPress, last }: { room: RoomInfo; role: UserRole; onDelete?: () => void; onRoomPress: (room: RoomInfo) => void; last?: boolean }) {
  // Backward compatible: rooms created before the `active` flag existed
  // (or with a missing field) are treated as active. Only an explicit
  // `active: false` means closed.
  const isActive = room.active !== false;

  const handlePress = () => {
    if (!isActive) {
      // Room is closed — do not navigate; just inform the user.
      Alert.alert(
        'Room Closed',
        `"${room.name}" is no longer active. The room has been closed.`,
      );
      return;
    }
    onRoomPress(room);
  };

  // DISBAND FIX (2026-10-10): closed rooms could never be removed — tapping
  // them only showed an alert, and disbandRoom's delete was denied by rules.
  // Owners now get a trash button to permanently delete a closed room.

  return (
    <View>
      <Pressable
        onPress={handlePress}
        style={{
          flexDirection: 'row', alignItems: 'center',
          paddingVertical: 13, paddingHorizontal: 15,
          opacity: isActive ? 1 : 0.55 }}
      >
        {/* Thumbnail */}
        {room.coverImageUrl ? (
          <Image
            source={{ uri: room.coverImageUrl }}
            style={{ width: 48, height: 48, borderRadius: 12, marginRight: 12 }}
          />
        ) : (
          <View style={{
            width: 48, height: 48, borderRadius: 12,
            backgroundColor: C.tile,
            borderWidth: 1, borderColor: C.border,
            alignItems: 'center', justifyContent: 'center',
            marginRight: 12 }}>
            <Feather name={isActive ? 'mic' : 'mic-off'} size={20} color={isActive ? C.green : C.mutedLight} />
          </View>
        )}

        {/* Info */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text
              style={{ color: isActive ? C.text : C.muted, fontSize: 16, fontWeight: '600', flex: 1 }}
              numberOfLines={1}
            >
              {room.name}
            </Text>
            <RoleBadge role={role} />
          </View>

          {room.topic ? (
            <Text style={{ color: C.muted, fontSize: 13, marginTop: 3 }} numberOfLines={1}>
              {room.topic}
            </Text>
          ) : null}

          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
            <View style={{
              width: 7, height: 7, borderRadius: 4, marginRight: 6,
              backgroundColor: isActive ? C.green : C.mutedLight }} />
            <Text style={{ color: isActive ? C.green : C.muted, fontSize: 12 }}>
              {isActive ? 'Live' : 'Closed'} · {room.memberCount ?? 0} members
            </Text>
          </View>
        </View>

        <Feather name={isActive ? 'chevron-right' : 'lock'} size={18} color={C.mutedLight} style={{ marginLeft: 8 }} />
        {!isActive && onDelete && (
          <Pressable
            onPress={onDelete}
            hitSlop={10}
            style={{
              padding: 7, borderRadius: 8, backgroundColor: '#FDE8E8', marginLeft: 8 }}
          >
            <Feather name="trash-2" size={16} color={C.red} />
          </Pressable>
        )}
      </Pressable>
      {!last && <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 75 }} />}
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function ProfileRoomsScreen() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { uid: paramUid } = useLocalSearchParams<{ uid?: string }>();
  // When viewing another user's profile, show THEIR rooms
  const targetUid = paramUid ?? user?.uid;
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleMap, setRoleMap] = useState<Record<string, UserRole>>({});
  // PIN gate for private rooms
  const { requestRoomAccess, pinDialog } = usePrivateRoomGate();

  useEffect(() => {
    if (!targetUid) { setLoading(false); return; }

    // FIX (2026-10-10): Silently delete stale {_reserving:true} placeholder
    // rooms left by failed creations (old two-step flow). One-shot, best-effort.
    if (!paramUid) cleanupStaleReservations(targetUid).catch(() => {});

    // Subscribe to the user's role map from Firebase
    const unsubRoles = onValue(
      dbRef(database, `userRooms/${targetUid}`),
      (snap) => {
        const map: Record<string, UserRole> = {};
        if (snap.exists()) {
          snap.forEach((child) => {
            const v = child.val() as { role?: string };
            map[child.key!] = (v.role as UserRole) ?? 'member';
          });
        }
        setRoleMap(map);
      },
    );

    // Subscribe to combined room list (created + joined)
    const unsubRooms = subscribeMyRoomsCombined(targetUid, (r) => {
      setRooms(r);
      setLoading(false);
    });

    // Offline safety: onValue never fires on a cold start with no network
    // (the RTDB JS SDK has no disk persistence, so there is no cached data
    // to replay) — without this the spinner would run forever. Same 3s
    // timeout pattern already used in app/chat/index.tsx.
    const timeout = setTimeout(() => setLoading(false), 3000);

    return () => { clearTimeout(timeout); unsubRoles(); unsubRooms(); };
  }, [targetUid]);

  const getRole = (room: RoomInfo): UserRole => {
    // Show the PROFILE OWNER's role (targetUid), not the viewer's.
    // roleMap is already from userRooms/{targetUid}.
    if (room.ownerId === targetUid) return 'owner';
    return roleMap[room.id] ?? 'member';
  };

  // Permanently delete a closed room (owner only). With the rules fix,
  // disbandRoom now actually removes the node, so it vanishes everywhere.
  const handleDeleteClosed = (room: RoomInfo) => {
    Alert.alert(
      'Delete Room',
      `"${room.name}" will be permanently deleted. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              await disbandRoom(room.id);
            } catch {
              Alert.alert('Delete failed', 'Could not delete the room. Please try again.');
            }
          } },
      ],
    );
  };

  const sorted = [...rooms].sort((a, b) => {
    const diff = ROLE_ORDER[getRole(a)] - ROLE_ORDER[getRole(b)];
    return diff !== 0 ? diff : b.createdAt - a.createdAt;
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <TitleBar title={t('profile.statRooms', { defaultValue: 'My Rooms' })} count={loading ? undefined : sorted.length} />

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <PremiumLoader size="large" />
        </View>
      ) : sorted.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
          <Feather name="mic-off" size={44} color={C.mutedLight} />
          <Text style={{ color: C.text, fontSize: 17, fontWeight: '700', marginTop: 14 }}>No rooms yet</Text>
          <Text style={{ color: C.muted, fontSize: 14, textAlign: 'center', marginTop: 6 }}>
            Create or join a voice room to see it here.
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <View style={cardStyle}>
            {sorted.map((item, index) => {
              const role = getRole(item);
              const isClosed = item.active === false;
              return (
                <RoomRow
                  key={item.id}
                  room={item}
                  role={role}
                  last={index === sorted.length - 1}
                  onDelete={role === 'owner' && isClosed ? () => handleDeleteClosed(item) : undefined}
                  onRoomPress={(room) => requestRoomAccess(room, () => {
                    router.push({ pathname: '/voice-room', params: { roomId: room.id } } as never);
                  })}
                />
              );
            })}
          </View>
        </ScrollView>
      )}
      {pinDialog}
    </SafeAreaView>
  );
}
