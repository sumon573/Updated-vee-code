/**
 * VoteGameModal — IMO vote game port (2026-10-19).
 *
 * IMO behavior (strings): "Host started a gift voting. Show support for your
 * favorite participants and vote by gifting" — votes ARE gift diamonds.
 * "Voting ends soon. Tap to vote!" / "Vote Result" / "Voted for %s".
 *
 * Vee: host picks seated candidates → members vote by sending gifts to
 * candidates through the normal gift flow (zero gift-flow changes) → live
 * tally from rooms/{roomId}/giftEvents → host ends → winner banner.
 */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import {
  createGame, endGame, subscribeGame, subscribeVoteTally,
  type RoomGame, type GameCandidate, type VoteTally,
} from '../../services/roomGameService';
import { getErrorCause } from '@/src/utils/errorDisplay';

export interface SeatPerson {
  uid: string;
  name: string;
  photoURL?: string | null;
  color?: string;
  initials?: string;
}

function fmtCompact(n: number): string {
  if (n >= 999_500_000) return `${parseFloat((n / 1_000_000_000).toFixed(1))}b`;
  if (n >= 999_500) return `${parseFloat((n / 1_000_000).toFixed(1))}m`;
  if (n >= 999.5) return `${parseFloat((n / 1_000).toFixed(1))}k`;
  return `${n}`;
}

