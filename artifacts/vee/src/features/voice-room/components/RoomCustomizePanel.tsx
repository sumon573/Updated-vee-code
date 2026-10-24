import { View, Text, ScrollView, Pressable, Modal } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { C } from '../constants/theme';

/* ─────────────────────── Room Customize Panel ─────────────────────── */

/**
 * RoomCustomizePanel — imo-style customize sheet (2026-10-25, boss).
 * Opens from the three-dot button next to the room settings gear.
 * Room Game: the shipped games (Vote, Turntable, Luckybag) — tapping one
 * opens the game lobby, where hosts create and members join live games.
 * Room Settings: Music (everyone; read-only for members) + Announcement,
 * Theme and Operation History (owner/admin only, same gating as today).
 * No placeholder entries: a game that is not shipped yet (bomb, couple,
 * treasure) gets NO button here until it is built.
 */
export function RoomCustomizePanel({
  visible, onClose, isOwnerOrAdmin, nowPlayingTitle,
  onOpenMusic, onOpenGames, onOpenAnnouncement, onOpenSettings, onOpenHistory, onOpenPk,
}: {
  visible: boolean;
  onClose: () => void;
  isOwnerOrAdmin: boolean;
  nowPlayingTitle: string | null;
  onOpenMusic: () => void;
  onOpenGames: () => void;
  onOpenAnnouncement: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  onOpenPk: () => void;
}) {
  const tap = (fn: () => void) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fn();
  };

  const games = [
    { key: 'vote', label: 'Vote', icon: 'bar-chart-2' as const, bg: 'rgba(5,181,250,0.15)', fg: '#05B5FA' },
    { key: 'turntable', label: 'Turntable', icon: 'refresh-cw' as const, bg: 'rgba(245,158,11,0.15)', fg: '#D97706' },
    { key: 'luckybag', label: 'Luckybag', icon: 'gift' as const, bg: 'rgba(236,72,153,0.15)', fg: '#DB2777' },
  ];

  const settingsRows: Array<{
    key: string; label: string; sub: string;
    icon: 'music' | 'volume-2' | 'droplet' | 'clock';
    bg: string; fg: string; onPress: () => void; show: boolean;
  }> = [
    {
      key: 'music', label: 'Music', icon: 'music',
      sub: nowPlayingTitle ? `Playing: ${nowPlayingTitle}` : 'Play music for the whole room',
      bg: 'rgba(139,92,246,0.15)', fg: '#7C3AED',
      onPress: () => tap(onOpenMusic), show: true,
    },
    {
      key: 'announcement', label: 'Announcement', icon: 'volume-2',
      sub: 'Post or edit announcement',
      bg: 'rgba(255,193,7,0.18)', fg: '#B45309',
      onPress: () => tap(onOpenAnnouncement), show: isOwnerOrAdmin,
    },
    {
      key: 'theme', label: 'Theme', icon: 'droplet',
      sub: 'Change room theme',
      bg: 'rgba(6,182,212,0.15)', fg: '#0891B2',
      onPress: () => tap(onOpenSettings), show: isOwnerOrAdmin,
    },
    {
      key: 'history', label: 'Operation History', icon: 'clock',
      sub: 'Room operations log',
      bg: 'rgba(239,68,68,0.15)', fg: C.red,
      onPress: () => tap(onOpenHistory), show: isOwnerOrAdmin,
    },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26,
        borderWidth: 1, borderColor: C.borderFaint, maxHeight: '80%' }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.muted,
          alignSelf: 'center', marginTop: 12, marginBottom: 4 }} />
        <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
            <Text style={{ color: C.text, fontSize: 18, fontWeight: '900', flex: 1 }}>
              VoiceRoom Customize
            </Text>
            <Pressable onPress={onClose} style={{ padding: 6 }}>
              <Feather name="x" size={22} color={C.sub} />
            </Pressable>
          </View>

          {/* Room Mode — 1vs1 PK (2026-10-25, boss concept). */}
          <Text style={{ color: C.sub, fontSize: 14, fontWeight: '800', marginBottom: 12 }}>
            Room Mode
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 20, paddingBottom: 4 }}>
            <Pressable onPress={() => tap(onOpenPk)}
              style={{ alignItems: 'center', width: 72 }}>
              <View style={{ width: 60, height: 60, borderRadius: 30,
                backgroundColor: 'rgba(239,68,68,0.15)', alignItems: 'center', justifyContent: 'center',
                borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)' }}>
                <Feather name="zap" size={26} color={C.red} />
              </View>
              <Text style={{ color: C.text, fontSize: 12, fontWeight: '700', marginTop: 8,
                textAlign: 'center' }}>
                1vs1 PK
              </Text>
            </Pressable>
          </ScrollView>

          {/* Room Game */}
          <Text style={{ color: C.sub, fontSize: 14, fontWeight: '800', marginBottom: 12 }}>
            Room Game
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 20, paddingBottom: 4 }}>
            {games.map((g) => (
              <Pressable key={g.key} onPress={() => tap(onOpenGames)}
                style={{ alignItems: 'center', width: 72 }}>
                <View style={{ width: 60, height: 60, borderRadius: 30,
                  backgroundColor: g.bg, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: g.bg }}>
                  <Feather name={g.icon} size={26} color={g.fg} />
                </View>
                <Text style={{ color: C.text, fontSize: 12, fontWeight: '700', marginTop: 8,
                  textAlign: 'center' }}>
                  {g.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Room Settings */}
          <Text style={{ color: C.sub, fontSize: 14, fontWeight: '800', marginTop: 24, marginBottom: 4 }}>
            Room Settings
          </Text>
          {settingsRows.filter((r) => r.show).map((row) => (
            <Pressable
              key={row.key}
              onPress={row.onPress}
              style={{ flexDirection: 'row', alignItems: 'center',
                paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.borderFaint }}>
              <View style={{ width: 40, height: 40, borderRadius: 12,
                backgroundColor: row.bg,
                alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <Feather name={row.icon} size={18} color={row.fg} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>{row.label}</Text>
                <Text numberOfLines={1} style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                  {row.sub}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={C.muted} />
            </Pressable>
          ))}

          <Pressable onPress={onClose}
            style={{ marginTop: 16, backgroundColor: C.card, borderRadius: 14,
              paddingVertical: 14, alignItems: 'center',
              borderWidth: 1, borderColor: C.borderFaint }}>
            <Text style={{ color: C.sub, fontWeight: '700' }}>Close</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}
