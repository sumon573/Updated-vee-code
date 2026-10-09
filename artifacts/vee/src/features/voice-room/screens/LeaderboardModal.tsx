/**
 * LeaderboardModal — Real rankings (2026-10-09)
 *
 * Four tabs, all real data:
 *   • Top Rooms     — active rooms sorted by live member count
 *   • Top Live      — currently live rooms, by members
 *   • Top Senders   — users who sent the most gifts (weekly)
 *   • Top Receivers — users who received the most gifts (weekly)
 *
 * Light mode. Rankings update live via Firebase subscriptions.
 */
import { useState, useEffect } from 'react';
import {
  View, Text, Modal, Pressable, FlatList,
  ActivityIndicator, TouchableOpacity, Image,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { get, ref, query, orderByChild, limitToLast, onValue } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { subscribeActiveRooms, type RoomInfo } from '../services/firebaseRoomService';

// ─── Light palette ───────────────────────────────────────────────────────────

const C = {
  bg:      '#FFFFFF',
  text:    '#000000',
  muted:   '#8E8E93',
  primary: '#7C3AED',
  glow:    '#8B5CF6',
  border:  '#E5E5EA',
  surface: '#F2F2F7',
  gold:    '#F59E0B',
  silver:  '#94A3B8',
  bronze:  '#B45309',
  green:   '#22C55E',
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type LeaderboardEntry = {
  uid: string;
  name: string;
  photoURL?: string;
  weeklySent?: number;
  weeklyEarned?: number;
};

type Tab = 'rooms' | 'live' | 'senders' | 'receivers';

// ─── Sub-components ───────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
  const color = rank === 1 ? C.gold : rank === 2 ? C.silver : rank === 3 ? C.bronze : C.muted;
  return (
    <View style={{
      width: 34, height: 34, borderRadius: 17,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: medal ? color + '1A' : C.surface,
      borderWidth: medal ? 1 : 0, borderColor: color,
      marginRight: 12,
    }}>
      {medal
        ? <Text style={{ fontSize: 16 }}>{medal}</Text>
        : <Text style={{ color: C.muted, fontSize: 13, fontWeight: '800' }}>{rank}</Text>
      }
    </View>
  );
}

function EmptyState({ icon, message }: { icon: React.ComponentProps<typeof Feather>['name']; message: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48 }}>
      <Feather name={icon} size={36} color={C.muted} />
      <Text style={{ color: C.muted, fontSize: 14, marginTop: 12, textAlign: 'center', paddingHorizontal: 32 }}>
        {message}
      </Text>
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function LeaderboardModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('rooms');

  // ── Top Rooms (live subscription) ──────────────────────────────────────────
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setRoomsLoading(true);
    const unsub = subscribeActiveRooms((allRooms) => {
      const sorted = [...allRooms]
        .sort((a, b) => b.memberCount - a.memberCount)
        .slice(0, 30);
      setRooms(sorted);
      setRoomsLoading(false);
    });
    return unsub;
  }, [visible]);

  // ── Top Senders (live subscription) ────────────────────────────────────────
  const [senders, setSenders] = useState<LeaderboardEntry[]>([]);
  const [sendersLoading, setSendersLoading] = useState(true);

  useEffect(() => {
    if (!visible || tab !== 'senders') return;
    setSendersLoading(true);
    const q = query(ref(database, 'leaderboard_senders'), orderByChild('weeklySent'), limitToLast(30));
    const unsub = onValue(q, (snap) => {
      if (!snap.exists()) {
        setSenders([]);
        setSendersLoading(false);
        return;
      }
      const list: LeaderboardEntry[] = [];
      snap.forEach((child) => {
        const v = child.val() as { name?: string; photoURL?: string; weeklySent?: number };
        list.push({
          uid: child.key!,
          name: v.name ?? 'Vee User',
          photoURL: v.photoURL,
          weeklySent: typeof v.weeklySent === 'number' ? v.weeklySent : 0,
        });
      });
      list.sort((a, b) => (b.weeklySent ?? 0) - (a.weeklySent ?? 0));
      setSenders(list);
      setSendersLoading(false);
    }, () => {
      setSenders([]);
      setSendersLoading(false);
    });
    return unsub;
  }, [visible, tab]);

  // ── Top Receivers (live subscription) ──────────────────────────────────────
  const [receivers, setReceivers] = useState<LeaderboardEntry[]>([]);
  const [receiversLoading, setReceiversLoading] = useState(true);

  useEffect(() => {
    if (!visible || tab !== 'receivers') return;
    setReceiversLoading(true);
    const q = query(ref(database, 'leaderboard'), orderByChild('weeklyEarned'), limitToLast(30));
    const unsub = onValue(q, (snap) => {
      if (!snap.exists()) {
        setReceivers([]);
        setReceiversLoading(false);
        return;
      }
      const list: LeaderboardEntry[] = [];
      snap.forEach((child) => {
        const v = child.val() as { name?: string; photoURL?: string; weeklyEarned?: number };
        list.push({
          uid: child.key!,
          name: v.name ?? 'Vee User',
          photoURL: v.photoURL,
          weeklyEarned: typeof v.weeklyEarned === 'number' ? v.weeklyEarned : 0,
        });
      });
      list.sort((a, b) => (b.weeklyEarned ?? 0) - (a.weeklyEarned ?? 0));
      setReceivers(list);
      setReceiversLoading(false);
    }, () => {
      setReceivers([]);
      setReceiversLoading(false);
    });
    return unsub;
  }, [visible, tab]);

  const liveRooms = rooms.filter(r => r.isLive);

  const tabs: { key: Tab; label: string; icon: React.ComponentProps<typeof Feather>['name'] }[] = [
    { key: 'rooms',     label: t('leaderboard.topRooms', { defaultValue: 'Top Rooms' }),         icon: 'home' },
    { key: 'live',      label: t('leaderboard.topLive', { defaultValue: 'Top Live' }),           icon: 'radio' },
    { key: 'senders',   label: t('leaderboard.topSenders', { defaultValue: 'Top Senders' }),      icon: 'gift' },
    { key: 'receivers', label: t('leaderboard.topReceivers', { defaultValue: 'Top Receivers' }), icon: 'award' },
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
        onPress={onClose}
      />
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: C.bg,
        borderTopLeftRadius: 26, borderTopRightRadius: 26,
        maxHeight: '90%',
        shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20,
        elevation: 10,
      }}>
        <View style={{
          width: 40, height: 4, borderRadius: 2, backgroundColor: C.border,
          alignSelf: 'center', marginTop: 12,
        }} />

        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14,
        }}>
          <Text style={{ fontSize: 18, marginRight: 8 }}>🏆</Text>
          <Text style={{ flex: 1, color: C.text, fontSize: 20, fontWeight: '800' }}>
            {t('leaderboard.title', { defaultValue: 'Leaderboard' })}
          </Text>
          <Pressable onPress={onClose} hitSlop={14}>
            <Feather name="x" size={22} color={C.muted} />
          </Pressable>
        </View>

        {/* Tabs — 2x2 grid for 4 categories */}
        <View style={{
          flexDirection: 'row', flexWrap: 'wrap',
          paddingHorizontal: 20, marginBottom: 12, gap: 8,
        }}>
          {tabs.map(({ key, label, icon }) => {
            const active = tab === key;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setTab(key)}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  paddingVertical: 9, paddingHorizontal: 14, borderRadius: 20,
                  backgroundColor: active ? C.primary : C.surface,
                  gap: 6,
                }}
              >
                <Feather name={icon} size={14} color={active ? '#fff' : C.muted} />
                <Text style={{
                  color: active ? '#fff' : C.muted,
                  fontSize: 13, fontWeight: '700',
                }}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Top Rooms ── */}
        {tab === 'rooms' && (
          roomsLoading
            ? <View style={{ paddingVertical: 48, alignItems: 'center' }}>
                <ActivityIndicator color={C.primary} />
              </View>
            : rooms.length === 0
              ? <EmptyState icon="mic-off" message={t('leaderboard.noData', { defaultValue: 'No rooms yet' })} />
              : <FlatList
                  data={rooms}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}
                  renderItem={({ item, index }) => (
                    <View style={{
                      flexDirection: 'row', alignItems: 'center',
                      paddingVertical: 12,
                      borderBottomWidth: 1, borderBottomColor: C.surface,
                    }}>
                      <RankBadge rank={index + 1} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                          {item.ownerName ?? ''}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: C.primary, fontSize: 18, fontWeight: '800' }}>
                          {item.memberCount}
                        </Text>
                        <Text style={{ color: C.muted, fontSize: 11 }}>
                          {t('leaderboard.members', { defaultValue: 'members' })}
                        </Text>
                      </View>
                    </View>
                  )}
                />
        )}

        {/* ── Top Live ── */}
        {tab === 'live' && (
          roomsLoading
            ? <View style={{ paddingVertical: 48, alignItems: 'center' }}>
                <ActivityIndicator color={C.primary} />
              </View>
            : liveRooms.length === 0
              ? <EmptyState icon="radio" message={t('leaderboard.noLive', { defaultValue: 'No live rooms right now' })} />
              : <FlatList
                  data={liveRooms}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}
                  renderItem={({ item, index }) => (
                    <View style={{
                      flexDirection: 'row', alignItems: 'center',
                      paddingVertical: 12,
                      borderBottomWidth: 1, borderBottomColor: C.surface,
                    }}>
                      <RankBadge rank={index + 1} />
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <View style={{
                            backgroundColor: '#FEE2E2', borderRadius: 8,
                            paddingHorizontal: 6, paddingVertical: 2,
                          }}>
                            <Text style={{ color: '#EF4444', fontSize: 10, fontWeight: '800' }}>LIVE</Text>
                          </View>
                        </View>
                        <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                          {item.ownerName ?? ''}
                        </Text>
                      </View>
                      <Text style={{ color: C.primary, fontSize: 18, fontWeight: '800' }}>
                        {item.memberCount}
                      </Text>
                    </View>
                  )}
                />
        )}

        {/* ── Top Senders ── */}
        {tab === 'senders' && (
          sendersLoading
            ? <View style={{ paddingVertical: 48, alignItems: 'center' }}>
                <ActivityIndicator color={C.primary} />
              </View>
            : senders.length === 0
              ? <EmptyState icon="gift" message={t('leaderboard.noSenders', { defaultValue: 'No gift senders yet this week' })} />
              : <FlatList
                  data={senders}
                  keyExtractor={(item) => item.uid}
                  contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}
                  renderItem={({ item, index }) => (
                    <View style={{
                      flexDirection: 'row', alignItems: 'center',
                      paddingVertical: 12,
                      borderBottomWidth: 1, borderBottomColor: C.surface,
                    }}>
                      <RankBadge rank={index + 1} />
                      {item.photoURL ? (
                        <Image
                          source={{ uri: item.photoURL }}
                          style={{ width: 42, height: 42, borderRadius: 21, marginRight: 12 }}
                        />
                      ) : (
                        <View style={{
                          width: 42, height: 42, borderRadius: 21, marginRight: 12,
                          backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Text style={{ color: C.muted, fontSize: 16, fontWeight: '700' }}>
                            {item.name[0]?.toUpperCase() ?? '?'}
                          </Text>
                        </View>
                      )}
                      <Text style={{ flex: 1, color: C.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: C.primary, fontSize: 18, fontWeight: '800' }}>
                          {item.weeklySent ?? 0}
                        </Text>
                        <Text style={{ color: C.muted, fontSize: 11 }}>
                          {t('leaderboard.gifts', { defaultValue: 'gifts' })}
                        </Text>
                      </View>
                    </View>
                  )}
                />
        )}

        {/* ── Top Receivers ── */}
        {tab === 'receivers' && (
          receiversLoading
            ? <View style={{ paddingVertical: 48, alignItems: 'center' }}>
                <ActivityIndicator color={C.primary} />
              </View>
            : receivers.length === 0
              ? <EmptyState icon="award" message={t('leaderboard.noReceivers', { defaultValue: 'No gift receivers yet this week' })} />
              : <FlatList
                  data={receivers}
                  keyExtractor={(item) => item.uid}
                  contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}
                  renderItem={({ item, index }) => (
                    <View style={{
                      flexDirection: 'row', alignItems: 'center',
                      paddingVertical: 12,
                      borderBottomWidth: 1, borderBottomColor: C.surface,
                    }}>
                      <RankBadge rank={index + 1} />
                      {item.photoURL ? (
                        <Image
                          source={{ uri: item.photoURL }}
                          style={{ width: 42, height: 42, borderRadius: 21, marginRight: 12 }}
                        />
                      ) : (
                        <View style={{
                          width: 42, height: 42, borderRadius: 21, marginRight: 12,
                          backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Text style={{ color: C.muted, fontSize: 16, fontWeight: '700' }}>
                            {item.name[0]?.toUpperCase() ?? '?'}
                          </Text>
                        </View>
                      )}
                      <Text style={{ flex: 1, color: C.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: C.gold, fontSize: 18, fontWeight: '800' }}>
                          💎{item.weeklyEarned ?? 0}
                        </Text>
                        <Text style={{ color: C.muted, fontSize: 11 }}>
                          {t('leaderboard.diamonds', { defaultValue: 'diamonds' })}
                        </Text>
                      </View>
                    </View>
                  )}
                />
        )}
      </View>
    </Modal>
  );
}
