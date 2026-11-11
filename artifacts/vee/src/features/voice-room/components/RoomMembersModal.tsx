/**
 * RoomMembersModal — imo-style room member list ("Live Audience").
 *
 * Groups (in order): Owner (1) → Admins (all) → Members (everyone else).
 * Header shows the TOTAL member count. Per Sumon 2026-10-12: NO search bar,
 * live members ONLY (owner appears only if actually live in the room).
 * Tapping a member opens member management (host/admin) or profile view.
 *
 * All data is real (Firebase seats + audience). No demo entries.
 * 2026-10-23 (Sumon): LIGHT theme like the rest of the app — this modal
 * kept its own hardcoded dark palette ("Live Audience-এর জায়গাটা ব্ল্যাক
 * থাকবে না"); it now uses the shared voice-room theme tokens.
 */

import { memo, useCallback, useMemo } from 'react';
import {
  View, Text, Modal, Pressable, FlatList,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import type { Participant } from '@/src/features/voice-room/types/room';
import { VerifiedName } from '@/src/components/VerifiedName';
import { useIsKing } from '@/src/hooks/useNobleRank';
import { KingSparkle, KING_GOLD } from './KingShimmerName';

import { C } from '../constants/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  ownerId: string;
  seats: (Participant | null)[];
  audience: Participant[];
  onManageMember: (m: Participant) => void;
};

