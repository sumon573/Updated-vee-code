import { useState } from 'react';
import { View, Text, Pressable, Modal, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { DiamondIcon } from '@/src/components/DiamondIcon';
import {
  pkScoreOf,
  pkTopDonor,
  pkMarginOf,
  formatPkScore,
  formatPkFull,
  formatPkDuration,
  type RoomPk,
} from '../services/roomPkService';
import { PkScore } from './PkScore';
import { usePkBattlerPhotos } from './usePkBattlerPhotos';
import { PkShareSheet } from './PkShareSheet';

/* ─────────────────────── 1v1 PK result popup ─────────────────────── */

/**
 * PkResultPopup — the end-of-battle result card (2026-11-02, PK real,
 * boss screenshot form): gradient card, X close, two avatars facing off
 * with the PK emblem centered between them, winner treatment on the
 * winner's avatar, name + clean score per side, margin row, "Top donor"
 * line, full-width Share button. All art is Vee-original shapes/text —
 * no reference-app assets. Purely presentational (no timers, no
 * subscriptions): the caller passes a frozen ended snapshot, so the card
 * survives the bot's 3-minute ended-node cleanup.
 * 2026-11-11 (boss 23:00 — polish): the 👑 emoji + "WIN" text slapped on
 * the winner's photo looked demo-type → gold ring + vector crown badge +
 * gold WINNER pill, nothing covering the face. The seven-segment LED
 * scores were not clearly readable → clean bold text (PkScore).
 * SUPERSEDES the 2026-11-11 digital LED (OTA 01a1cb3f): no seven-segment
 * digits remain anywhere in the PK. Names wrap to 2 lines instead of
 * cutting off mid-word. New: margin row ("Won by 753,500 diamonds") and
 * the room/duration line. Share opens PkShareSheet (send to inbox
 * friends + the old system share) instead of the system sheet directly.
 */
export function PkResultPopup({
  visible,
  onClose,
  pk,
  challengerPhotoURL,
  opponentPhotoURL,
  roomName,
  myUid,
  myName,
}: {
  visible: boolean;
  onClose: () => void;
  pk: RoomPk | null;
  challengerPhotoURL?: string | null;
  opponentPhotoURL?: string | null;
  roomName?: string;
  /** Needed by the Share sheet (inbox send). */
  myUid: string;
  /** Needed by the Share sheet (inbox send). */
  myName: string;
}) {
  const [shareOpen, setShareOpen] = useState(false);

  // DPs resolve from users/{uid}/photoURL when the seat photo is missing
  // (a battler whose seat entry has no photoURL showed only an initial).
  const { challengerPhotoURL: challengerPhoto, opponentPhotoURL: opponentPhoto } =
    usePkBattlerPhotos(
      pk?.challenger.uid ?? '',
      pk?.opponent.uid ?? '',
      challengerPhotoURL,
      opponentPhotoURL,
    );

  if (!pk) return null;

  const challengerScore = pkScoreOf(pk, pk.challenger.uid);
  const opponentScore = pkScoreOf(pk, pk.opponent.uid);
  const winnerUid = !pk.draw ? pk.winnerUid : null;
  const topDonor = pkTopDonor(pk);
  const margin = pkMarginOf(pk);

  // Winner: gold ring + vector crown badge (never an emoji, never text on
  // the photo). Loser: plain white ring, slightly dimmed.
  const avatar = (name: string, color: string, photoURL?: string | null, isWinner?: boolean) => (
    <View style={{ position: 'relative', alignItems: 'center', opacity: isWinner ? 1 : 0.92 }}>
      {photoURL ? (
        <Image
          source={{ uri: photoURL }}
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            borderWidth: isWinner ? 3 : 2,
            borderColor: isWinner ? '#FBC02D' : '#FFF',
          }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: color,
            borderWidth: isWinner ? 3 : 2,
            borderColor: isWinner ? '#FBC02D' : '#FFF',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Text style={{ color: '#FFF', fontSize: 22, fontWeight: '800' }}>
            {(name || '?').slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}
      {isWinner && (
        <View
          style={{
            position: 'absolute',
            top: -7,
            right: -7,
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: '#FBC02D',
            borderWidth: 2,
            borderColor: '#FFF',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <MaterialCommunityIcons name="crown" size={13} color="#713F12" />
        </View>
      )}
    </View>
  );

  // Gold WINNER pill under the winner's avatar (28px slot incl. margin —
  // the loser gets an empty spacer of the same height so names/scores align).
  const winnerPill = (isWinner?: boolean) =>
    isWinner ? (
      <View
        style={{
          marginTop: 8,
          backgroundColor: '#FBC02D',
          borderRadius: 999,
          paddingHorizontal: 9,
          paddingVertical: 3,
        }}>
        <Text style={{ color: '#713F12', fontSize: 10, fontWeight: '900', letterSpacing: 1 }}>
          WINNER
        </Text>
      </View>
    ) : (
      <View style={{ height: 28 }} />
    );

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}
        onPress={onClose}>
        <Pressable onPress={() => {}} style={{ width: '86%', maxWidth: 380 }}>
          <LinearGradient
            colors={['#312E81', '#9333EA', '#EC4899']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: 24, padding: 20, paddingTop: 26 }}>
            <Pressable
              onPress={onClose}
              style={{ position: 'absolute', top: 10, right: 12, padding: 4, zIndex: 1 }}>
              <Feather name="x" size={22} color="#FFF" />
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 8 }}>
              <View style={{ flex: 1, alignItems: 'center' }}>
                {avatar(pk.challenger.name, '#7C3AED', challengerPhoto, winnerUid === pk.challenger.uid)}
                {winnerPill(winnerUid === pk.challenger.uid)}
                <Text numberOfLines={2} style={{ color: '#FFF', fontSize: 13, fontWeight: '800', marginTop: 8, textAlign: 'center', lineHeight: 17 }}>
                  {pk.challenger.name}
                </Text>
                <View style={{ marginTop: 5 }}>
                  <PkScore
                    value={challengerScore}
                    size={22}
                    color={challengerScore > opponentScore ? '#FDE68A' : '#FFFFFF'}
                  />
                </View>
              </View>
              <View
                style={{
                  backgroundColor: '#FFF',
                  borderRadius: 14,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  marginHorizontal: 6,
                  marginTop: 18,
                }}>
                <Text style={{ color: '#EC4899', fontSize: 20, fontWeight: '900', fontStyle: 'italic' }}>
                  PK
                </Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center' }}>
                {avatar(pk.opponent.name, '#05B5FA', opponentPhoto, winnerUid === pk.opponent.uid)}
                {winnerPill(winnerUid === pk.opponent.uid)}
                <Text numberOfLines={2} style={{ color: '#FFF', fontSize: 13, fontWeight: '800', marginTop: 8, textAlign: 'center', lineHeight: 17 }}>
                  {pk.opponent.name}
                </Text>
                <View style={{ marginTop: 5 }}>
                  <PkScore
                    value={opponentScore}
                    size={22}
                    color={opponentScore > challengerScore ? '#FDE68A' : '#FFFFFF'}
                  />
                </View>
              </View>
            </View>
            {pk.draw && (
              <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '900', textAlign: 'center', marginTop: 14 }}>
                It&apos;s a draw!
              </Text>
            )}
            <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 12 }}>
              {roomName ? `${roomName} • ` : ''}{formatPkDuration(pk)} battle
            </Text>
            {!pk.draw && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 12,
                  backgroundColor: 'rgba(255,255,255,0.14)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.28)',
                  borderRadius: 12,
                  paddingVertical: 9,
                  paddingHorizontal: 12,
                  gap: 7,
                }}>
                <DiamondIcon size={14} />
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700' }}>
                  Won by
                </Text>
                <Text style={{ color: '#FDE68A', fontSize: 15, fontWeight: '900' }}>
                  {formatPkFull(margin)}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700' }}>
                  diamonds
                </Text>
              </View>
            )}
            {topDonor && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 10,
                  backgroundColor: 'rgba(255,255,255,0.10)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.22)',
                  borderRadius: 12,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  gap: 8,
                }}>
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700' }}>
                  Top donor:
                </Text>
                {topDonor.photoURL ? (
                  <Image
                    source={{ uri: topDonor.photoURL }}
                    style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: '#FFF' }}
                    resizeMode="cover"
                  />
                ) : (
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: '#7C3AED',
                      borderWidth: 1,
                      borderColor: '#FFF',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '800' }}>
                      {(topDonor.name || '?').slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
                <Text numberOfLines={1} style={{ color: '#FFF', fontSize: 13, fontWeight: '800', flexShrink: 1 }}>
                  {topDonor.name}
                </Text>
                <Text style={{ color: '#FDE68A', fontSize: 13, fontWeight: '900' }}>
                  {formatPkScore(topDonor.total)}
                </Text>
              </View>
            )}
            <Pressable
              onPress={() => setShareOpen(true)}
              style={{
                marginTop: 16,
                backgroundColor: 'rgba(255,255,255,0.18)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.5)',
                borderRadius: 14,
                paddingVertical: 12,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}>
              <Feather name="share" size={16} color="#FFF" />
              <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 15 }}>Share</Text>
            </Pressable>
          </LinearGradient>
        </Pressable>
      </Pressable>
      <PkShareSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        myUid={myUid}
        myName={myName}
        pk={pk}
        roomName={roomName}
      />
    </Modal>
  );
}
