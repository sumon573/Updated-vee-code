import { useState, useEffect } from 'react';
import { View, Text, Pressable, Image } from 'react-native';
import { C } from '../constants/theme';
import {
  pkScoreOf,
  formatPkScore,
  type RoomPk,
} from '../services/roomPkService';
import { PkScoreBar } from './PkScoreBar';

/* ─────────────────────── Realtime PK banner ─────────────────────── */

/**
 * PkBanner — the imo-style PK strip every room member sees while a battle
 * runs (2026-10-25, boss screenshot): PK + live countdown, both battlers
 * with photo avatars + diamond scores, and the ANIMATED proportional
 * score bar (PkScoreBar — grows/shrinks live as diamonds land). Tap
 * opens the PK modal (details + gift + host cancel). Rendered for ALL
 * users, not just the battlers — the whole room watches live.
 */
export function PkBanner({
  pk,
  onPress,
  challengerPhotoURL,
  opponentPhotoURL,
}: {
  pk: RoomPk;
  onPress: () => void;
  challengerPhotoURL?: string | null;
  opponentPhotoURL?: string | null;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const challengerScore = pkScoreOf(pk, pk.challenger.uid);
  const opponentScore = pkScoreOf(pk, pk.opponent.uid);
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
          <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '800' }}>{remainingText}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {avatar(pk.challenger.name, '#7C3AED', challengerPhotoURL)}
            <Text numberOfLines={1} style={{ color: '#FFF', fontSize: 13, fontWeight: '700', flex: 1 }}>
              {pk.challenger.name}
            </Text>
            <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '900' }}>
              {formatPkScore(challengerScore)}
            </Text>
          </View>
          <Text style={{ color: C.muted, fontSize: 13, fontWeight: '800', paddingHorizontal: 10 }}>VS</Text>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
            <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '900' }}>
              {formatPkScore(opponentScore)}
            </Text>
            <Text numberOfLines={1} style={{ color: '#FFF', fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' }}>
              {pk.opponent.name}
            </Text>
            {avatar(pk.opponent.name, '#05B5FA', opponentPhotoURL)}
          </View>
        </View>
        <View style={{ marginTop: 8 }}>
          <PkScoreBar challengerScore={challengerScore} opponentScore={opponentScore} height={10} />
        </View>
      </View>
    </Pressable>
  );
}
