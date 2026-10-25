/**
 * RoomGamesModal — IMO voice-room game lobby (2026-10-19).
 *
 * IMO evidence: voiceroom/playgames/ (votegame, turntable, luckybag, bombgame,
 * auction, teampknew, grouppk, treasurebox, couple), "Game Lobby" / "Room Game"
 * strings, vr_game analytics. Behavior ported; Vee's code.
 *
 * Shipped games (feasible on Vee's LiveKit + Firebase stack, real diamonds):
 *   • Vote — host starts, audience votes by gifting candidates (IMO-exact).
 *   • Turntable — spin the wheel; prizes are catalog gifts auto-sent to the
 *     winner through the normal gift pipeline (real diamonds, no minting).
 *   • Lucky Bag — entrance fee (gift to host), jackpot gift to the winner.
 * Follow-ups needing server support (listed in report): bomb game (realtime
 * tap-to-pass), auction (realtime bidding), team/group PK (cross-room),
 * couple game (relationship system), treasure box.
 */
import { useEffect, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { subscribeGames, type RoomGame, type GameType } from '../../services/roomGameService';

const GAME_META: { type: GameType; icon: string; color: string }[] = [
  // 2026-10-25 (boss: hub emptied for now — "এখানে এগুলো একটা থাকবে
  // না, আমি যেটা বলবো ঠিক সেটা অ্যাড করবে"): the offered-games list is
  // EMPTY on his order. Games are added back ONLY on his word, one by
  // one, by re-adding their entry here. The game types themselves stay
  // in code/RTDB — only this hub listing is empty.
];

export function RoomGamesModal({ visible, roomId, isHost, onClose, onOpenGame, onCreateGame, onOpenRank, onOpenProps }: {
  visible: boolean;
  roomId: string;
  isHost: boolean;
  onClose: () => void;
  /** open an existing game */
  onOpenGame: (game: RoomGame) => void;
  /** start creating a new game of this type */
  onCreateGame: (type: GameType) => void;
  onOpenRank: () => void;
  onOpenProps: () => void;
}) {
  const { t } = useTranslation();
  const [games, setGames] = useState<RoomGame[]>([]);

  const TYPE_NAMES: Record<GameType, string> = {
    vote: t('voiceRoom.games.type_vote'),
    turntable: t('voiceRoom.games.type_turntable'),
    luckybag: t('voiceRoom.games.type_luckybag'),
    ludu: t('voiceRoom.games.type_ludu'),
  };
  const TYPE_DESCS: Record<GameType, string> = {
    vote: t('voiceRoom.games.desc_vote'),
    turntable: t('voiceRoom.games.desc_turntable'),
    luckybag: t('voiceRoom.games.desc_luckybag'),
    ludu: t('voiceRoom.games.desc_ludu'),
  };

  useEffect(() => {
    if (!visible || !roomId) return;
    return subscribeGames(roomId, setGames);
  }, [visible, roomId]);

  // Ludu lobbies (status 'lobby') must show as joinable too — only ludu
  // ever creates lobby-state games, so other types are unaffected.
  const live = games.filter((g) => g.status === 'active' || g.status === 'lobby');
  const past = games.filter((g) => g.status === 'ended');

  // 2026-10-25 (boss: "আপাতত সব ফাঁকা করে ফেলো"): while the hub is
  // emptied, live + recent game entries are hidden from THIS modal only
  // (display-only — instances stay in RTDB, the room-visible Ludu lobby
  // strip still shows lobbies, panel flows untouched). Flip back to true
  // when he re-opens the hub with his dictated games.
  const HUB_ENTRIES_VISIBLE = false;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} onPress={onClose} />
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '75%', paddingBottom: 28,
      }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E5EA', alignSelf: 'center', marginTop: 10 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
          <Feather name="play" size={18} color="#05b5fa" />
          <Text style={{ fontSize: 17, fontWeight: '800', color: '#000', marginLeft: 8, flex: 1 }}>
            {t('voiceRoom.games.title')}
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Feather name="x" size={22} color="#8E8E93" />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
          {HUB_ENTRIES_VISIBLE && live.length > 0 && (
            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: '#22C55E', marginBottom: 8 }}>
                {t('voiceRoom.games.liveNow')}
              </Text>
              {live.map((g) => (
                <Pressable
                  key={g.id}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpenGame(g); }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0FDF4',
                    borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#22C55E55',
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: '#000' }}>{g.title}</Text>
                    <Text style={{ fontSize: 12, color: '#8E8E93', marginTop: 2 }}>
                      {TYPE_NAMES[g.type]} · {g.hostName}
                    </Text>
                  </View>
                  <View style={{ backgroundColor: '#22C55E', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}>
                    <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '800' }}>{t('voiceRoom.games.join')}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          {GAME_META.length > 0 && (
            <>
          <Text style={{ fontSize: 13, fontWeight: '800', color: '#8E8E93', marginBottom: 8 }}>
            {isHost ? t('voiceRoom.games.startNew') : t('voiceRoom.games.allGames')}
          </Text>
          {GAME_META.map(({ type, icon, color }) => (
            <Pressable
              key={type}
              disabled={!isHost}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onCreateGame(type); }}
              style={{
                flexDirection: 'row', alignItems: 'center', backgroundColor: '#F2F2F7',
                borderRadius: 14, padding: 14, marginBottom: 8, opacity: isHost ? 1 : 0.75,
              }}
            >
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: color + '1A', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                {/* @ts-ignore feather name union */}
                <Feather name={icon} size={22} color={color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#000' }}>{TYPE_NAMES[type]}</Text>
                <Text style={{ fontSize: 12, color: '#8E8E93', marginTop: 2 }}>{TYPE_DESCS[type]}</Text>
              </View>
              {isHost && <Feather name="chevron-right" size={20} color="#C7C7CC" />}
            </Pressable>
          ))}
            </>
          )}

          {HUB_ENTRIES_VISIBLE && past.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: '#8E8E93', marginBottom: 8 }}>
                {t('voiceRoom.games.recent')}
              </Text>
              {past.slice(0, 5).map((g) => (
                <Pressable
                  key={g.id}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpenGame(g); }}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#E5E5EA' }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#000' }} numberOfLines={1}>{g.title}</Text>
                    <Text style={{ fontSize: 12, color: '#8E8E93' }}>
                      {TYPE_NAMES[g.type]}
                      {g.winnerName ? ` · 🏆 ${g.winnerName}` : ''}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={18} color="#C7C7CC" />
                </Pressable>
              ))}
            </View>
          )}

          {HUB_ENTRIES_VISIBLE && !isHost && live.length === 0 && (
            <Text style={{ textAlign: 'center', color: '#8E8E93', fontSize: 13, marginTop: 12 }}>
              {t('voiceRoom.games.hostOnly')}
            </Text>
          )}

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpenRank(); }}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F2F7', borderRadius: 14, paddingVertical: 12 }}
            >
              <Feather name="award" size={16} color="#F59E0B" />
              <Text style={{ marginLeft: 6, fontSize: 14, fontWeight: '800', color: '#000' }}>{t('voiceRoom.rank.title')}</Text>
            </Pressable>
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpenProps(); }}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F2F7', borderRadius: 14, paddingVertical: 12 }}
            >
              <Feather name="package" size={16} color="#05b5fa" />
              <Text style={{ marginLeft: 6, fontSize: 14, fontWeight: '800', color: '#000' }}>{t('voiceRoom.props.title')}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
