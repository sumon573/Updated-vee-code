/**
 * Profile — My Rooms Screen (CRITICAL-10 fix)
 *
 * 2026-10-29 (boss, imo-exact list): grouped expandable sections
 * "Rooms owned" + "Rooms joined" (admin rooms live under Joined, not Owned);
 * count pill icon ORANGE for owned, BLUE for joined; private rooms show a
 * lock AFTER the name (not on the photo); each row = photo + name (+lock)
 * + count pill top-right + topic + 5 seat icons. NO Owner/Admin text
 * pills, NO "Live · N members" line, NO flags on list rows (imo has none),
 * NO imo privacy banner (imo-chrome). Vee's header is kept ("My Rooms" +
 * count) — NOT renamed to imo's "VoiceClub Room / Joined 42".
 * Tapping a room navigates into it (PIN gate enforced from everywhere).
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

// NOTE 2026-10-29: the old Owner/Admin/Member text pills and role ordering
// are gone — the imo-exact list groups by section (Owned vs Joined) and
// encodes the section in the count-pill icon color instead.

// ─── Room row (imo-exact) ─────────────────────────────────────────────────────

function RoomRow({
  room, section, onDelete, onRoomPress, last }: {
  room: RoomInfo; section: 'owned' | 'joined';
  onDelete?: () => void; onRoomPress: (room: RoomInfo) => void; last?: boolean }) {
  // Backward compatible: rooms created before the `active` flag existed
  // (or with a missing field) are treated as active. Only an explicit
  // `active: false` means closed.
  const isActive = room.active !== false;
  const liveCount = room.liveCount ?? room.memberCount ?? 0;

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
          flexDirection: 'row', alignItems: 'flex-start',
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
            {room.isPublic === false && (
              <Feather name="lock" size={13} color="#F59E0B" style={{ marginLeft: 6 }} />
            )}
          </View>

          {room.topic ? (
            <Text style={{ color: C.muted, fontSize: 13, marginTop: 3 }} numberOfLines={1}>
              {room.topic}
            </Text>
          ) : null}

          {/* 5 seat icons (imo list rows) — empty circles. Live seat avatars
              would need a per-room seats subscription; RoomInfo carries no
              seat data, so empty circles are the honest fallback. */}
          <View style={{ flexDirection: 'row', marginTop: 6 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <View
                key={i}
                style={{
                  width: 16, height: 16, borderRadius: 8,
                  backgroundColor: C.tile, borderWidth: 1, borderColor: C.border,
                  marginRight: 4 }}
              />
            ))}
          </View>
        </View>

        {/* Count pill top-right: ORANGE person for owned, BLUE for joined */}
        <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: '#F0F1F2', borderRadius: 12,
            paddingHorizontal: 8, paddingVertical: 4 }}>
            <Feather name="user" size={13} color={section === 'owned' ? '#FF9500' : '#007AFF'} />
            <Text style={{ color: C.text, fontSize: 13, fontWeight: '700', marginLeft: 4 }}>
              {liveCount}
            </Text>
          </View>
          {!isActive && onDelete && (
            <Pressable
              onPress={onDelete}
              hitSlop={10}
              style={{
                padding: 7, borderRadius: 8, backgroundColor: '#FDE8E8', marginTop: 8 }}
            >
              <Feather name="trash-2" size={16} color={C.red} />
            </Pressable>
          )}
        </View>
      </Pressable>
      {!last && <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 75 }} />}
    </View>
  );
}

// ─── Expandable section (imo: "Rooms owned" / "Rooms joined") ───────────────

function RoomSection({ title, items, expanded, onToggle, onDelete, onRoomPress }: {
  title: string;
  items: Array<{ room: RoomInfo; role: UserRole }>;
  expanded: boolean;
  onToggle: () => void;
  onDelete: (room: RoomInfo) => void;
  onRoomPress: (room: RoomInfo) => void;
}) {
  return (
    <View style={cardStyle}>
      <Pressable
        onPress={onToggle}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 15, paddingVertical: 13 }}
      >
        <Text style={{ fontSize: 16, fontWeight: '600', color: C.text }}>{title}</Text>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={C.muted} />
      </Pressable>
      {expanded && items.map(({ room, role }, index) => (
        <RoomRow
          key={room.id}
          room={room}
          section={role === 'owner' ? 'owned' : 'joined'}
          last={index === items.length - 1}
          onDelete={role === 'owner' && room.active === false ? () => onDelete(room) : undefined}
          onRoomPress={onRoomPress}
        />
      ))}
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

  // 2026-10-29 (boss, imo-exact list): sections replace role ordering.
  // Owned = profile-owner's own rooms; Joined = admin + member rooms.
  const owned = rooms
    .filter((r) => getRole(r) === 'owner')
    .sort((a, b) => b.createdAt - a.createdAt);
  const joined = rooms
    .filter((r) => getRole(r) !== 'owner')
    .sort((a, b) => b.createdAt - a.createdAt);
  const [ownedExpanded, setOwnedExpanded] = useState(true);
  const [joinedExpanded, setJoinedExpanded] = useState(true);
  const handleRoomPress = (room: RoomInfo) => {
    requestRoomAccess(room, () => {
      router.push({ pathname: '/voice-room', params: { roomId: room.id } } as never);
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <TitleBar title={t('profile.statRooms', { defaultValue: 'My Rooms' })} count={loading ? undefined : rooms.length} />

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <PremiumLoader size="large" />
        </View>
      ) : rooms.length === 0 ? (
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
          {owned.length > 0 && (
            <RoomSection
              title="Rooms owned"
              items={owned.map((r) => ({ room: r, role: getRole(r) }))}
              expanded={ownedExpanded}
              onToggle={() => setOwnedExpanded((v) => !v)}
              onDelete={handleDeleteClosed}
              onRoomPress={handleRoomPress}
            />
          )}
          {joined.length > 0 && (
            <RoomSection
              title="Rooms joined"
              items={joined.map((r) => ({ room: r, role: getRole(r) }))}
              expanded={joinedExpanded}
              onToggle={() => setJoinedExpanded((v) => !v)}
              onDelete={handleDeleteClosed}
              onRoomPress={handleRoomPress}
            />
          )}
        </ScrollView>
      )}
      {pinDialog}
    </SafeAreaView>
  );
}
