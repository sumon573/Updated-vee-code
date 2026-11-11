import { View, Text, Pressable, Modal, Image, Share } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import {
  pkScoreOf,
  formatPkScore,
  pkTopDonor,
  type RoomPk,
} from '../services/roomPkService';
import { PkDigitalScore } from './PkDigitalScore';

/* ─────────────────────── 1v1 PK result popup ─────────────────────── */

/**
 * PkResultPopup — the end-of-battle result card (2026-11-02, PK real,
 * boss screenshot form): gradient card, X close, two avatars facing off
 * with the PK emblem centered between them, WIN crown badge on the
 * winner's avatar, name + flame-icon compact score per side, "Top donor"
 * line, full-width Share button. All art is Vee-original shapes/text —
 * no reference-app assets. Purely presentational (no timers, no
 * subscriptions): the caller passes a frozen ended snapshot, so the card
 * survives the bot's 3-minute ended-node cleanup.
 */
export function PkResultPopup({
  visible,
  onClose,
  pk,
  challengerPhotoURL,
  opponentPhotoURL,
  roomName,
}: {
  visible: boolean;
  onClose: () => void;
  pk: RoomPk | null;
  challengerPhotoURL?: string | null;
  opponentPhotoURL?: string | null;
  roomName?: string;
}) {
  if (!pk) return null;

  const challengerScore = pkScoreOf(pk, pk.challenger.uid);
  const opponentScore = pkScoreOf(pk, pk.opponent.uid);
  const winnerUid = !pk.draw ? pk.winnerUid : null;
  const winnerName =
    winnerUid === pk.challenger.uid
      ? pk.challenger.name
      : winnerUid === pk.opponent.uid
        ? pk.opponent.name
        : null;
  const topDonor = pkTopDonor(pk);

  const avatar = (name: string, color: string, photoURL?: string | null, isWinner?: boolean) => (
    <View style={{ position: 'relative', alignItems: 'center' }}>
      {photoURL ? (
        <Image
          source={{ uri: photoURL }}
          style={{ width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: '#FFF' }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: color,
            borderWidth: 2,
            borderColor: '#FFF',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Text style={{ color: '#FFF', fontSize: 22, fontWeight: '800' }}>
            {(name || '?').slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}
      {isWinner && (
        <View style={{ position: 'absolute', top: -18, alignItems: 'center' }}>
          <Text style={{ fontSize: 20 }}>👑</Text>
          <Text style={{ color: '#FBC02D', fontSize: 10, fontWeight: '900' }}>WIN</Text>
        </View>
      )}
    </View>
  );

  const shareResult = async () => {
    const scoreLine = `${pk.challenger.name} ${formatPkScore(challengerScore)} - ${formatPkScore(opponentScore)} ${pk.opponent.name}`;
    const where = roomName ? ` in ${roomName}` : '';
    const message = pk.draw
      ? `1vs1 PK ended in a draw! ${scoreLine}${where}`
      : `${winnerName} became the PK Winner! ${scoreLine}${where}`;
    try {
      await Share.share({ message });
    } catch { /* share dismissed — nothing to do */ }
  };

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
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
              <View style={{ flex: 1, alignItems: 'center' }}>
                {avatar(pk.challenger.name, '#7C3AED', challengerPhotoURL, winnerUid === pk.challenger.uid)}
                <Text numberOfLines={1} style={{ color: '#FFF', fontSize: 14, fontWeight: '800', marginTop: 10, textAlign: 'center' }}>
                  {pk.challenger.name}
                </Text>
                <View style={{ marginTop: 4 }}>
                  <PkDigitalScore
                    value={challengerScore}
                    digitHeight={20}
                    color={challengerScore > opponentScore ? '#FDE68A' : '#A5F3FC'}
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
                }}>
                <Text style={{ color: '#EC4899', fontSize: 20, fontWeight: '900', fontStyle: 'italic' }}>
                  PK
                </Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center' }}>
                {avatar(pk.opponent.name, '#05B5FA', opponentPhotoURL, winnerUid === pk.opponent.uid)}
                <Text numberOfLines={1} style={{ color: '#FFF', fontSize: 14, fontWeight: '800', marginTop: 10, textAlign: 'center' }}>
                  {pk.opponent.name}
                </Text>
                <View style={{ marginTop: 4 }}>
                  <PkDigitalScore
                    value={opponentScore}
                    digitHeight={20}
                    color={opponentScore > challengerScore ? '#FDE68A' : '#A5F3FC'}
                  />
                </View>
              </View>
            </View>
            {pk.draw && (
              <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '900', textAlign: 'center', marginTop: 14 }}>
                It&apos;s a draw!
              </Text>
            )}
            {topDonor && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 14, gap: 8 }}>
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
              onPress={shareResult}
              style={{
                marginTop: 18,
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
    </Modal>
  );
}
