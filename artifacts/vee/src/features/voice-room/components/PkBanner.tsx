import { useState, useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import { C } from '../constants/theme';
import {
  pkScoreOf,
  formatPkScore,
  type RoomPk,
} from '../services/roomPkService';

/* ─────────────────────── Realtime PK banner ─────────────────────── */

/**
 * PkBanner — the imo-style PK strip every room member sees while a battle
 * runs (2026-10-25, boss screenshot): PK + live countdown, both battlers
 * with their diamond scores, and the proportional score bar. Tap opens
 * the PK modal (details + gift + host cancel). Rendered for ALL users,
 * not just the battlers — the whole room watches the competition live.
 */
export function PkBanner({ pk, onPress }: { pk: RoomPk; onPress: () => void }) {
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

  const avatar = (name: string, color: string) => (
    <View
      style={{
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '800' }}>
        {(name || '?').slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );

  return (
    <Pressable onPress={onPress}>
      <View
        style={{
          backgroundColor: '#2A1A4A',
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(239,68,68,0.45)',
          paddingHorizontal: 10,
          paddingVertical: 7,
        }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Text style={{ color: C.red, fontSize: 14, fontWeight: '900', fontStyle: 'italic' }}>PK</Text>
          <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '800' }}>{remainingText}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {avatar(pk.challenger.name, '#7C3AED')}
            <Text numberOfLines={1} style={{ color: '#FFF', fontSize: 12.5, fontWeight: '700', flex: 1 }}>
              {pk.challenger.name}
            </Text>
            <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '800' }}>
              {formatPkScore(challengerScore)}
            </Text>
          </View>
          <Text style={{ color: C.muted, fontSize: 12, fontWeight: '800', paddingHorizontal: 8 }}>VS</Text>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
            <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '800' }}>
              {formatPkScore(opponentScore)}
            </Text>
            <Text numberOfLines={1} style={{ color: '#FFF', fontSize: 12.5, fontWeight: '700', flex: 1, textAlign: 'right' }}>
              {pk.opponent.name}
            </Text>
            {avatar(pk.opponent.name, '#05B5FA')}
          </View>
        </View>
        <View style={{ flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 6 }}>
          <View style={{ flex: challengerScore, backgroundColor: '#7C3AED' }} />
          <View style={{ flex: opponentScore, backgroundColor: '#05B5FA' }} />
        </View>
      </View>
    </Pressable>
  );
}
