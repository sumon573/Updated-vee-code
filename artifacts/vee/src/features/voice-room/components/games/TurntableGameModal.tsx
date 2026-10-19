/**
 * TurntableGameModal — IMO turntable port (2026-10-19).
 *
 * IMO evidence: voiceroom/playgames/turntable/ (TurnTableViewData, view,
 * setting), "Upgrade turntable" string, vr_turntable_result analytics.
 * Behavior ported; Vee's code.
 *
 * Host builds a 6-segment wheel; each segment has a label + an optional
 * catalog-gift prize. Members spin (limited spins each, atomic via
 * transaction). On landing on a prize segment, the HOST's client auto-sends
 * that gift to the winner through the normal gift pipeline
 * (VPS /wallet/send-gift → Firebase fallback): real diamonds, real 70/30
 * commission, zero minting. If the host can't fund it, the win is announced
 * without a prize and the reason is shown.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, Alert, Animated, Easing, TextInput } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import {
  createGame, endGame, subscribeGame, consumeSpin, recordSpinResult,
  type RoomGame, type TurntableSegment,
} from '../../services/roomGameService';
import { fetchGiftCatalog, type CatalogGift } from '../../services/giftCatalogService';
import { sendGift } from '@/src/features/wallet/walletService';
import { getErrorCause } from '@/src/utils/errorDisplay';

const SEGMENT_COLORS = ['#FF6B6B', '#FFA94D', '#FFD43B', '#69DB7C', '#4DABF7', '#B197FC'];
const DEFAULT_LABELS = ['1', '2', '3', '4', '5', '6'];

export function TurntableGameModal({ visible, roomId, hostUid, hostName, myUid, myName, isHost, onClose }: {
  visible: boolean;
  roomId: string;
  hostUid: string;
  hostName: string;
  myUid: string | null;
  myName: string;
  isHost: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [game, setGame] = useState<RoomGame | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  // setup state
  const [labels, setLabels] = useState<string[]>([...DEFAULT_LABELS]);
  const [prizeIdx, setPrizeIdx] = useState<Record<number, string | null>>({});
  const [catalog, setCatalog] = useState<CatalogGift[]>([]);
  const [pickingFor, setPickingFor] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  // play state
  const [spinning, setSpinning] = useState(false);
  const rotation = useRef(new Animated.Value(0)).current;
  const [lastRotation, setLastRotation] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setGameId(null); setGame(null);
    fetchGiftCatalog().then(setCatalog).catch(() => {});
  }, [visible]);

  useEffect(() => {
    if (!visible || !roomId || !gameId) return;
    return subscribeGame(roomId, gameId, setGame);
  }, [visible, roomId, gameId]);

  const segments: TurntableSegment[] = useMemo(() => {
    const src = game?.segments ?? labels.map((label, i) => ({
      label,
      giftId: prizeIdx[i] ?? null,
      giftName: (prizeIdx[i] ? catalog.find((g) => g.id === prizeIdx[i])?.name : undefined) ?? undefined,
    }));
    return src;
  }, [game, labels, prizeIdx, catalog]);

  const mySpinsUsed = game && myUid ? (game.spinsUsed?.[myUid] ?? 0) : 0;
  const maxSpins = game?.maxSpinsPerUser ?? 1;
  const spinsLeft = Math.max(0, maxSpins - mySpinsUsed);
  const lastResult = game?.lastResult ?? null;

  const startGame = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const segs: TurntableSegment[] = labels.map((label, i) => ({
        label: label.trim() || `${i + 1}`,
        giftId: prizeIdx[i] ?? null,
        giftName: (prizeIdx[i] ? catalog.find((g) => g.id === prizeIdx[i])?.name : undefined) ?? undefined,
      }));
      const id = await createGame(roomId, hostUid, hostName, {
        type: 'turntable', title: t('voiceRoom.games.turntableTitle'), segments: segs, maxSpinsPerUser: 1,
      });
      setGameId(id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert(t('voiceRoom.games.error'), getErrorCause(e));
    } finally {
      setStarting(false);
    }
  };

  const spin = async () => {
    if (!game || !myUid || spinning || spinsLeft <= 0) return;
    const ok = await consumeSpin(roomId, game.id, myUid, maxSpins);
    if (!ok) return;
    setSpinning(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    // Random segment; animate 5 full turns + offset to the segment center.
    const n = segments.length;
    const winnerIdx = Math.floor(Math.random() * n);
    const target = lastRotation + 360 * 5 + (360 - (winnerIdx * (360 / n) + (360 / n) / 2));
    Animated.timing(rotation, {
      toValue: target, duration: 3800, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start(async () => {
      setLastRotation(target % 360);
      rotation.setValue(target % 360);
      setSpinning(false);
      const result = { uid: myUid, name: myName, segmentIndex: winnerIdx, ts: Date.now() };
      await recordSpinResult(roomId, game.id, result).catch(() => {});
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // The prize gift is sent by the HOST's client (see effect above), so
      // the host — not the spinner — pays for it through the gift pipeline.
      const seg = segments[winnerIdx];
      if (seg?.giftId) {
        Alert.alert(
          t('voiceRoom.games.turntableWinTitle'),
          t('voiceRoom.games.turntableWinMsg', { name: myName, prize: seg.giftName || seg.label }),
        );
      } else {
        Alert.alert(t('voiceRoom.games.turntableWinTitle'), t('voiceRoom.games.turntableLanded', { label: seg?.label ?? '' }));
      }
    });
  };

  const spinDeg = rotation.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] });

  // Prize settlement: the HOST's client (and only the host's) sends the prize
  // gift to the winner through the normal gift pipeline when a new result
  // lands. Deduped by result timestamp so re-renders never double-send.
  const prizeSentFor = useRef<number>(0);
  useEffect(() => {
    const r = game?.lastResult;
    if (!r || !isHost || !game || prizeSentFor.current === r.ts) return;
    const seg = (game.segments ?? [])[r.segmentIndex];
    if (!seg?.giftId) return;
    prizeSentFor.current = r.ts;
    sendGift({ toUid: r.uid, giftId: seg.giftId, toName: r.name }).catch(() => {
      prizeSentFor.current = 0; // allow retry on next render
    });
  }, [game, isHost]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} onPress={onClose} />
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%', paddingBottom: 28,
      }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E5EA', alignSelf: 'center', marginTop: 10 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
          <Feather name="disc" size={18} color="#F59E0B" />
          <Text style={{ fontSize: 17, fontWeight: '800', color: '#000', marginLeft: 8, flex: 1 }}>
            {t('voiceRoom.games.type_turntable')}
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Feather name="x" size={22} color="#8E8E93" />
          </Pressable>
        </View>

        {/* ── SETUP ── */}
        {!game && isHost && (
          <ScrollView contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#000', marginBottom: 8 }}>
              {t('voiceRoom.games.turntableSetup')}
            </Text>
            {labels.map((lb, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: SEGMENT_COLORS[i % 6], alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
                  <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '900' }}>{i + 1}</Text>
                </View>
                <TextInput
                  value={lb}
                  onChangeText={(v) => setLabels((p) => p.map((x, j) => (j === i ? v : x)))}
                  placeholder={`${i + 1}`}
                  maxLength={12}
                  style={{ flex: 1, backgroundColor: '#F2F2F7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: '#000', marginRight: 8 }}
                />
                <Pressable
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPickingFor(pickingFor === i ? null : i); }}
                  style={{ backgroundColor: prizeIdx[i] ? '#E3F2FD' : '#F2F2F7', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9 }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '800', color: prizeIdx[i] ? '#007AFF' : '#8E8E93' }}>
                    {prizeIdx[i] ? (catalog.find((g) => g.id === prizeIdx[i])?.name ?? '🎁').slice(0, 10) : '🎁+'}
                  </Text>
                </Pressable>
              </View>
            ))}
            {pickingFor !== null && (
              <View style={{ backgroundColor: '#F2F2F7', borderRadius: 12, padding: 8, marginBottom: 8, maxHeight: 180 }}>
                <ScrollView showsVerticalScrollIndicator={false}>
                  <Pressable
                    onPress={() => { setPrizeIdx((p) => ({ ...p, [pickingFor]: null })); setPickingFor(null); }}
                    style={{ paddingVertical: 9, paddingHorizontal: 10 }}
                  >
                    <Text style={{ fontSize: 14, color: '#8E8E93' }}>{t('voiceRoom.games.noPrize')}</Text>
                  </Pressable>
                  {catalog.slice(0, 24).map((g) => (
                    <Pressable
                      key={g.id}
                      onPress={() => { setPrizeIdx((p) => ({ ...p, [pickingFor]: g.id })); setPickingFor(null); }}
                      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 10 }}
                    >
                      <Text style={{ flex: 1, fontSize: 14, color: '#000' }} numberOfLines={1}>{g.name}</Text>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: '#F59E0B' }}>💎{g.price}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
            <Text style={{ fontSize: 12, color: '#8E8E93', marginBottom: 12 }}>
              {t('voiceRoom.games.turntablePrizeNote')}
            </Text>
            <Pressable
              onPress={startGame}
              disabled={starting}
              style={{ borderRadius: 999, paddingVertical: 13, alignItems: 'center', backgroundColor: '#E3F2FD' }}
            >
              <Text style={{ fontSize: 15, fontWeight: '800', color: '#007AFF' }}>{t('voiceRoom.games.startGame')}</Text>
            </Pressable>
          </ScrollView>
        )}

        {/* ── PLAY ── */}
        {game && (
          <View style={{ padding: 16, alignItems: 'center' }}>
            {/* Wheel */}
            <View style={{ width: 240, height: 240, borderRadius: 120, overflow: 'hidden', backgroundColor: '#F2F2F7', borderWidth: 6, borderColor: '#F59E0B' }}>
              <Animated.View style={{ width: '100%', height: '100%', transform: [{ rotate: spinDeg }] }}>
                {segments.map((s, i) => {
                  const n = segments.length;
                  return (
                    <View
                      key={i}
                      style={{
                        position: 'absolute', width: 240, height: 240,
                        alignItems: 'center',
                        transform: [{ rotate: `${(i * 360) / n}deg` }],
                      }}
                    >
                      <View style={{
                        marginTop: 14, backgroundColor: SEGMENT_COLORS[i % 6], borderRadius: 999,
                        paddingHorizontal: 10, paddingVertical: 4,
                      }}>
                        <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '900' }} numberOfLines={1}>
                          {s.label}{s.giftId ? ' 🎁' : ''}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </Animated.View>
              {/* pointer */}
              <View style={{
                position: 'absolute', top: -2, left: '50%', marginLeft: -10,
                width: 0, height: 0, borderLeftWidth: 10, borderRightWidth: 10, borderTopWidth: 16,
                borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#FF3B30',
              }} />
            </View>

            {lastResult && (
              <Text style={{ marginTop: 10, fontSize: 14, fontWeight: '700', color: '#000' }}>
                {t('voiceRoom.games.lastSpin', { name: lastResult.name, label: segments[lastResult.segmentIndex]?.label ?? '' })}
              </Text>
            )}

            {game.status === 'active' ? (
              <Pressable
                onPress={spin}
                disabled={spinning || spinsLeft <= 0}
                style={{
                  marginTop: 14, borderRadius: 999, paddingVertical: 13, paddingHorizontal: 48,
                  backgroundColor: !spinning && spinsLeft > 0 ? '#E3F2FD' : '#F2F2F7',
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: '800', color: !spinning && spinsLeft > 0 ? '#007AFF' : '#8E8E93' }}>
                  {spinning ? t('voiceRoom.games.spinning') : t('voiceRoom.games.spinLeft', { n: spinsLeft })}
                </Text>
              </Pressable>
            ) : (
              <Text style={{ marginTop: 14, fontSize: 14, color: '#8E8E93' }}>{t('voiceRoom.games.ended')}</Text>
            )}

            {isHost && game.status === 'active' && (
              <Pressable
                onPress={() => endGame(roomId, game.id).catch(() => {})}
                style={{ marginTop: 10, paddingVertical: 8 }}
              >
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#FF3B30' }}>{t('voiceRoom.games.endGame')}</Text>
              </Pressable>
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
