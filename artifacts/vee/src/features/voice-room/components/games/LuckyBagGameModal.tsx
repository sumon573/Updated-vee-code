/**
 * LuckyBagGameModal — IMO lucky bag / jackpot port (2026-10-19).
 *
 * IMO evidence: voiceroom/playgames/luckybag/ (baglist, entrance, detail,
 * history, user, condition views), strings "Need [IMAGE]%s to join the game",
 * "If you close the game, the entrance fee in the Jackpot will be returned
 * to each …", vr_red_envelop_send/receive nearby. Behavior ported; Vee's code.
 *
 * Vee adaptation (wallet rules forbid arbitrary client-side jackpot payouts,
 * so everything moves through the real gift pipeline — no minting):
 *   • Host sets an entrance fee (a gift-price amount) + a jackpot gift.
 *   • Joining = sending that gift to the host (normal gift flow; the host
 *     receives the standard 70%).
 *   • Host draws a random winner; the host's client sends the jackpot gift
 *     to the winner through the normal gift pipeline.
 *   • If the host closes early, players keep what they sent (IMO returns
 *     fees — Vee's gift flow has no take-back; stated honestly in UI).
 */
import { useEffect, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import {
  createGame, subscribeGame, joinLuckyBag, drawLuckyWinner, deleteGame,
  type RoomGame,
} from '../../services/roomGameService';
import { fetchGiftCatalog, type CatalogGift } from '../../services/giftCatalogService';
import { sendGift } from '@/src/features/wallet/walletService';
import { DiamondIcon } from '@/src/components/DiamondIcon';
import { getErrorCause } from '@/src/utils/errorDisplay';

/** Entrance-fee options = gift-price amounts (wallet rules allow these debits). */
const FEE_OPTIONS = [10, 50, 100, 500, 1000, 2000];

export function LuckyBagGameModal({ visible, roomId, hostUid, hostName, myUid, myName, myPhotoURL, isHost, onClose }: {
  visible: boolean;
  roomId: string;
  hostUid: string;
  hostName: string;
  myUid: string | null;
  myName: string;
  myPhotoURL?: string | null;
  isHost: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [game, setGame] = useState<RoomGame | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  // setup
  const [fee, setFee] = useState(100);
  const [jackpotGiftId, setJackpotGiftId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogGift[]>([]);
  const [starting, setStarting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setGameId(null); setGame(null);
    fetchGiftCatalog().then(setCatalog).catch(() => {});
  }, [visible]);

  useEffect(() => {
    if (!visible || !roomId || !gameId) return;
    return subscribeGame(roomId, gameId, setGame);
  }, [visible, roomId, gameId]);

  const players = game?.players ?? {};
  const playerList = Object.entries(players);
  const amIn = myUid !== null && players[myUid] !== undefined;
  const jackpotGift = catalog.find((g) => g.id === game?.jackpotGiftId) ?? catalog.find((g) => g.id === jackpotGiftId);

  const startBag = async () => {
    if (starting || !jackpotGiftId) return;
    setStarting(true);
    try {
      const g = catalog.find((x) => x.id === jackpotGiftId);
      const id = await createGame(roomId, hostUid, hostName, {
        type: 'luckybag', title: t('voiceRoom.games.luckybagTitle'),
        entranceFee: fee, jackpotGiftId, jackpotGiftName: g?.name ?? '',
      });
      setGameId(id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert(t('voiceRoom.games.error'), getErrorCause(e));
    } finally {
      setStarting(false);
    }
  };

  /** Join: pay the entrance fee as a GIFT to the host (real gift pipeline). */
  const join = async () => {
    if (!game || !myUid || joining || amIn) return;
    setJoining(true);
    try {
      // Find a catalog gift priced exactly at the fee; fall back to any gift
      // the fee can cover is wrong — the fee IS the gift price by design.
      const feeGift = catalog.find((g) => g.price === game.entranceFee && g.active);
      if (!feeGift) throw new Error(t('voiceRoom.games.noFeeGift'));
      await sendGift({ toUid: game.hostUid, giftId: feeGift.id, toName: game.hostName, price: game.entranceFee });
      await joinLuckyBag(roomId, game.id, myUid, { name: myName, photoURL: myPhotoURL ?? null, ts: Date.now() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert(t('voiceRoom.games.error'), getErrorCause(e));
    } finally {
      setJoining(false);
    }
  };

  /** Host draws: random winner → jackpot gift sent to the winner. */
  const draw = async () => {
    if (!game || drawing) return;
    setDrawing(true);
    try {
      const winner = await drawLuckyWinner(roomId, game.id);
      if (!winner) {
        Alert.alert(t('voiceRoom.games.error'), t('voiceRoom.games.noPlayers'));
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (game.jackpotGiftId) {
        await sendGift({ toUid: winner.uid, giftId: game.jackpotGiftId, toName: winner.name }).catch(() => {});
      }
      Alert.alert(t('voiceRoom.games.luckyWinnerTitle'), t('voiceRoom.games.luckyWinnerMsg', { name: winner.name }));
    } catch (e) {
      Alert.alert(t('voiceRoom.games.error'), getErrorCause(e));
    } finally {
      setDrawing(false);
    }
  };

  const closeEarly = async () => {
    if (!game) return;
    Alert.alert(t('voiceRoom.games.closeBagTitle'), t('voiceRoom.games.closeBagMsg'), [
      { text: t('voiceRoom.games.cancel'), style: 'cancel' },
      {
        text: t('voiceRoom.games.closeBag'), style: 'destructive',
        onPress: async () => { await deleteGame(roomId, game.id).catch(() => {}); onClose(); },
      },
    ]);
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
          <Feather name="gift" size={18} color="#FF3B30" />
          <Text style={{ fontSize: 17, fontWeight: '800', color: '#000', marginLeft: 8, flex: 1 }}>
            {t('voiceRoom.games.type_luckybag')}
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Feather name="x" size={22} color="#8E8E93" />
          </Pressable>
        </View>

        {/* ── SETUP ── */}
        {!game && isHost && (
          <ScrollView contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#000', marginBottom: 8 }}>
              {t('voiceRoom.games.feeLabel')}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {FEE_OPTIONS.map((f) => (
                <Pressable
                  key={f}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFee(f); }}
                  style={{
                    borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9,
                    backgroundColor: fee === f ? '#E3F2FD' : '#F2F2F7',
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <DiamondIcon size={14} />
                    <Text style={{ fontSize: 14, fontWeight: '800', color: fee === f ? '#007AFF' : '#8E8E93', marginLeft: 3 }}>{f}</Text>
                  </View>
                </Pressable>
              ))}
            </View>

            <Text style={{ fontSize: 14, fontWeight: '700', color: '#000', marginBottom: 8 }}>
              {t('voiceRoom.games.jackpotLabel')}
            </Text>
            <View style={{ maxHeight: 220, backgroundColor: '#F2F2F7', borderRadius: 12, padding: 6, marginBottom: 8 }}>
              <ScrollView showsVerticalScrollIndicator={false}>
                {catalog.slice(0, 24).map((g) => {
                  const on = jackpotGiftId === g.id;
                  return (
                    <Pressable
                      key={g.id}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setJackpotGiftId(g.id); }}
                      style={{
                        flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 10,
                        borderRadius: 8, backgroundColor: on ? '#E3F2FD' : 'transparent',
                      }}
                    >
                      <Text style={{ flex: 1, fontSize: 14, fontWeight: on ? '800' : '400', color: on ? '#007AFF' : '#000' }} numberOfLines={1}>
                        {g.name}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <DiamondIcon size={13} />
                        <Text style={{ fontSize: 13, fontWeight: '800', color: '#F59E0B', marginLeft: 3 }}>{g.price}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
            <Text style={{ fontSize: 12, color: '#8E8E93', marginBottom: 12 }}>
              {t('voiceRoom.games.luckybagNote')}
            </Text>
            <Pressable
              onPress={startBag}
              disabled={starting || !jackpotGiftId}
              style={{ borderRadius: 999, paddingVertical: 13, alignItems: 'center', backgroundColor: jackpotGiftId ? '#E3F2FD' : '#F2F2F7' }}
            >
              {starting ? <ActivityIndicator size="small" color="#007AFF" /> : (
                <Text style={{ fontSize: 15, fontWeight: '800', color: jackpotGiftId ? '#007AFF' : '#8E8E93' }}>
                  {t('voiceRoom.games.startGame')}
                </Text>
              )}
            </Pressable>
          </ScrollView>
        )}

        {/* ── PLAY ── */}
        {game && (
          <View style={{ padding: 16 }}>
            <View style={{ alignItems: 'center', backgroundColor: '#FFF7ED', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: '#FDBA74' }}>
              <Text style={{ fontSize: 44 }}>🧧</Text>
              <Text style={{ fontSize: 16, fontWeight: '900', color: '#000', marginTop: 6 }}>
                {t('voiceRoom.games.jackpot')}: {jackpotGift?.name ?? game.jackpotGiftName ?? ''}
              </Text>
              <Text style={{ fontSize: 13, color: '#8E8E93', marginTop: 4 }}>
                {t('voiceRoom.games.feePlayers', { fee: game.entranceFee, n: playerList.length })}
              </Text>
            </View>

            {game.status === 'ended' && game.winnerName ? (
              <View style={{ alignItems: 'center', marginTop: 14 }}>
                <Text style={{ fontSize: 40 }}>🏆</Text>
                <Text style={{ fontSize: 18, fontWeight: '900', color: '#000', marginTop: 6 }}>{game.winnerName}</Text>
                <Text style={{ fontSize: 13, color: '#8E8E93', marginTop: 4 }}>{t('voiceRoom.games.luckyWinnerMsg', { name: game.winnerName })}</Text>
              </View>
            ) : (
              <View style={{ marginTop: 14 }}>
                <ScrollView style={{ maxHeight: 180 }} showsVerticalScrollIndicator={false}>
                  {playerList.length === 0 ? (
                    <Text style={{ textAlign: 'center', color: '#8E8E93', fontSize: 13, paddingVertical: 12 }}>
                      {t('voiceRoom.games.noPlayersYet')}
                    </Text>
                  ) : (
                    playerList.map(([uid, p]) => (
                      <View key={uid} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: '#E5E5EA' }}>
                        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#FF3B3022', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                          <Feather name="user" size={16} color="#FF3B30" />
                        </View>
                        <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: '#000' }} numberOfLines={1}>{p.name}</Text>
                        {uid === myUid && <Text style={{ fontSize: 12, color: '#007AFF', fontWeight: '800' }}>{t('voiceRoom.games.you')}</Text>}
                      </View>
                    ))
                  )}
                </ScrollView>

                {!isHost && !amIn && myUid && (
                  <Pressable
                    onPress={join}
                    disabled={joining}
                    style={{ marginTop: 12, borderRadius: 999, paddingVertical: 13, alignItems: 'center', backgroundColor: '#E3F2FD' }}
                  >
                    {joining ? <ActivityIndicator size="small" color="#007AFF" /> : (
                      <Text style={{ fontSize: 15, fontWeight: '800', color: '#007AFF' }}>
                        {t('voiceRoom.games.joinFee', { fee: game.entranceFee })}
                      </Text>
                    )}
                  </Pressable>
                )}
                {!isHost && amIn && (
                  <Text style={{ textAlign: 'center', marginTop: 12, fontSize: 13, fontWeight: '700', color: '#22C55E' }}>
                    {t('voiceRoom.games.youAreIn')}
                  </Text>
                )}
                {isHost && (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                    <Pressable
                      onPress={draw}
                      disabled={drawing || playerList.length === 0}
                      style={{ flex: 1, borderRadius: 999, paddingVertical: 13, alignItems: 'center', backgroundColor: playerList.length > 0 ? '#E3F2FD' : '#F2F2F7' }}
                    >
                      {drawing ? <ActivityIndicator size="small" color="#007AFF" /> : (
                        <Text style={{ fontSize: 15, fontWeight: '800', color: playerList.length > 0 ? '#007AFF' : '#8E8E93' }}>
                          {t('voiceRoom.games.drawWinner')}
                        </Text>
                      )}
                    </Pressable>
                    <Pressable
                      onPress={closeEarly}
                      style={{ borderRadius: 999, paddingVertical: 13, paddingHorizontal: 18, backgroundColor: '#FFE5E5' }}
                    >
                      <Text style={{ fontSize: 14, fontWeight: '800', color: '#FF3B30' }}>{t('voiceRoom.games.closeBag')}</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {!game && !isHost && (
          <Text style={{ textAlign: 'center', color: '#8E8E93', fontSize: 14, padding: 24 }}>
            {t('voiceRoom.games.waitingHost')}
          </Text>
        )}
      </View>
    </Modal>
  );
}
