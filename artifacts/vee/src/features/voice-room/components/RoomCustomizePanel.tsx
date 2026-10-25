import { useState } from 'react';
import { View, Text, ScrollView, Pressable, Modal } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { C, getActiveThemes } from '../constants/theme';

/* ─────────────────────── Room Customize Panel ─────────────────────── */

/**
 * RoomCustomizePanel — imo-style customize sheet (2026-10-25, boss).
 * Opens from the three-dot button next to the room settings gear.
 * Room Mode: 1vs1 PK + Vote (boss 2026-10-25: Vote moved here out of
 * Room Game). Room Game: Ludu ONLY (boss 2026-10-25 11:32 — Turntable
 * and Luckybag both removed); the Ludu button ships with the built
 * game (ae11b639) and opens the games lobby, where the Ludu entry
 * leads to the 2P/4P picker. Tapping a game opens the game lobby,
 * where hosts create and members join live games.
 * Room Settings: Music (HOST-SEAT ONLY, boss 2026-10-25: only the host
 * or whoever sits in seat 1 sees it — members and other admins see no
 * music entry at all) + Announcement (owner/admin). Theme lives ONLY
 * here (boss 2026-10-25: removed from Settings) as an expandable chip
 * list — the panel Theme row used to open Settings, which no longer
 * carries a theme picker, so the picker moved into this panel.
 * Operation History lives ONLY in Settings (boss 2026-10-25: removed
 * from this panel).
 * No placeholder entries: a game that is not shipped yet (bomb, couple,
 * treasure, ludu) gets NO button here until it is built.
 */
export function RoomCustomizePanel({
  visible, onClose, isOwnerOrAdmin, isHostSeat, nowPlayingTitle,
  onOpenMusic, onOpenGames, onOpenLudu, onOpenAnnouncement, onOpenPk,
  activeThemeId, onThemeChange,
}: {
  visible: boolean;
  onClose: () => void;
  isOwnerOrAdmin: boolean;
  isHostSeat: boolean;
  nowPlayingTitle: string | null;
  onOpenMusic: () => void;
  onOpenGames: () => void;
  /** 2026-10-25 (boss): panel Ludu opens the Ludu picker page DIRECTLY (no Games modal step). */
  onOpenLudu: () => void;
  onOpenAnnouncement: () => void;
  onOpenPk: () => void;
  activeThemeId: string;
  onThemeChange: (id: string) => void;
}) {
  const [showThemes, setShowThemes] = useState(false);
  const tap = (fn: () => void) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fn();
  };

  // 2026-10-25 (boss 11:32): Room Game is Ludu-ONLY. The Ludu button
  // ships with the built game (commit ae11b639) — it opens the games
  // lobby, where the Ludu entry leads to the 2P/4P picker.
  const games: Array<{
    key: string; label: string; icon: 'grid'; bg: string; fg: string;
  }> = [
    { key: 'ludu', label: 'Ludu', icon: 'grid' as const, bg: 'rgba(34,197,94,0.15)', fg: '#16A34A' },
  ];

  const settingsRows: Array<{
    key: string; label: string; sub: string;
    icon: 'music' | 'volume-2';
    bg: string; fg: string; onPress: () => void; show: boolean;
  }> = [
    {
      key: 'music', label: 'Music', icon: 'music',
      sub: nowPlayingTitle ? `Playing: ${nowPlayingTitle}` : 'Play music for the whole room',
      bg: 'rgba(139,92,246,0.15)', fg: '#7C3AED',
      onPress: () => tap(onOpenMusic), show: isHostSeat,
    },
    {
      key: 'announcement', label: 'Announcement', icon: 'volume-2',
      sub: 'Post or edit announcement',
      bg: 'rgba(255,193,7,0.18)', fg: '#B45309',
      onPress: () => tap(onOpenAnnouncement), show: isOwnerOrAdmin,
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
            {/* 2026-10-25 (boss): Vote moved here from Room Game. */}
            <Pressable onPress={() => tap(onOpenGames)}
              style={{ alignItems: 'center', width: 72 }}>
              <View style={{ width: 60, height: 60, borderRadius: 30,
                backgroundColor: 'rgba(5,181,250,0.15)', alignItems: 'center', justifyContent: 'center',
                borderWidth: 1, borderColor: 'rgba(5,181,250,0.25)' }}>
                <Feather name="bar-chart-2" size={26} color="#05B5FA" />
              </View>
              <Text style={{ color: C.text, fontSize: 12, fontWeight: '700', marginTop: 8,
                textAlign: 'center' }}>
                Vote
              </Text>
            </Pressable>
          </ScrollView>

          {/* Room Game — Ludu only (boss 11:32). Hidden automatically
              while empty (games.length === 0). */}
          {games.length > 0 && (
            <>
              <Text style={{ color: C.sub, fontSize: 14, fontWeight: '800', marginBottom: 12 }}>
                Room Game
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 20, paddingBottom: 4 }}>
                {games.map((g) => (
                  <Pressable key={g.key} onPress={() => tap(onOpenLudu)}
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
            </>
          )}

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

          {/* Theme — lives ONLY here (boss 2026-10-25, removed from
              Settings). Tap expands the theme chips inline. */}
          {isOwnerOrAdmin && (
            <View style={{ borderTopWidth: 1, borderTopColor: C.borderFaint }}>
              <Pressable
                onPress={() => tap(() => setShowThemes((v) => !v))}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14 }}>
                <View style={{ width: 40, height: 40, borderRadius: 12,
                  backgroundColor: 'rgba(6,182,212,0.15)',
                  alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                  <Feather name="droplet" size={18} color="#0891B2" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>Theme</Text>
                  <Text numberOfLines={1} style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                    {getActiveThemes().find((th) => th.id === activeThemeId)?.name ?? '💙 Light'}
                  </Text>
                </View>
                <Feather name={showThemes ? 'chevron-up' : 'chevron-down'} size={18} color={C.muted} />
              </Pressable>
              {showThemes && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 8 }}>
                  {getActiveThemes().map((theme) => {
                    const isActive = activeThemeId === theme.id;
                    return (
                      <Pressable key={theme.id}
                        onPress={() => tap(() => { onThemeChange(theme.id); setShowThemes(false); })}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 7,
                          backgroundColor: isActive ? theme.accent + '33' : C.card,
                          borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8,
                          borderWidth: 1.5, borderColor: isActive ? theme.accent : C.borderFaint,
                        }}>
                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.accent }} />
                        <Text style={{ color: isActive ? theme.accent : C.sub, fontSize: 12,
                          fontWeight: isActive ? '800' : '600' }}>{theme.name}</Text>
                        {isActive && <Feather name="check" size={10} color={theme.accent} />}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          )}

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
