/**
 * RoomRankModal — IMO in-room ranking port (2026-10-19).
 *
 * IMO evidence: voiceroom/ranklist/contributionrank/ (ContributionRankFragment,
 * per-user contribution rows with avatar frame + noble info) and
 * ranklist/onlinemember/ (live member ranking). Behavior ported; Vee's code.
 *
 * Tabs: Contribution (gift diamonds sent to members IN THIS ROOM, from the
 * existing rooms/{roomId}/giftEvents node — real data, no new writes) |
 * Online (live members ordered owner → admin → activity, reuse of the room's
 * member ordering).
 * Top-3 get gold/silver/bronze rank badges; the viewer's own rank is pinned
 * at the bottom with DP + name (boss's standing leaderboard spec).
 */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { get, ref } from 'firebase/database';
import { database } from '@/src/config/firebase';

export interface RankMember {
  uid: string;
  name: string;
  photoURL?: string | null;
  color?: string;
  initials?: string;
}

const RANK_COLORS = ['#F59E0B', '#94A3B8', '#B45309'];

function RankBadge({ rank }: { rank: number }) {
  if (rank > 3) {
    return (
      <View style={{ width: 28, alignItems: 'center' }}>
        <Text style={{ color: '#8E8E93', fontSize: 14, fontWeight: '800' }}>{rank}</Text>
      </View>
    );
  }
  return (
    <View style={{
      width: 28, height: 28, borderRadius: 14, backgroundColor: RANK_COLORS[rank - 1],
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '900' }}>{rank}</Text>
    </View>
  );
}

function fmtCompact(n: number): string {
  if (n >= 999_500_000) return `${parseFloat((n / 1_000_000_000).toFixed(1))}b`;
  if (n >= 999_500) return `${parseFloat((n / 1_000_000).toFixed(1))}m`;
  if (n >= 999.5) return `${parseFloat((n / 1_000).toFixed(1))}k`;
  return `${n}`;
}

export function RoomRankModal({ visible, roomId, members, myUid, onClose }: {
  visible: boolean;
  roomId: string;
  /** live members, already ordered owner → admin → activity */
  members: RankMember[];
  myUid: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'contribution' | 'online'>('contribution');
  const TAB_NAMES: Record<'contribution' | 'online', string> = {
    contribution: t('voiceRoom.rank.tab_contribution'),
    online: t('voiceRoom.rank.tab_online'),
  };
  const [contrib, setContrib] = useState<{ uid: string; coins: number }[]>([]);

  useEffect(() => {
    if (!visible || !roomId) return;
    let cancelled = false;
    get(ref(database, `rooms/${roomId}/giftEvents`)).then((snap) => {
      if (cancelled) return;
      const map = new Map<string, number>();
      if (snap.exists()) {
        snap.forEach((c) => {
          const v = c.val() as { toUid?: string; coins?: number };
          if (typeof v.toUid === 'string' && typeof v.coins === 'number') {
            map.set(v.toUid, (map.get(v.toUid) ?? 0) + v.coins);
          }
        });
      }
      setContrib([...map.entries()].map(([uid, coins]) => ({ uid, coins })).sort((a, b) => b.coins - a.coins));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [visible, roomId]);

  const nameOf = useMemo(() => {
    const m = new Map<string, RankMember>();
    members.forEach((x) => m.set(x.uid, x));
    return m;
  }, [members]);

  const rows = useMemo(() => contrib.map((c) => ({
    ...c,
    member: nameOf.get(c.uid) ?? null,
  })), [contrib, nameOf]);

  const myRank = useMemo(() => {
    if (!myUid) return -1;
    return rows.findIndex((r) => r.uid === myUid) + 1;
  }, [rows, myUid]);

  const myRow = myRank > 0 ? rows[myRank - 1] : null;

  const renderRow = (uid: string, name: string, photoURL: string | null | undefined, color: string | undefined, initials: string | undefined, rank: number, right: string) => (
    <View key={uid} style={{
      flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
      borderBottomWidth: 0.5, borderBottomColor: '#E5E5EA',
    }}>
      <RankBadge rank={rank} />
      {photoURL ? (
        <Image source={{ uri: photoURL }} style={{ width: 44, height: 44, borderRadius: 22, marginLeft: 10, backgroundColor: '#F2F2F7' }} />
      ) : (
        <View style={{ width: 44, height: 44, borderRadius: 22, marginLeft: 10, backgroundColor: (color || '#05b5fa') + '22', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: color || '#05b5fa', fontSize: 15, fontWeight: '800' }}>{initials || '?'}</Text>
        </View>
      )}
      <Text style={{ flex: 1, marginLeft: 12, fontSize: 15, fontWeight: '600', color: '#000' }} numberOfLines={1}>{name}</Text>
      <Text style={{ fontSize: 14, fontWeight: '800', color: '#F59E0B' }}>{right}</Text>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} onPress={onClose} />
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '75%', paddingBottom: 28,
      }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E5EA', alignSelf: 'center', marginTop: 10 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12 }}>
          <Feather name="award" size={18} color="#F59E0B" />
          <Text style={{ fontSize: 17, fontWeight: '800', color: '#000', marginLeft: 8, flex: 1 }}>
            {t('voiceRoom.rank.title')}
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Feather name="x" size={22} color="#8E8E93" />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', marginHorizontal: 16, marginTop: 12, backgroundColor: '#F2F2F7', borderRadius: 999, padding: 3 }}>
          {(['contribution', 'online'] as const).map((k) => (
            <Pressable
              key={k}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTab(k); }}
              style={{ flex: 1, borderRadius: 999, paddingVertical: 8, alignItems: 'center', backgroundColor: tab === k ? '#FFFFFF' : 'transparent' }}
            >
              <Text style={{ fontSize: 14, fontWeight: '800', color: tab === k ? '#007AFF' : '#8E8E93' }}>
                {TAB_NAMES[k]}
              </Text>
            </Pressable>
          ))}
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8 }} showsVerticalScrollIndicator={false}>
          {tab === 'contribution' ? (
            rows.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 36 }}>
                <Feather name="gift" size={40} color="#C7C7CC" />
                <Text style={{ color: '#8E8E93', fontSize: 14, marginTop: 12 }}>{t('voiceRoom.rank.empty')}</Text>
              </View>
            ) : (
              rows.map((r, i) => renderRow(
                r.uid,
                r.member?.name || t('voiceRoom.rank.unknown'),
                r.member?.photoURL, r.member?.color, r.member?.initials,
                i + 1, `💎${fmtCompact(r.coins)}`,
              ))
            )
          ) : (
            members.map((m, i) => renderRow(m.uid, m.name, m.photoURL, m.color, m.initials, i + 1, ''))
          )}
        </ScrollView>

        {tab === 'contribution' && myRow && myRank > 0 && (
          <View style={{
            marginHorizontal: 16, marginTop: 8, backgroundColor: '#E3F2FD', borderRadius: 12,
            padding: 10, flexDirection: 'row', alignItems: 'center',
          }}>
            <Text style={{ color: '#007AFF', fontSize: 13, fontWeight: '800', marginRight: 8 }}>#{myRank}</Text>
            <Text style={{ flex: 1, color: '#000', fontSize: 14, fontWeight: '700' }} numberOfLines={1}>
              {myRow.member?.name || t('voiceRoom.rank.you')}
            </Text>
            <Text style={{ color: '#F59E0B', fontSize: 14, fontWeight: '800' }}>💎{fmtCompact(myRow.coins)}</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}
