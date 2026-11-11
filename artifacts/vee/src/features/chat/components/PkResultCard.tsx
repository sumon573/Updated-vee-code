import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { DiamondIcon } from '@/src/components/DiamondIcon';
import type { PkResultPayload, PkResultPerson } from '../types/dm';
import { formatPkFull } from '@/src/features/voice-room/services/roomPkService';
import { PkScore } from '@/src/features/voice-room/components/PkScore';

/**
 * PK result CARD rendered inside a DM bubble.
 *
 * 2026-11-11 (boss 23:49): a PK result shared to the inbox must show
 * professionally, as a card (with badge), never as plain text — the boss
 * saw "PK Result — Gεητℓεmαη✨ vs 0 0 ⭕➤...zain... ✨Gεητℓεmαη It's
 * a draw!" in the inbox and said it will not do. The card is the
 * PkResultPopup design scaled down for a chat bubble (max width
 * 0.78 × screen, like the call card): the same gradient, the same
 * professional winner treatment (gold ring + vector crown badge + gold
 * WINNER pill, never an emoji on the photo), clean bold scores
 * (PkScore — never the seven-segment LED), the margin row, the top
 * donor chip, and the room/duration line.
 *
 * Pure render — no hooks, no timers, no subscriptions, no taps
 * (display-only, like the room gift card; long-press menu still works
 * via MessageBubble). On a draw there is no winner treatment at all
 * (no gold ring, no crown, no WINNER pill, no margin row).
 */

const GRADIENT = ['#312E81', '#9333EA', '#EC4899'] as const;
const GOLD = '#FBC02D';
const GOLD_TEXT = '#713F12';
const LEADER = '#FDE68A';

function BattlerAvatar({
  person,
  isWinner,
  fallbackColor,
}: {
  person: PkResultPerson;
  isWinner: boolean;
  fallbackColor: string;
}) {
  return (
    <View style={{ position: 'relative', width: 52, height: 52 }}>
      {person.photoURL ? (
        <Image
          source={{ uri: person.photoURL }}
          style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            borderWidth: isWinner ? 3 : 2,
            borderColor: isWinner ? GOLD : '#FFFFFF',
            opacity: isWinner ? 1 : 0.92,
          }}
          contentFit="cover"
          cachePolicy="disk"
        />
      ) : (
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            backgroundColor: fallbackColor,
            borderWidth: isWinner ? 3 : 2,
            borderColor: isWinner ? GOLD : '#FFFFFF',
            opacity: isWinner ? 1 : 0.92,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800' }}>
            {(person.name || 'U').charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
      {isWinner && (
        <View
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            width: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: GOLD,
            borderWidth: 2,
            borderColor: '#FFFFFF',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <MaterialCommunityIcons name="crown" size={11} color={GOLD_TEXT} />
        </View>
      )}
    </View>
  );
}

export function PkResultCard({ payload }: { payload: PkResultPayload }) {
  const winnerUid = payload.draw ? null : payload.winnerUid;
  const challengerWon = winnerUid === payload.challenger.uid;
  const opponentWon = winnerUid === payload.opponent.uid;
  const challengerLeads = payload.challengerScore > payload.opponentScore;
  const opponentLeads = payload.opponentScore > payload.challengerScore;

  const battler = (person: PkResultPerson, isWinner: boolean, score: number, leads: boolean, fallbackColor: string) => (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <BattlerAvatar person={person} isWinner={isWinner} fallbackColor={fallbackColor} />
      {isWinner ? (
        <View
          style={{
            marginTop: 6,
            backgroundColor: GOLD,
            borderRadius: 999,
            paddingHorizontal: 7,
            paddingVertical: 2,
          }}>
          <Text style={{ color: GOLD_TEXT, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>
            WINNER
          </Text>
        </View>
      ) : (
        <View style={{ height: 24 }} />
      )}
      <Text
        style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800', lineHeight: 16, marginTop: 6, textAlign: 'center' }}
        numberOfLines={2}>
        {person.name}
      </Text>
      <View style={{ marginTop: 4 }}>
        <PkScore value={score} size={18} color={leads ? LEADER : '#FFFFFF'} />
      </View>
    </View>
  );

  return (
    <LinearGradient
      colors={GRADIENT}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ borderRadius: 16, padding: 14, width: '100%' }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        {battler(payload.challenger, challengerWon, payload.challengerScore, challengerLeads, '#7C3AED')}
        <View
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 10,
            paddingHorizontal: 8,
            paddingVertical: 6,
            marginHorizontal: 4,
            marginTop: 14,
          }}>
          <Text style={{ color: '#EC4899', fontSize: 15, fontWeight: '900', fontStyle: 'italic' }}>
            PK
          </Text>
        </View>
        {battler(payload.opponent, opponentWon, payload.opponentScore, opponentLeads, '#2563EB')}
      </View>
      {payload.draw && (
        <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '900', textAlign: 'center', marginTop: 10 }}>
          {"It's a draw!"}
        </Text>
      )}
      <Text
        style={{
          color: 'rgba(255,255,255,0.75)',
          fontSize: 11,
          fontWeight: '600',
          textAlign: 'center',
          marginTop: 10,
        }}
        numberOfLines={1}>
        {payload.roomName ? `${payload.roomName} • ` : ''}
        {payload.durationLabel} battle
      </Text>
      {!payload.draw && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 10,
            backgroundColor: 'rgba(255,255,255,0.14)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.28)',
            borderRadius: 12,
            paddingVertical: 7,
            paddingHorizontal: 10,
            gap: 6,
          }}>
          <DiamondIcon size={12} />
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' }}>
            Won by
          </Text>
          <Text style={{ color: LEADER, fontSize: 13, fontWeight: '900' }}>
            {formatPkFull(payload.margin)}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' }}>
            diamonds
          </Text>
        </View>
      )}
      {payload.topDonor && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 8,
            backgroundColor: 'rgba(255,255,255,0.10)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.22)',
            borderRadius: 12,
            paddingVertical: 6,
            paddingHorizontal: 10,
            gap: 7,
          }}>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' }}>
            Top donor:
          </Text>
          {payload.topDonor.photoURL ? (
            <Image
              source={{ uri: payload.topDonor.photoURL }}
              style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: '#FFFFFF' }}
              contentFit="cover"
              cachePolicy="disk"
            />
          ) : (
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: '#7C3AED',
                borderWidth: 1,
                borderColor: '#FFFFFF',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }}>
                {(payload.topDonor.name || 'U').charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800', flexShrink: 1 }} numberOfLines={1}>
            {payload.topDonor.name}
          </Text>
          <Text style={{ color: LEADER, fontSize: 12, fontWeight: '900' }}>
            {formatPkFull(payload.topDonor.total)}
          </Text>
        </View>
      )}
    </LinearGradient>
  );
}
