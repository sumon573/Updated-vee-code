/* ─────────────────────── Music playlist page ─────────────────────── */

import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, Pressable, FlatList, TextInput, StyleSheet, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { RoomMusic, MusicLibraryEntry } from '../../services/roomMusicService';
import { removeMusicLibraryEntry } from '../../services/roomMusicService';
import type { MusicPalette } from './musicTheme';
import type { MusicControls } from './useMusicControls';
import { displayTitle, fmtRowMeta } from './musicFormat';
import { useMediaSize } from './useMediaSize';

/**
 * MusicPlaylistPage — the user's ADDED library as a list (boss
 * 2026-10-27 00:13, imo screenshot): dark page, "Music Playlist",
 * search + sort + "+" top-right. Row = art thumb + title + duration +
 * size; tap ANY row plays it; the playing row shows ✨ + a blue title.
 *
 * Deliberate v1 omissions/defaults (reported, not faked):
 * - NO tappable "…" menu: its function was never specified. Rows are
 *   tappable to play; deletion is via long-press selection mode.
 * - Row art is a generic note tile: library entries carry NO artwork
 *   field, so no song art is invented.
 * - Sort cycles newest -> oldest -> title A-Z (boss specified a sort
 *   icon but not its behavior).
 * - Back arrow (left of the title) returns to the player sheet: the
 *   Add page's back arrow proves the pattern in this flow, and the
 *   sheet needs a way back without closing.
 * - Deleting a library song removes ONLY the library entry; the room
 *   queue is untouched (a queued song keeps playing until it ends).
 * - The playlist shows the LIBRARY, not the room queue: the old
 *   "Up next" queue view is gone with the replaced sheet.
 */

export type PlaylistSort = 'newest' | 'oldest' | 'title';
const SORT_ORDER: PlaylistSort[] = ['newest', 'oldest', 'title'];

interface PlaylistPageProps {
  active: boolean;
  library: MusicLibraryEntry[];
  music: RoomMusic | null;
  canControl: boolean;
  uid: string | null;
  controls: MusicControls;
  palette: MusicPalette;
  onBack: () => void;
  onAdd: () => void;
}

