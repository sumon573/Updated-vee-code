import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, Pressable, Modal } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { C } from '../constants/theme';
import {
  subscribeRoomPk,
  challengeToPk,
  acceptPk,
  removePk,
  pkScoreOf,
  formatPkScore,
  PK_CHALLENGE_TIMEOUT_MS,
  type RoomPk,
} from '../services/roomPkService';
import type { Participant } from '../types/room';

/* ─────────────────────────── 1v1 PK Modal ─────────────────────────── */

/**
 * PkModal — 1v1 PK (2026-10-25, boss concept).
 * Two users battle; the audience sends diamonds (gifts) and the diamond
 * value is the score. Higher score wins when the 5-minute timer ends.
 * Scoring is done by the VPS scorer bot (giftFeed watcher) — this modal
 * only shows the battle and drives challenge/accept/decline.
 * Start: a seated user picks a seated opponent. The opponent accepts via
 * this modal (or the room's challenge alert). One PK per room at a time.
 */
export function PkModal({
  visible, onClose, roomId, myUid, myName, seats, isOwnerOrAdmin,
}: {
  visible: boolean;
  onClose: () => void;
  roomId: string;
  myUid: string;
  myName: string;
  seats: Array<Participant | null>;
  isOwnerOrAdmin: boolean;
}) {
  const [pk, setPk] = useState<RoomPk | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible || !roomId) return;
    return subscribeRoomPk(roomId, setPk);
  }, [visible, roomId]);

  useEffect(() => {
    if (!visible || pk?.status !== 'active') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [visible, pk?.status]);

  const act = async (fn: () => Promise<void>, errMsg: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Error', errMsg);
    } finally {
      setBusy(false);
    }
  };

  const opponents = seats.filter(
    (s): s is Participant => !!s && s.id !== myUid,
  );
  const iAmChallenger = pk?.challenger.uid === myUid;
  const iAmOpponent = pk?.opponent.uid === myUid;
  // Clearing a PK is control — owner/admin only (decline/cancel stay with
  // the opponent/challenger, which is participation, not control).
  const canClear = isOwnerOrAdmin;
  const challengeExpired =
    pk?.status === 'challenge' && Date.now() > pk.challengedAt + PK_CHALLENGE_TIMEOUT_MS;

  const challengerScore = pk ? pkScoreOf(pk, pk.challenger.uid) : 0;
  const opponentScore = pk ? pkScoreOf(pk, pk.opponent.uid) : 0;
  const totalScore = Math.max(1, challengerScore + opponentScore);
  const remainingMs = pk && pk.status === 'active' ? Math.max(0, pk.endsAt - now) : 0;
  const remainingText = `${Math.floor(remainingMs / 60000)}:${String(
    Math.floor((remainingMs % 60000) / 1000),
  ).padStart(2, '0')}`;
  const leader =
    challengerScore === opponentScore
      ? null
      : challengerScore > opponentScore
        ? pk!.challenger.name
        : pk!.opponent.name;

  const avatar = (name: string, color: string, size: number) => (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color || '#7C3AED',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={{ color: '#FFF', fontSize: size * 0.38, fontWeight: '800' }}>
        {(name || '?').slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );

  const seatOf = (uid: string) => seats.find((s) => s?.id === uid) ?? null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26,
        borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)', maxHeight: '88%' }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.muted,
          alignSelf: 'center', marginTop: 12, marginBottom: 4 }} />
        <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            <View style={{ width: 40, height: 40, borderRadius: 12,
              backgroundColor: 'rgba(239,68,68,0.15)',
              alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
              <Feather name="zap" size={18} color={C.red} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontSize: 18, fontWeight: '900' }}>1vs1 PK</Text>
              <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                Diamonds decide the winner
              </Text>
            </View>
            <Pressable onPress={onClose} style={{ padding: 6 }}>
              <Feather name="x" size={22} color={C.sub} />
            </Pressable>
          </View>

          {/* ── No PK: start (owner/admin only — boss rule) ── */}
          {!pk && (
            <>
              {!isOwnerOrAdmin ? (
                <Text style={{ color: C.muted, fontSize: 14, textAlign: 'center', paddingVertical: 24 }}>
                  Only the room owner/admin can start a PK.
                </Text>
              ) : opponents.length === 0 ? (
                <Text style={{ color: C.muted, fontSize: 14, textAlign: 'center', paddingVertical: 24 }}>
                  No one else is seated right now.
                </Text>
              ) : (
                <>
                  <Text style={{ color: C.sub, fontSize: 13, fontWeight: '700', marginBottom: 4 }}>
                    Challenge someone to a battle
                  </Text>
                  {opponents.map((s) => (
                    <Pressable
                      key={s.id}
                      disabled={busy}
                      onPress={() =>
                        act(
                          () => challengeToPk(roomId, { uid: myUid, name: myName }, { uid: s.id, name: s.name }),
                          'Could not send the challenge (a PK may already be running).',
                        )
                      }
                      style={{ flexDirection: 'row', alignItems: 'center',
                        paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.borderFaint }}>
                      {avatar(s.name, s.color, 40)}
                      <Text style={{ color: C.text, fontSize: 15, fontWeight: '700', flex: 1, marginLeft: 12 }}>
                        {s.name}
                      </Text>
                      <Text style={{ color: C.red, fontSize: 13, fontWeight: '800' }}>Challenge</Text>
                    </Pressable>
                  ))}
                </>
              )}
            </>
          )}

          {/* ── Challenge pending ── */}
          {pk?.status === 'challenge' && (
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <Text style={{ color: C.text, fontSize: 16, fontWeight: '800', textAlign: 'center' }}>
                {pk.challenger.name} challenged {pk.opponent.name}
              </Text>
              <Text style={{ color: C.muted, fontSize: 13, marginTop: 6, textAlign: 'center' }}>
                {challengeExpired
                  ? 'This challenge expired.'
                  : '5-minute battle — diamonds decide the winner.'}
              </Text>
              {iAmOpponent && !challengeExpired && (
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 18, width: '100%' }}>
                  <Pressable
                    onPress={() => act(() => removePk(roomId), 'Could not decline.')}
                    disabled={busy}
                    style={{ flex: 1, backgroundColor: C.card, borderRadius: 14,
                      paddingVertical: 13, alignItems: 'center',
                      borderWidth: 1, borderColor: C.borderFaint }}>
                    <Text style={{ color: C.sub, fontWeight: '800' }}>Decline</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => act(() => acceptPk(roomId), 'Could not accept.')}
                    disabled={busy}
                    style={{ flex: 2, backgroundColor: C.red, borderRadius: 14,
                      paddingVertical: 13, alignItems: 'center' }}>
                    <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 15 }}>Accept battle</Text>
                  </Pressable>
                </View>
              )}
              {iAmChallenger && !challengeExpired && (
                <>
                  <Text style={{ color: C.muted, fontSize: 13, marginTop: 10 }}>
                    Waiting for {pk.opponent.name}…
                  </Text>
                  <Pressable
                    onPress={() => act(() => removePk(roomId), 'Could not cancel.')}
                    disabled={busy}
                    style={{ marginTop: 16, backgroundColor: C.card, borderRadius: 14,
                      paddingVertical: 12, paddingHorizontal: 24, alignItems: 'center',
                      borderWidth: 1, borderColor: C.borderFaint }}>
                    <Text style={{ color: C.sub, fontWeight: '800' }}>Cancel</Text>
                  </Pressable>
                </>
              )}
              {challengeExpired && canClear && (
                <Pressable
                  onPress={() => act(() => removePk(roomId), 'Could not clear.')}
                  disabled={busy}
                  style={{ marginTop: 16, backgroundColor: C.card, borderRadius: 14,
                    paddingVertical: 12, paddingHorizontal: 24, alignItems: 'center',
                    borderWidth: 1, borderColor: C.borderFaint }}>
                  <Text style={{ color: C.sub, fontWeight: '800' }}>Clear</Text>
                </Pressable>
              )}
            </View>
          )}

          {/* ── Active battle ── */}
          {pk?.status === 'active' && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                <View style={{ flex: 1, alignItems: 'center' }}>
                  {avatar(pk.challenger.name, seatOf(pk.challenger.uid)?.color ?? '#7C3AED', 56)}
                  <Text numberOfLines={1} style={{ color: C.text, fontSize: 14, fontWeight: '800', marginTop: 8 }}>
                    {pk.challenger.name}
                  </Text>
                  <Text style={{ color: C.red, fontSize: 16, fontWeight: '900', marginTop: 2 }}>
                    {formatPkScore(challengerScore)}
                  </Text>
                </View>
                <View style={{ alignItems: 'center', paddingHorizontal: 8 }}>
                  <Text style={{ color: C.text, fontSize: 18, fontWeight: '900' }}>VS</Text>
                  <Text style={{ color: C.red, fontSize: 15, fontWeight: '800', marginTop: 4 }}>
                    {remainingMs > 0 ? remainingText : 'Ending…'}
                  </Text>
                </View>
                <View style={{ flex: 1, alignItems: 'center' }}>
                  {avatar(pk.opponent.name, seatOf(pk.opponent.uid)?.color ?? '#05B5FA', 56)}
                  <Text numberOfLines={1} style={{ color: C.text, fontSize: 14, fontWeight: '800', marginTop: 8 }}>
                    {pk.opponent.name}
                  </Text>
                  <Text style={{ color: C.red, fontSize: 16, fontWeight: '900', marginTop: 2 }}>
                    {formatPkScore(opponentScore)}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 12 }}>
                <View style={{ flex: challengerScore, backgroundColor: '#7C3AED' }} />
                <View style={{ flex: opponentScore, backgroundColor: '#05B5FA' }} />
              </View>
              <Text style={{ color: C.sub, fontSize: 13, fontWeight: '700', textAlign: 'center', marginTop: 10 }}>
                {leader ? `${leader} is leading` : 'Tie — every diamond counts'}
              </Text>
              <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 6 }}>
                Send gifts to your favorite — diamonds are the score.
              </Text>
              <Pressable
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onClose(); }}
                style={{ marginTop: 14, backgroundColor: C.red, borderRadius: 14,
                  paddingVertical: 13, alignItems: 'center' }}>
                <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 15 }}>
                  Send Gift
                </Text>
              </Pressable>
            </>
          )}

          {/* ── Ended ── */}
          {pk?.status === 'ended' && (
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <Text style={{ fontSize: 40 }}>👑</Text>
              <Text style={{ color: C.text, fontSize: 18, fontWeight: '900', marginTop: 8, textAlign: 'center' }}>
                {pk.draw
                  ? 'It\'s a draw!'
                  : `${pk.winnerUid === pk.challenger.uid ? pk.challenger.name : pk.opponent.name} wins!`}
              </Text>
              <Text style={{ color: C.sub, fontSize: 14, fontWeight: '700', marginTop: 8 }}>
                {pk.challenger.name} {formatPkScore(challengerScore)} — {formatPkScore(opponentScore)} {pk.opponent.name}
              </Text>
              {canClear && (
                <Pressable
                  onPress={() => act(() => removePk(roomId), 'Could not clear.')}
                  disabled={busy}
                  style={{ marginTop: 18, backgroundColor: C.card, borderRadius: 14,
                    paddingVertical: 12, paddingHorizontal: 24, alignItems: 'center',
                    borderWidth: 1, borderColor: C.borderFaint }}>
                  <Text style={{ color: C.sub, fontWeight: '800' }}>Clear</Text>
                </Pressable>
              )}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
