/* ─────────────────────── Music flow container ─────────────────────── */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Modal, Pressable, StyleSheet } from 'react-native';
import { auth } from '@/src/config/firebase';
import {
  subscribeRoomMusic,
  subscribeMusicLibrary,
  type RoomMusic,
  type MusicLibraryEntry,
} from '../../services/roomMusicService';
import { useMusicControls } from './useMusicControls';
import { resolveMusicTheme, isDarkThemeBg, musicPalette } from './musicTheme';
import { MusicPlayerSheet } from './MusicPlayerSheet';
import { MusicPlaylistPage } from './MusicPlaylistPage';
import { MusicAddPage } from './MusicAddPage';

/**
 * MusicFlowModal — the new music flow (2026-10-27, boss spec):
 * Music icon -> PLAYER SHEET first -> playlist icon -> PLAYLIST page
 * -> "+" -> ADD page. One container, three views; all views stay
 * mounted (toggled by display) so the Add page's phone list and the
 * playlist's selection survive view switches.
 *
 * Replaces RoomMusicModal (deleted): the old white "NOTHING PLAYING /
 * Up next / + Add" sheet and the old "My songs / From phone" Add page
 * are gone — there is exactly one music flow.
 *
 * Gating (2026-10-27, boss correction):
 * - Entry: the floating music icon opens this flow for EVERYONE in
 *   the room while music plays/pauses. Playing state is visible to
 *   every opener; the sheet's maintain actions are gated below.
 * - Transport/power/play-row-tap/playlist/add: canControl = isHostSeat
 *   (host role OR seat 0, set by the caller). An owner/admin NOT in
 *   the host seat gets the member view: song + real player name +
 *   own local volume only, no maintain buttons at all.
 * - Local volume: ungated (this phone only).
 * - Delete: removes from the OPENER's own library only.
 *
 * Theme: activeThemeId -> luminance of theme.bg -> dark sheet with
 * white content, or light sheet with black content (boss rule).
 */

export type MusicView = 'player' | 'playlist' | 'add';

interface MusicFlowModalProps {
  visible: boolean;
  onClose: () => void;
  roomId: string;
  canControl: boolean;
  myName: string;
  onVolumeChange: (v: number) => void;
  activeThemeId: string;
}

export function MusicFlowModal(props: MusicFlowModalProps) {
  const { visible, onClose, roomId, canControl, myName, onVolumeChange, activeThemeId } = props;
  const uid = auth.currentUser?.uid ?? null;
  const [view, setView] = useState<MusicView>('player');
  const [music, setMusic] = useState<RoomMusic | null>(null);
  const [library, setLibrary] = useState<MusicLibraryEntry[]>([]);
  const musicRef = useRef<RoomMusic | null>(null);

  useEffect(() => {
    musicRef.current = music;
  }, [music]);

  const getMusic = useCallback(() => musicRef.current, []);

  const controls = useMusicControls({ roomId, canControl, uid, myName, getMusic, onVolumeChange });

  useEffect(() => {
    if (!visible) {
      setView('player');
      return;
    }
    const unsubMusic = subscribeRoomMusic(roomId, (m) => setMusic(m));
    const unsubLib = uid ? subscribeMusicLibrary(uid, (entries) => setLibrary(entries)) : () => {};
    return () => {
      unsubMusic();
      unsubLib();
    };
  }, [visible, roomId, uid]);

  const theme = resolveMusicTheme(activeThemeId);
  const palette = musicPalette(theme ? isDarkThemeBg(theme.bg) : false);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.dim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            { backgroundColor: palette.bg },
            view === 'player' ? styles.sheetAuto : styles.sheetTall,
          ]}
        >
          <View style={[styles.viewWrap, { display: view === 'player' ? 'flex' : 'none' }]}>
            <MusicPlayerSheet
              active={visible && view === 'player'}
              music={music}
              canControl={canControl}
              controls={controls}
              palette={palette}
              onClose={onClose}
              onOpenPlaylist={() => setView('playlist')}
            />
          </View>
          <View style={[styles.viewWrap, styles.viewWrapFill, { display: view === 'playlist' ? 'flex' : 'none' }]}>
            <MusicPlaylistPage
              active={visible && view === 'playlist'}
              library={library}
              music={music}
              canControl={canControl}
              uid={uid}
              controls={controls}
              palette={palette}
              onBack={() => setView('player')}
              onAdd={() => setView('add')}
            />
          </View>
          <View style={[styles.viewWrap, styles.viewWrapFill, { display: view === 'add' ? 'flex' : 'none' }]}>
            <MusicAddPage
              active={visible && view === 'add'}
              uid={uid}
              palette={palette}
              onBack={() => setView('playlist')}
              onAdded={() => setView('playlist')}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { width: '100%', borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: '88%' },
  sheetAuto: {},
  sheetTall: { height: '88%' },
  // 2026-10-27 (boss: Music tap showed dim but no sheet): the player
  // wrapper must NOT flex — flex:1 inside the auto-height player sheet
  // collapses to 0 (sheet has only a percentage maxHeight, no definite
  // height), so the sheet vanished and only the dim rendered. Playlist/
  // add keep the fill because their sheet has a definite 88% height.
  viewWrap: {},
  viewWrapFill: { flex: 1 },
});
