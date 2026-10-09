/**
 * RoomMembersModal — imo-style room member list.
 *
 * Groups (in order): Owner (1) → Admins (all) → Members (everyone else).
 * Header shows the TOTAL member count. Search filters by name.
 * Tapping a member opens member management (host/admin) or profile view.
 *
 * All data is real (Firebase seats + audience). No demo entries.
 * Styled for the voice room's dark theme.
 */

import { useState, useMemo, useEffect } from 'react';
import {
  View, Text, Modal, Pressable, FlatList, TextInput, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { subscribeUser, VeeUser } from '@/src/services/userService';
import type { Participant } from '@/src/features/voice-room/types/room';

const C = {
  bg: '#14101F',
  card: '#1E1830',
  text: '#FFFFFF',
  muted: 'rgba(255,255,255,0.6)',
  dim: 'rgba(255,255,255,0.35)',
  border: 'rgba(255,255,255,0.09)',
  inputBg: 'rgba(255,255,255,0.07)',
  primary: '#8B5CF6',
  gold: '#F5A623',
  green: '#22C55E',
  red: '#EF4444',
} as const;

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
    return <Image source={{ uri: p.photoURL }} style={{ width: 46, height: 46, borderRadius: 23 }} />;
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

function RoleBadge({ role }: { role: 'host' | 'admin' | 'member' }) {
  if (role === 'member') return null;
  const isHost = role === 'host';
  return (
    <View style={{
      backgroundColor: isHost ? 'rgba(245,166,35,0.18)' : 'rgba(139,92,246,0.18)',
      borderWidth: 1, borderColor: isHost ? 'rgba(245,166,35,0.45)' : 'rgba(139,92,246,0.45)',
      borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 8,
    }}>
      <Text style={{
        fontSize: 10, fontWeight: '800',
        color: isHost ? C.gold : C.primary,
      }}>
        {isHost ? 'Owner' : 'Admin'}
      </Text>
    </View>
  );
}

export default function RoomMembersModal({
  visible, onClose, ownerId, seats, audience, onManageMember,
}: Props) {
  const [query, setQuery] = useState('');
  // Fallback: owner profile if the owner is not currently seated/in audience
  const [ownerProfile, setOwnerProfile] = useState<VeeUser | null>(null);

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

  // If the owner isn't in the room right now, load their real profile so the
  // Owner row still shows (never a fake placeholder).
  useEffect(() => {
    if (!visible || owner || !ownerId) { setOwnerProfile(null); return; }
    const unsub = subscribeUser(ownerId, setOwnerProfile);
    return unsub;
  }, [visible, owner, ownerId]);

  const ownerRow: Participant | null = owner ?? (ownerProfile ? {
    id: ownerProfile.uid,
    name: ownerProfile.name || 'Owner',
    initials: (ownerProfile.name || 'O').split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2),
    color: C.gold,
    photoURL: ownerProfile.photoURL || undefined,
    speaking: false,
    muted: true,
    role: 'host',
  } : null);

  const total = (ownerRow ? 1 : 0) + admins.length + members.length;

  const q = query.trim().toLowerCase();
  const matchQ = (p: Participant) =>
    !q || p.name.toLowerCase().includes(q);
  const fOwner = ownerRow && matchQ(ownerRow) ? [ownerRow] : [];
  const fAdmins = admins.filter(matchQ);
  const fMembers = members.filter(matchQ);

  const sections: { title: string; data: Participant[] }[] = [
    ...(fOwner.length ? [{ title: 'Owner', data: fOwner }] : []),
    ...(fAdmins.length ? [{ title: `Admins (${admins.length})`, data: fAdmins }] : []),
    ...(fMembers.length ? [{ title: `Members (${members.length})`, data: fMembers }] : []),
  ];

  const renderRow = ({ item }: { item: Participant }) => (
    <Pressable
      onPress={() => { onClose(); onManageMember(item); }}
      style={{
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 10, paddingHorizontal: 16,
        borderBottomWidth: 1, borderBottomColor: C.border,
      }}
    >
      <MemberAvatar p={item} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
            {item.name}
          </Text>
          <RoleBadge role={item.role} />
        </View>
        <Text style={{ color: C.dim, fontSize: 12, marginTop: 2 }}>
          {item.speaking ? 'Speaking…' : item.muted ? 'Muted' : 'In room'}
        </Text>
      </View>
      {item.muted
        ? <Feather name="mic-off" size={16} color={C.red} />
        : <Feather name="mic" size={16} color={C.green} />}
    </Pressable>
  );

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
                Room Members
              </Text>
              <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                {total} {total === 1 ? 'person' : 'people'}
              </Text>
            </View>
          </View>

          {/* Search (imo style) */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            marginHorizontal: 16, marginTop: 12, marginBottom: 4,
            backgroundColor: C.inputBg, borderRadius: 12,
            paddingHorizontal: 12, paddingVertical: 10,
            borderWidth: 1, borderColor: C.border,
          }}>
            <Feather name="search" size={16} color={C.dim} style={{ marginRight: 8 }} />
            <TextInput
              style={{ flex: 1, color: C.text, fontSize: 14 }}
              placeholder="Search members"
              placeholderTextColor={C.dim}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')}>
                <Feather name="x-circle" size={16} color={C.dim} />
              </Pressable>
            )}
          </View>

          <FlatList
            data={sections}
            keyExtractor={(s) => s.title}
            renderItem={({ item: section }) => (
              <View>
                <Text style={{
                  color: C.muted, fontSize: 12, fontWeight: '800',
                  letterSpacing: 0.6, paddingHorizontal: 16,
                  paddingTop: 14, paddingBottom: 4,
                }}>
                  {section.title.toUpperCase()}
                </Text>
                {section.data.map((p) => (
                  <View key={p.id}>{renderRow({ item: p })}</View>
                ))}
              </View>
            )}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingTop: 60 }}>
                <Feather name="users" size={40} color={C.dim} />
                <Text style={{ color: C.muted, fontSize: 14, marginTop: 12 }}>
                  {q ? 'No members match your search' : 'No members yet'}
                </Text>
              </View>
            }
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
}