export function VoteGameModal({ visible, roomId, hostUid, hostName, seats, gameId, isHost, onClose, onOpenGifts }: {
  visible: boolean;
  roomId: string;
  hostUid: string;
  hostName: string;
  /** seated members to pick candidates from */
  seats: SeatPerson[];
  /** existing game id, or null to show host setup */
  gameId: string | null;
  isHost: boolean;
  onClose: () => void;
  /** open the gift panel so the viewer can vote by gifting */
  onOpenGifts: () => void;
}) {
  const { t } = useTranslation();
  const [game, setGame] = useState<RoomGame | null>(null);
  const [tally, setTally] = useState<VoteTally[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!visible || !roomId || !gameId) { setGame(null); return; }
    return subscribeGame(roomId, gameId, setGame);
  }, [visible, roomId, gameId]);

  useEffect(() => {
    if (!game || game.type !== 'vote') { setTally([]); return; }
    return subscribeVoteTally(roomId, game, setTally);
  }, [roomId, game]);

  const ranked = useMemo(() => {
    const list = (game?.candidates ?? []).map((c) => ({
      ...c,
      coins: tally.find((x) => x.uid === c.uid)?.coins ?? 0,
    }));
    return list.sort((a, b) => b.coins - a.coins);
  }, [game, tally]);

  const maxCoins = Math.max(1, ...ranked.map((r) => r.coins));

  const startVote = async () => {
    if (picked.size < 2 || starting) return;
    setStarting(true);
    try {
      const candidates: GameCandidate[] = seats
        .filter((s) => picked.has(s.uid))
        .map((s) => ({ uid: s.uid, name: s.name, photoURL: s.photoURL ?? null }));
      await createGame(roomId, hostUid, hostName, {
        type: 'vote', title: t('voiceRoom.games.voteTitle'), candidates, endsAt: null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (e) {
      Alert.alert(t('voiceRoom.games.error'), getErrorCause(e));
    } finally {
      setStarting(false);
    }
  };

  const finishVote = async () => {
    if (!game) return;
    Alert.alert(t('voiceRoom.games.endVoteTitle'), t('voiceRoom.games.endVoteMsg'), [
      { text: t('voiceRoom.games.cancel'), style: 'cancel' },
      {
        text: t('voiceRoom.games.endVote'), style: 'destructive',
        onPress: async () => {
          const winner = ranked[0];
          await endGame(roomId, game.id, winner?.uid ?? null, winner?.name ?? null).catch(() => {});
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        },
      },
    ]);
  };

  const toggle = (uid: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} onPress={onClose} />
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', paddingBottom: 28,
      }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E5EA', alignSelf: 'center', marginTop: 10 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
          <Feather name="bar-chart-2" size={18} color="#05b5fa" />
          <Text style={{ fontSize: 17, fontWeight: '800', color: '#000', marginLeft: 8, flex: 1 }}>
            {t('voiceRoom.games.type_vote')}
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Feather name="x" size={22} color="#8E8E93" />
          </Pressable>
        </View>

        {/* ── SETUP (host, no game yet) ── */}
        {!game && (
          <View style={{ padding: 16 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#000', marginBottom: 10 }}>
              {t('voiceRoom.games.pickCandidates')}
            </Text>
            <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
              {seats.map((s) => {
                const on = picked.has(s.uid);
                return (
                  <Pressable
                    key={s.uid}
                    onPress={() => toggle(s.uid)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
                      borderBottomWidth: 0.5, borderBottomColor: '#E5E5EA',
                    }}
                  >
                    <View style={{
                      width: 40, height: 40, borderRadius: 20, backgroundColor: (s.color || '#05b5fa') + '22',
                      alignItems: 'center', justifyContent: 'center', marginRight: 12,
                    }}>
                      <Text style={{ color: s.color || '#05b5fa', fontSize: 14, fontWeight: '800' }}>{s.initials || '?'}</Text>
                    </View>
                    <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: '#000' }} numberOfLines={1}>{s.name}</Text>
                    <View style={{
                      width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: on ? '#007AFF' : '#F2F2F7',
                    }}>
                      {on && <Feather name="check" size={15} color="#FFF" />}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              onPress={startVote}
              disabled={picked.size < 2 || starting}
              style={{
                marginTop: 14, borderRadius: 999, paddingVertical: 13, alignItems: 'center',
                backgroundColor: picked.size >= 2 ? '#E3F2FD' : '#F2F2F7',
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '800', color: picked.size >= 2 ? '#007AFF' : '#8E8E93' }}>
                {t('voiceRoom.games.startVote', { n: picked.size })}
              </Text>
            </Pressable>
          </View>
        )}

        {/* ── LIVE / ENDED ── */}
        {game && (
          <View style={{ padding: 16 }}>
            {game.status === 'ended' && game.winnerName ? (
              <View style={{ alignItems: 'center', backgroundColor: '#FFFBEB', borderRadius: 16, padding: 20, marginBottom: 12, borderWidth: 1, borderColor: '#FDE68A' }}>
                <Text style={{ fontSize: 40 }}>🏆</Text>
                <Text style={{ fontSize: 18, fontWeight: '900', color: '#000', marginTop: 8 }}>{game.winnerName}</Text>
                <Text style={{ fontSize: 13, color: '#8E8E93', marginTop: 4 }}>{t('voiceRoom.games.voteWinner')}</Text>
              </View>
            ) : (
              <View style={{ backgroundColor: '#E3F2FD', borderRadius: 12, padding: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center' }}>
                <Feather name="gift" size={16} color="#007AFF" />
                <Text style={{ flex: 1, marginLeft: 8, fontSize: 13, fontWeight: '600', color: '#007AFF' }}>
                  {t('voiceRoom.games.voteHint')}
                </Text>
                <Pressable
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onOpenGifts(); }}
                  style={{ backgroundColor: '#007AFF', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}
                >
                  <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '800' }}>{t('voiceRoom.games.voteNow')}</Text>
                </Pressable>
              </View>
            )}

            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
              {ranked.map((c, i) => (
                <View key={c.uid} style={{ marginBottom: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: i === 0 ? '#F59E0B' : '#8E8E93', width: 28 }}>{i + 1}</Text>
                    <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: '#000' }} numberOfLines={1}>
                      {c.name}{i === 0 && c.coins > 0 ? ' 👑' : ''}
                    </Text>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: '#F59E0B' }}>💎{fmtCompact(c.coins)}</Text>
                  </View>
                  <View style={{ height: 8, borderRadius: 4, backgroundColor: '#F2F2F7', overflow: 'hidden' }}>
                    <View style={{
                      height: 8, borderRadius: 4, backgroundColor: i === 0 ? '#F59E0B' : '#05b5fa',
                      width: `${Math.round((c.coins / maxCoins) * 100)}%`,
                    }} />
                  </View>
                </View>
              ))}
            </ScrollView>

            {isHost && game.status === 'active' && (
              <Pressable
                onPress={finishVote}
                style={{ marginTop: 12, borderRadius: 999, paddingVertical: 13, alignItems: 'center', backgroundColor: '#FFE5E5' }}
              >
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#FF3B30' }}>{t('voiceRoom.games.endVote')}</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}
