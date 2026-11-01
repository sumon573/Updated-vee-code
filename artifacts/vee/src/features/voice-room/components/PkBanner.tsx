import { useState, useEffect } from 'react';
import { View, Text, Pressable, Image } from 'react-native';
import { C } from '../constants/theme';
import {
  pkScoreOf,
  formatPkScore,
  type RoomPk,
} from '../services/roomPkService';
import { PkScoreBar } from './PkScoreBar';
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

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const challengerScore = pkScoreOf(pk, pk.challenger.uid);
  const opponentScore = pkScoreOf(pk, pk.opponent.uid);
  const isChallenge = pk.status === 'challenge';
  // 2026-11-02 (PK real): ended branch — WIN crown badge on the winner's
  // avatar, final compact scores, centered Retry (battlers + host only).
  const isEnded = pk.status === 'ended';
  const winnerUid = isEnded && !pk.draw ? pk.winnerUid : null;
  const remainingMs = Math.max(0, pk.endsAt - now);
  const remainingText = `${Math.floor(remainingMs / 60000)}:${String(
    Math.floor((remainingMs % 60000) / 1000),
  ).padStart(2, '0')}`;

  const avatar = (name: string, color: string, photoURL?: string | null) => {
    if (photoURL) {
      return (
        <Image
          source={{ uri: photoURL }}
          style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: '#FFF' }}
          resizeMode="cover"
        />
      );
    }
    return (
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          backgroundColor: color,
          borderWidth: 2,
          borderColor: '#FFF',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '800' }}>
          {(name || '?').slice(0, 1).toUpperCase()}
        </Text>
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
            <View style={{ position: 'relative' }}>
              {avatar(pk.challenger.name, '#7C3AED', challengerPhotoURL)}
              {winnerUid === pk.challenger.uid && (
                <View style={{ position: 'absolute', top: -16, left: 0, right: 0, alignItems: 'center' }}>
                  <Text style={{ fontSize: 16 }}>👑</Text>
                  <Text style={{ color: '#FBC02D', fontSize: 9, fontWeight: '900' }}>WIN</Text>
                </View>
              )}
            </View>
            <Text numberOfLines={1} style={{ color: isChallengerKing ? KING_GOLD : '#FFF', fontSize: 13, fontWeight: '700', flex: 1 }}>
              {pk.challenger.name}
            </Text>
            {isChallengerKing ? <KingSparkle /> : null}
            <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '900' }}>
              {formatPkScore(challengerScore)}
            </Text>
          </View>
          <Text style={{ color: C.muted, fontSize: 13, fontWeight: '800', paddingHorizontal: 10 }}>VS</Text>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
            <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '900' }}>
              {formatPkScore(opponentScore)}
            </Text>
            <Text numberOfLines={1} style={{ color: isOpponentKing ? KING_GOLD : '#FFF', fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' }}>
              {pk.opponent.name}
            </Text>
            {isOpponentKing ? <KingSparkle /> : null}
            <View style={{ position: 'relative' }}>
              {avatar(pk.opponent.name, '#05B5FA', opponentPhotoURL)}
              {winnerUid === pk.opponent.uid && (
                <View style={{ position: 'absolute', top: -16, left: 0, right: 0, alignItems: 'center' }}>
                  <Text style={{ fontSize: 16 }}>👑</Text>
                  <Text style={{ color: '#FBC02D', fontSize: 9, fontWeight: '900' }}>WIN</Text>
                </View>
              )}
            </View>
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