function PlaylistRow(props: {
  entry: MusicLibraryEntry;
  playing: boolean;
  selected: boolean;
  selectionMode: boolean;
  palette: MusicPalette;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { entry, playing, selected, selectionMode, palette, onPress, onLongPress } = props;
  const size = useMediaSize('url', entry.url);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.row, { borderBottomColor: palette.border }]}
    >
      <View style={[styles.thumb, { backgroundColor: palette.surface }]}>
        <Feather name="music" size={20} color={palette.blue} />
      </View>
      <View style={styles.rowMeta}>
        <Text
          style={[styles.rowTitle, { color: playing ? palette.blue : palette.text }]}
          numberOfLines={1}
        >
          {playing ? '✨ ' : ''}
          {displayTitle(entry.title)}
        </Text>
        <Text style={[styles.rowSub, { color: palette.sub }]} numberOfLines={1}>
          {fmtRowMeta(entry.duration, size)}
        </Text>
      </View>
      {selectionMode ? (
        <View
          style={[
            styles.circle,
            {
              borderColor: selected ? palette.blue : palette.sub,
              backgroundColor: selected ? palette.blue : 'transparent',
            },
          ]}
        >
          {selected ? <Feather name="check" size={14} color="#FFFFFF" /> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

export function MusicPlaylistPage(props: PlaylistPageProps) {
  const { active, library, music, canControl, uid, controls, palette, onBack, onAdd } = props;
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<PlaylistSort>('newest');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!active) {
      setSelectionMode(false);
      setSelected({});
      setSearching(false);
      setQuery('');
    }
  }, [active]);

  const visible = useMemo(() => {
    let list = library;
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((e) => e.title.toLowerCase().includes(q));
    if (sort === 'newest') return [...list].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    if (sort === 'oldest') return [...list].sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
    return [...list].sort((a, b) => a.title.localeCompare(b.title));
  }, [library, query, sort]);

  const selectedCount = Object.keys(selected).filter((k) => selected[k]).length;
  const playingMediaId = music?.current?.mediaId ?? null;

  const toggleSelect = (key: string) => {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const enterSelection = (key: string) => {
    setSelectionMode(true);
    setSelected({ [key]: true });
  };

  const deleteSelected = () => {
    const keys = Object.keys(selected).filter((k) => selected[k]);
    if (keys.length === 0 || !uid) return;
    Alert.alert('Delete songs', `Remove ${keys.length} song${keys.length === 1 ? '' : 's'} from your library?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          Promise.all(keys.map((k) => removeMusicLibraryEntry(uid, k).catch(() => {}))).then(() => {
            setSelectionMode(false);
            setSelected({});
          });
        },
      },
    ]);
  };

  const selectAll = () => {
    const all: Record<string, boolean> = {};
    visible.forEach((e) => {
      all[e.libraryKey] = true;
    });
    setSelected(all);
  };

  return (
    <View style={styles.wrap}>
      {selectionMode ? (
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              setSelectionMode(false);
              setSelected({});
            }}
            hitSlop={8}
          >
            <Feather name="arrow-left" size={22} color={palette.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: palette.text }]}>{selectedCount}</Text>
          <Pressable onPress={deleteSelected} hitSlop={8}>
            <Feather name="trash-2" size={22} color={palette.text} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.header}>
          <Pressable onPress={onBack} hitSlop={8}>
            <Feather name="arrow-left" size={22} color={palette.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: palette.text }]}>Music Playlist</Text>
          <View style={styles.headerIcons}>
            <Pressable
              onPress={() => {
                setSearching((s) => !s);
                if (searching) setQuery('');
              }}
              hitSlop={8}
              style={styles.headerIcon}
            >
              <Feather name="search" size={20} color={palette.text} />
            </Pressable>
            <Pressable
              onPress={() => setSort(SORT_ORDER[(SORT_ORDER.indexOf(sort) + 1) % SORT_ORDER.length])}
              hitSlop={8}
              style={styles.headerIcon}
            >
              <Feather name="filter" size={20} color={palette.text} />
            </Pressable>
            {canControl ? (
              <Pressable onPress={onAdd} hitSlop={8} style={styles.headerIcon}>
                <Feather name="plus" size={22} color={palette.text} />
              </Pressable>
            ) : null}
          </View>
        </View>
      )}

      {searching && !selectionMode ? (
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search songs"
          placeholderTextColor={palette.sub}
          autoFocus
          style={[styles.search, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
        />
      ) : null}

      {selectionMode ? (
        <Pressable onPress={selectAll} style={[styles.selectAll, { borderBottomColor: palette.border }]}>
          <Text style={[styles.selectAllText, { color: palette.text }]}>Select all</Text>
          <View style={[styles.circle, { borderColor: palette.sub }]}>
            {selectedCount === visible.length && visible.length > 0 ? (
              <Feather name="check" size={14} color={palette.blue} />
            ) : null}
          </View>
        </Pressable>
      ) : null}

      {visible.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: palette.text }]}>No songs added yet</Text>
          {canControl ? (
            <Pressable onPress={onAdd} style={[styles.addBtn, { backgroundColor: palette.blue }]}>
              <Text style={styles.addBtnText}>Add songs</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(e) => e.libraryKey}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <PlaylistRow
              entry={item}
              playing={item.mediaId === playingMediaId}
              selected={!!selected[item.libraryKey]}
              selectionMode={selectionMode}
              palette={palette}
              onPress={() => {
                if (selectionMode) toggleSelect(item.libraryKey);
                else if (canControl) controls.playLibrarySong(item);
              }}
              onLongPress={() => enterSelection(item.libraryKey)}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  headerTitle: { fontSize: 18, fontWeight: '800', flex: 1, marginLeft: 12 },
  headerIcons: { flexDirection: 'row', alignItems: 'center' },
  headerIcon: { marginLeft: 16 },
  search: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
    marginBottom: 8,
  },
  selectAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  selectAllText: { fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1 },
  thumb: { width: 48, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowMeta: { flex: 1, marginLeft: 12, marginRight: 8 },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  rowSub: { fontSize: 13, marginTop: 2 },
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '700' },
  addBtn: { marginTop: 16, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 22 },
  addBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
