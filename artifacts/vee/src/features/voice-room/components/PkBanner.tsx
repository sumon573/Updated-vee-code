import { useState, useEffect } from 'react';
import { View, Text, Pressable, Image } from 'react-native';
import { C } from '../constants/theme';
import {
  pkScoreOf,
  type RoomPk,
} from '../services/roomPkService';
import { PkScoreBar } from './PkScoreBar';
import { PkScore } from './PkScore';
import { usePkBattlerPhotos } from './usePkBattlerPhotos';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useIsKing } from '@/src/hooks/useNobleRank';
import { KingSparkle, KING_GOLD } from './KingShimmerName';


/* ─────────────────────── Realtime PK banner ─────────────────────── */

/**
 * PkBanner — the imo-style PK strip every room member sees while a battle
 * runs (2026-10-25, boss screenshot): PK + live countdown, both battlers
 * with photo avatars + diamond scores, and the ANIMATED proportional
 * score bar (PkScoreBar — grows/shrinks live as diamonds land). Tap
 * opens the PK modal (details + gift + host cancel). Rendered for ALL
 * users, not just the battlers — the whole room watches live.
 * 2026-10-25 (boss: "room এ কিছুই দেখায় না"): the strip ALSO renders
 * for a PENDING challenge (names + "Waiting for …", no bar/countdown),
 * so the room sees the battle forming — not only the opponent's alert.
 */