function MemberAvatar({ p }: { p: Participant }) {
  if (p.photoURL) {
    return (
      <Image
        source={{ uri: p.photoURL }}
        style={{ width: 46, height: 46, borderRadius: 23 }}
        cachePolicy="memory-disk"
        recyclingKey={p.id}
      />
    );
  }
  return (
    <View style={{
      width: 46, height: 46, borderRadius: 23, backgroundColor: p.color || C.primary,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>{p.initials}</Text>
    </View>
  );
}

// 2026-11-11 (boss, Live Audience redesign): the role is recognised by the
// 👤 ICON before the name — never by text ("লেখা না আইকন এ চেনা যাবে").
// Colours are the polished members-list colours (RoomInfoModal roleColor,
// boss 18:46 reference — gold/blue/gray 👤 icons): GOLD = room owner ONLY,
// BLUE = admin, GREY = regular member ("মেম্বার সাধারণ"). The icon is a
// clean vector (Feather "user"), never a raw 👤 emoji glyph.
// GOLD rule (boss 2026-10-27, CORRECTED): uid === ownerId OR role 'host' —
// noble grants are NEVER consulted here (they made every row gold).
const ROLE_ICON_GOLD = '#FFB300';
const ROLE_ICON_BLUE = '#42A5F5';
const ROLE_ICON_GREY = '#8A8A8E';

function RoleIcon({ role, isOwner }: { role: 'host' | 'admin' | 'member'; isOwner: boolean }) {
  const color = (isOwner || role === 'host') ? ROLE_ICON_GOLD
    : (role === 'admin' ? ROLE_ICON_BLUE : ROLE_ICON_GREY);
  return (
    <View style={{ marginRight: 6, alignItems: 'center', justifyContent: 'center' }}>
      <Feather name="user" size={15} color={color} />
    </View>
  );
}

const MemberRow = memo(function MemberRow({
  item, ownerId, onPress,
}: {
  item: Participant;
  ownerId: string;
  onPress: (p: Participant) => void;
}) {
  // 2026-11-01 (batch56): King gold + shimmer on member names.
  const isKing = useIsKing((item as any).uid || item.id);
  // 2026-11-11 (boss, Live Audience redesign): GOLD = this row IS the room
  // owner (uid === ownerId) or role 'host' — same rule as RoomInfoModal.
  const isOwner = item.id === ownerId;
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={{
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 10, paddingHorizontal: 16,
        borderBottomWidth: 1, borderBottomColor: C.border,
      }}
    >
      <MemberAvatar p={item} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <RoleIcon role={item.role} isOwner={isOwner} />
          <View style={{ flexShrink: 1 }}>
            <VerifiedName
              name={item.name}
              uid={(item as any).uid || (item as any).id}
              nameStyle={{ color: isKing ? KING_GOLD : C.text, fontSize: 15, fontWeight: '700', flexShrink: 1 }}
              logoSize={15}
            />
          </View>
          {isKing ? <KingSparkle /> : null}
        </View>
        <Text style={{ color: C.sub, fontSize: 12, marginTop: 2 }}>
          {item.speaking ? 'Speaking…' : (item.muted || item.hostMuted) ? 'Muted' : 'In room'}
        </Text>
      </View>
      {(item.muted || item.hostMuted)
        ? <Feather name="mic-off" size={16} color={C.red} />
        : <Feather name="mic" size={16} color={C.mic} />}
    </Pressable>
  );
});

export default function RoomMembersModal({
  visible, onClose, ownerId, seats, audience, onManageMember,
}: Props) {


  const seatMembers = useMemo(
    () => seats.filter((s): s is Participant => s !== null),
    [seats],
  );

  const all = useMemo(() => {
    const map = new Map<string, Participant>();
    for (const p of [...seatMembers, ...audience]) {
      if (!map.has(p.id)) map.set(p.id, p);
    }
    return [...map.values()];
  }, [seatMembers, audience]);

  const owner = useMemo(
    () => all.find((p) => p.id === ownerId) ?? null,
    [all, ownerId],
  );
  const admins = useMemo(
    () => all.filter((p) => p.id !== ownerId && p.role === 'admin'),
    [all, ownerId],
  );
  const members = useMemo(
    () => all.filter((p) => p.id !== ownerId && p.role !== 'admin'),
    [all, ownerId],
  );

  // Per Sumon 2026-10-12: NO owner fallback — Live Audience shows ONLY
  // those actually live in the room.

  // Per Sumon 2026-10-12: owner appears ONLY if actually live in the room.
  // No fallback for offline owners.
  const ownerRow: Participant | null = owner;

  const total = (ownerRow ? 1 : 0) + admins.length + members.length;

  const fOwner = ownerRow ? [ownerRow] : [];
  const fAdmins = admins;
  const fMembers = members;

  const sections: { title: string; data: Participant[] }[] = [
    ...(fOwner.length ? [{ title: 'Owner', data: fOwner }] : []),
    ...(fAdmins.length ? [{ title: `Admins (${admins.length})`, data: fAdmins }] : []),
    ...(fMembers.length ? [{ title: `Members (${members.length})`, data: fMembers }] : []),
  ];

  // Perf (2026-10-22 audit): ONE flat virtualized list. The old code ran a
  // FlatList over ≤3 sections and .map()-mounted EVERY member inside each
  // section — no virtualization at all in large rooms.
  type FlatRow =
    | { kind: 'header'; title: string }
    | { kind: 'member'; p: Participant };
  const flatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];
    for (const s of sections) {
      rows.push({ kind: 'header', title: s.title });
      for (const p of s.data) rows.push({ kind: 'member', p });
    }
    return rows;
  }, [sections]);

  const handleMemberPress = useCallback((p: Participant) => {
    onClose();
    onManageMember(p);
  }, [onClose, onManageMember]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <SafeAreaView style={{ flex: 1 }}>
          {/* Header — total count like imo's "Group Members 16 people" */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: 16, paddingVertical: 14,
            borderBottomWidth: 1, borderBottomColor: C.border,
          }}>
            <Pressable onPress={onClose} style={{ padding: 6, marginRight: 8 }}>
              <Feather name="x" size={22} color={C.muted} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontSize: 18, fontWeight: '800' }}>
                Live Audience
              </Text>
              <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                {total} {total === 1 ? 'person' : 'people'}
              </Text>
            </View>
          </View>

          <FlatList
            data={flatRows}
            keyExtractor={(r) => (r.kind === 'header' ? `h:${r.title}` : `m:${r.p.id}`)}
            renderItem={({ item: row }) => (
              row.kind === 'header' ? (
                <Text style={{
                  color: C.muted, fontSize: 12, fontWeight: '800',
                  letterSpacing: 0.6, paddingHorizontal: 16,
                  paddingTop: 14, paddingBottom: 4,
                }}>
                  {row.title.toUpperCase()}
                </Text>
              ) : (
                <MemberRow item={row.p} ownerId={ownerId} onPress={handleMemberPress} />
              )
            )}
            windowSize={9}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            removeClippedSubviews
            updateCellsBatchingPeriod={50}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingTop: 60 }}>
                <Feather name="users" size={40} color={C.muted} />
                <Text style={{ color: C.muted, fontSize: 14, marginTop: 12 }}>
                  No members yet
                </Text>
              </View>
            }
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
}
