import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, Pressable, Modal, Image } from 'react-native';
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
  formatPkDuration,
  PK_CHALLENGE_TIMEOUT_MS,
  PK_DURATION_OPTIONS_MIN,
  type RoomPk,
} from '../services/roomPkService';
import type { Participant } from '../types/room';
import { PkScoreBar } from './PkScoreBar';

/* ─────────────────────────── 1v1 PK Modal ─────────────────────────── */

/**
 * PkModal — 1v1 PK (2026-10-25, boss concept + refinements).
 * Two users battle; the audience sends diamonds (gifts) and the diamond
 * value is the score. Higher score wins when the timer ends.
 * Scoring is done by the VPS scorer bot (giftFeed watcher) — this modal
 * only shows the battle and drives challenge/accept/decline/cancel.
 * BOSS RULES (peer PK, 2026-10-25): ANY seated user can challenge ANY
 * other seated user (NOT host-only — the old host-only gate was removed
 * when the boss reported only the host could PK); BOTH battlers must be
 * seated; the challenger picks the battle length (3/5/10 min) at start
 * and the room host (owner/admin) can cancel mid-battle (a battler can
 * never cancel to dodge a loss). One PK per room at a time.
 */
export function PkModal({
  visible, onClose, roomId, myUid, myName, mySeatIdx, seats, isOwnerOrAdmin,
}: {
  visible: boolean;
  onClose: () => void;
  roomId: string;
  myUid: string;
  myName: string;
  mySeatIdx: number;
  seats: Array<Participant | null>;
  isOwnerOrAdmin: boolean;
}) {
  const [pk, setPk] = useState<RoomPk | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [durationMin, setDurationMin] = useState(5);

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

  const avatar = (name: string, color: string, size: number, photoURL?: string | null) => {
    if (photoURL) {
      return (
        <Image
          source={{ uri: photoURL }}
          style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: '#FFF' }}
          resizeMode="cover"
        />
      );
    }
    return (
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
  };

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

          {/* ── No PK: start (any seated user + both battlers seated — boss rules) ── */}
          {!pk && (
            <>
              {mySeatIdx < 0 ? (
                <Text style={{ color: C.muted, fontSize: 14, textAlign: 'center', paddingVertical: 24 }}>
                  Take a seat to start a PK battle — both battlers must be seated.
                </Text>
              ) : opponents.length === 0 ? (
                <Text style={{ color: C.muted, fontSize: 14, textAlign: 'center', paddingVertical: 24 }}>
                  No one else is seated right now.
                </Text>
              ) : (
                <>
                  <Text style={{ color: C.sub, fontSize: 13, fontWeight: '700', marginBottom: 8 }}>
                    Battle length
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                    {PK_DURATION_OPTIONS_MIN.map((m) => (
                      <Pressable
                        key={m}
                        onPress={() => setDurationMin(m)}
                        style={{
                          flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center',
                          backgroundColor: durationMin === m ? C.red : C.card,
                          borderWidth: 1, borderColor: durationMin === m ? C.red : C.borderFaint,
                        }}>
                        <Text style={{ color: durationMin === m ? '#FFF' : C.sub, fontWeight: '800' }}>
                          {m} min
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={{ color: C.sub, fontSize: 13, fontWeight: '700', marginBottom: 4 }}>
                    Challenge someone to a battle
                  </Text>
                  {opponents.map((s) => (
                    <Pressable
                      key={s.id}
                      disabled={busy}
                      onPress={() =>
                        act(
                          () => challengeToPk(roomId, { uid: myUid, name: myName }, { uid: s.id, name: s.name }, durationMin * 60000),
                          'Could not send the challenge (a PK may already be running).',
                        )
                      }
                      style={{ flexDirection: 'row', alignItems: 'center',
                        paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.borderFaint }}>
                      {avatar(s.name, s.color, 40, s.photoURL)}
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
                  : `${formatPkDuration(pk)} battle — diamonds decide the winner.`}
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
                  {avatar(pk.challenger.name, seatOf(pk.challenger.uid)?.color ?? '#7C3AED', 56, seatOf(pk.challenger.uid)?.photoURL)}
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
                  {avatar(pk.opponent.name, seatOf(pk.opponent.uid)?.color ?? '#05B5FA', 56, seatOf(pk.opponent.uid)?.photoURL)}
                  <Text numberOfLines={1} style={{ color: C.text, fontSize: 14, fontWeight: '800', marginTop: 8 }}>
                    {pk.opponent.name}
                  </Text>
                  <Text style={{ color: C.red, fontSize: 16, fontWeight: '900', marginTop: 2 }}>
                    {formatPkScore(opponentScore)}
                  </Text>
                </View>
              </View>
              <View style={{ marginTop: 12 }}>
                <PkScoreBar challengerScore={challengerScore} opponentScore={opponentScore} height={10} />
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
              {/* Host-only mid-battle cancel (boss rule): ends the battle
                  with no winner. A battler can never cancel (no dodging). */}
              {isOwnerOrAdmin && (
                <Pressable
                  onPress={() =>
                    Alert.alert(
                      'Cancel PK?',
                      'The battle ends now with no winner and the scores are discarded.',
                      [
                        { text: 'Keep battle', style: 'cancel' },
                        {
                          text: 'Cancel PK',
                          style: 'destructive',
                          onPress: () => act(() => removePk(roomId), 'Could not cancel.'),
                        },
                      ],
                    )
                  }
                  disabled={busy}
                  style={{ marginTop: 10, backgroundColor: C.card, borderRadius: 14,
                    paddingVertical: 12, alignItems: 'center',
                    borderWidth: 1, borderColor: C.borderFaint }}>
                  <Text style={{ color: C.sub, fontWeight: '800' }}>Cancel PK</Text>
                </Pressable>
              )}
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