export function PkBanner({
  pk,
  onPress,
  challengerPhotoURL,
  opponentPhotoURL,
  canRetry,
  onRetry,
}: {
  pk: RoomPk;
  onPress: () => void;
  challengerPhotoURL?: string | null;
  opponentPhotoURL?: string | null;
  /** Retry (rematch) is battlers + host only — audience sees no button. */
  canRetry?: boolean;
  onRetry?: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  // 2026-11-01 (batch56): King gold + shimmer on both PK names.
  const isChallengerKing = useIsKing(pk.challenger.uid);
  const isOpponentKing = useIsKing(pk.opponent.uid);

  // 1s ticker runs ONLY while the battle is active — the countdown is
  // the only thing that needs it (challenge/ended show static text, so
  // no wakeups there). Re-arms on challenge -> active.
  useEffect(() => {
    if (pk.status !== 'active') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pk.status]);

  const challengerScore = pkScoreOf(pk, pk.challenger.uid);
  const opponentScore = pkScoreOf(pk, pk.opponent.uid);
  const isChallenge = pk.status === 'challenge';
  // 2026-11-02 (PK real): ended branch — WINNER treatment on the winner's
  // avatar, final compact scores, centered Retry (battlers + host only).
  // 2026-11-11 (boss 23:00): the 👑 emoji + "WIN" overlay looked demo-type
  // and the seven-segment LED scores were not clearly readable — the winner
  // now gets a gold ring + vector crown badge, and the scores are clean
  // bold text (PkScore). DPs resolve from users/{uid}/photoURL when the
  // seat photo is missing (usePkBattlerPhotos).
  const isEnded = pk.status === 'ended';
  const winnerUid = isEnded && !pk.draw ? pk.winnerUid : null;
  const remainingMs = Math.max(0, pk.endsAt - now);
  // 2026-11-08 (PK realtime polish): when the clock hits 0 the bot still
  // needs its grace window to count late gifts before it writes the
  // winner (up to ~20s) — show an honest "Counting…" instead of a stuck
  // 0:00, so the wait reads as the battle finishing, not frozen.
  const isCounting = pk.status === 'active' && remainingMs === 0;
  const remainingText = isCounting
    ? 'Counting…'
    : `${Math.floor(remainingMs / 60000)}:${String(
        Math.floor((remainingMs % 60000) / 1000),
      ).padStart(2, '0')}`;
  // Leader's score glows gold so the room sees at a glance who is ahead.
  const leaderUid =
    challengerScore === opponentScore
      ? null
      : challengerScore > opponentScore
        ? pk.challenger.uid
        : pk.opponent.uid;

  // DPs resolve from users/{uid}/photoURL when the seat photo is missing
  // (a battler whose seat entry has no photoURL showed only an initial).
  const { challengerPhotoURL: challengerPhoto, opponentPhotoURL: opponentPhoto } =
    usePkBattlerPhotos(pk.challenger.uid, pk.opponent.uid, challengerPhotoURL, opponentPhotoURL);

  // Winner: gold ring + vector crown badge (never an emoji, never text on
  // the photo). Loser: plain white ring.
  const avatar = (name: string, color: string, photoURL?: string | null, isWinner?: boolean) => {
    const ringColor = isWinner ? '#FBC02D' : '#FFF';
    return (
      <View style={{ position: 'relative' }}>
        {photoURL ? (
          <Image
            source={{ uri: photoURL }}
            style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: ringColor }}
            resizeMode="cover"
          />
        ) : (
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: color,
              borderWidth: 2,
              borderColor: ringColor,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '800' }}>
              {(name || '?').slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
        {isWinner && (
          <View
            style={{
              position: 'absolute',
              top: -5,
              right: -5,
              width: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: '#FBC02D',
              borderWidth: 1.5,
              borderColor: '#FFF',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <MaterialCommunityIcons name="crown" size={10} color="#713F12" />
          </View>
        )}
      </View>
    );
  };

  return (
    <Pressable onPress={onPress}>
      <View
        style={{
          backgroundColor: '#241A4D',
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(239,68,68,0.45)',
          paddingHorizontal: 12,
          paddingVertical: 9,
        }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Text style={{ color: C.red, fontSize: 17, fontWeight: '900', fontStyle: 'italic' }}>PK</Text>
          {isChallenge ? (
            <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '800' }}>
              Waiting for {pk.opponent.name}…
            </Text>
          ) : isEnded ? (
            <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '800' }}>
              {pk.draw ? 'Draw' : 'Ended'}
            </Text>
          ) : (
            <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '800' }}>{remainingText}</Text>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {avatar(pk.challenger.name, '#7C3AED', challengerPhoto, winnerUid === pk.challenger.uid)}
            <Text numberOfLines={1} style={{ color: isChallengerKing ? KING_GOLD : '#FFF', fontSize: 13, fontWeight: '700', flex: 1 }}>
              {pk.challenger.name}
            </Text>
            {isChallengerKing ? <KingSparkle /> : null}
            <PkScore
              value={challengerScore}
              size={16}
              color={leaderUid === pk.challenger.uid ? '#FDE68A' : '#E2E8F0'}
            />
          </View>
          <Text style={{ color: C.muted, fontSize: 13, fontWeight: '800', paddingHorizontal: 10 }}>VS</Text>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
            <PkScore
              value={opponentScore}
              size={16}
              color={leaderUid === pk.opponent.uid ? '#FDE68A' : '#E2E8F0'}
            />
            <Text numberOfLines={1} style={{ color: isOpponentKing ? KING_GOLD : '#FFF', fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' }}>
              {pk.opponent.name}
            </Text>
            {isOpponentKing ? <KingSparkle /> : null}
            {avatar(pk.opponent.name, '#05B5FA', opponentPhoto, winnerUid === pk.opponent.uid)}
          </View>
        </View>
        {!isChallenge && (
          <View style={{ marginTop: 8 }}>
            <PkScoreBar challengerScore={challengerScore} opponentScore={opponentScore} height={10} />
          </View>
        )}
        {isEnded && canRetry && onRetry && (
          <Pressable
            onPress={onRetry}
            style={{ alignSelf: 'center', marginTop: 10, backgroundColor: '#EF4444', paddingVertical: 8, paddingHorizontal: 30, borderRadius: 999 }}>
            <Text style={{ color: '#FFF', fontWeight: '800' }}>Retry</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}
