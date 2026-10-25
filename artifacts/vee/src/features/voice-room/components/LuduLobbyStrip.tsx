import { View, Text, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RoomGame } from '../services/roomGameService';

/* ─────────────────────── Room-visible Ludu lobby strip ─────────────────────── */

/**
 * LuduLobbyStrip — the boss's full Ludu concept (2026-10-25, imo lobby
 * screenshots): when a host opens a Ludu lobby, EVERY room occupant sees
 * it right in the room — nobody hunts through panels or the Games modal.
 * Tap opens the lobby page; seated users join from "+" inside, visitors
 * only watch (the seat gate lives in the lobby, not here). Shown only
 * while a lobby is open (status 'lobby'); once the host starts, the
 * board takes over and the strip goes away (no mid-game join).
 * If two lobbies ever exist, the newest one wins (subscribeGames sorts
 * createdAt desc) — one strip, never a stack.
 */
export function LuduLobbyStrip({
  game,
  onPress,
}: {
  game: RoomGame;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const total = game.luduMode ?? 2;
  const filled = Object.keys(game.players ?? {}).length;

  return (
    <Pressable onPress={onPress}>
      <View
        style={{
          backgroundColor: '#7C3AED',
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(34,197,94,0.45)',
          paddingHorizontal: 12,
          paddingVertical: 10,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: '900', letterSpacing: 1.5, color: '#FFF' }}>
          {t('voiceRoom.games.luduTitle')}
        </Text>
        <Text numberOfLines={1} style={{ color: '#FFF', fontSize: 13, fontWeight: '700', flex: 1, marginLeft: 10 }}>
          {game.hostName} · {filled}/{total}
        </Text>
        <View style={{ backgroundColor: '#22C55E', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 }}>
          <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '800' }}>
            {t('voiceRoom.games.join')}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
