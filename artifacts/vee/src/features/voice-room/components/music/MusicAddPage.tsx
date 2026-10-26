/* ─────────────────────── Music Add page ─────────────────────── */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { View, Text, Pressable, FlatList, TextInput, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import type { MusicPalette } from './musicTheme';
import { displayTitle, fmtRowMeta } from './musicFormat';
import { useMediaSize } from './useMediaSize';
import {
  findLibraryEntryByAsset,
  saveMusicLibraryEntry,
  uploadMusicFile,
  friendlyUploadError,
} from '../../services/roomMusicService';

/**
 * MusicAddPage — the PHONE's full music list (boss 2026-10-27 00:16 +
 * 00:18, imo screenshots): dark "Add" page, back arrow, search +
 * refresh + "?" top-right, "Select all" row, every local file as a
 * row (art + title + duration + size + empty selection circle).
 * Tick circles to pick; with >=1 selected a bottom full-width
 * bright-blue "Add N Songs" button appears; 0 selected -> no button.
 *
 * Replaces the old white Add page ("My songs / From phone" sections):
 * there is NO library section here — the list is phone files only,
 * and "Select all" covers the visible phone rows.
 *
 * Add is LIBRARY-ONLY (upload + save, no queue step — a deliberate
 * fork from the old flow, where Add also queued): the boss's flow is
 * library first, then tap-to-play from the playlist. Queueing every
 * picked song at once would suddenly play a pile of songs.
 * Songs already in the library (same-device assetId match) are marked
 * done without re-uploading.
 *
 * Deliberate v1 defaults (reported, not faked):
 * - "?" shows an Alert explaining the page + the mp3/wav/m4a rule +
 *   the never-disappear library law (its function was not specified).
 * - Row art is a generic note tile: phone assets carry no artwork.
 * - Format filter: extension in {mp3, wav, m4a} (or unknown) passes.
 * - 3-at-a-time resolve, failures stay selected for retry.
 */

const SUPPORTED_EXT = new Set(['mp3', 'wav', 'm4a']);

function isSupportedFile(name: string | null | undefined): boolean {
  if (!name) return true;
  const parts = name.split('.');
  if (parts.length < 2) return true;
  return SUPPORTED_EXT.has(parts[parts.length - 1].toLowerCase());
}

type RowStatus = 'uploading' | 'done' | 'failed';

function PhoneRow(props: {
  asset: MediaLibrary.Asset;
  selected: boolean;
  status: RowStatus | null;
  palette: MusicPalette;
  onToggle: () => void;
}) {
  const { asset, selected, status, palette, onToggle } = props;
  const size = useMediaSize('file', asset.uri);
  return (
    <Pressable onPress={onToggle} style={[styles.row, { borderBottomColor: palette.border }]}>
      <View style={[styles.thumb, { backgroundColor: palette.surface }]}>
        <Feather name="music" size={20} color={palette.blue} />
      </View>
      <View style={styles.rowMeta}>
        <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={1}>
          {displayTitle(asset.filename ?? 'Unknown song')}
        </Text>
        <Text style={[styles.rowSub, { color: palette.sub }]} numberOfLines={1}>
          {status === 'uploading' ? 'Uploading…' : status === 'failed' ? 'Failed — tap to retry' : fmtRowMeta(asset.duration, size)}
        </Text>
      </View>
      <View
        style={[
          styles.circle,
          {
            borderColor: selected || status === 'done' ? palette.blue : palette.sub,
            backgroundColor: selected || status === 'done' ? palette.blue : 'transparent',
          },
        ]}
      >
        {selected || status === 'done' ? <Feather name="check" size={14} color="#FFFFFF" /> : null}
      </View>
    </Pressable>
  );
}

interface AddPageProps {
  active: boolean;
  uid: string | null;
  palette: MusicPalette;
  onBack: () => void;
  onAdded: () => void;
}

export function MusicAddPage(props: AddPageProps) {
  const { active, uid, palette, onBack, onAdded } = props;
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<Record<string, RowStatus>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadAudio = useCallback(
    async (force: boolean) => {
      if (loadedRef.current && !force) return;
      setLoading(true);
      setDenied(false);
      try {
        let perm = await MediaLibrary.getPermissionsAsync();
        if (!perm.granted) perm = await MediaLibrary.requestPermissionsAsync();
        if (!perm.granted) {
          setDenied(true);
          Alert.alert('Audio access needed', 'Allow access to audio files to add music.');
          return;
        }
        const all: MediaLibrary.Asset[] = [];
        let after: string | undefined;
        let hasNext = true;
        while (hasNext) {
          const page = await MediaLibrary.getAssetsAsync({
            first: 100,
            mediaType: MediaLibrary.MediaType.audio,
            sortBy: [MediaLibrary.SortBy.creationTime],
            after,
          });
          all.push(...page.assets);
          hasNext = page.hasNextPage;
          after = page.endCursor;
        }
        const filtered = all
          .filter((a) => isSupportedFile(a.filename))
          .sort((a, b) => (b.creationTime || 0) - (a.creationTime || 0));
        if (mountedRef.current) {
          setAssets(filtered);
          loadedRef.current = true;
        }
      } catch {
        if (mountedRef.current) setDenied(true);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (active) loadAudio(false);
  }, [active, loadAudio]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((a) => (a.filename ?? '').toLowerCase().includes(q));
  }, [assets, query]);

  const selectedCount = useMemo(
    () => assets.filter((a) => selected[a.id]).length,
    [assets, selected],
  );

  const toggle = (id: string) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectAll = () => {
    const allSelected = visible.length > 0 && visible.every((a) => selected[a.id]);
    if (allSelected) {
      setSelected((prev) => {
        const next = { ...prev };
        visible.forEach((a) => {
          delete next[a.id];
        });
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = { ...prev };
        visible.forEach((a) => {
          next[a.id] = true;
        });
        return next;
      });
    }
  };

  const runBatch = async () => {
    if (!uid || batchRunning) return;
    const picked = assets.filter((a) => selected[a.id]);
    if (picked.length === 0) return;
    setBatchRunning(true);
    setBatchError(null);
    let failed = 0;
    const resolveOne = async (asset: MediaLibrary.Asset): Promise<boolean> => {
      setStatus((prev) => ({ ...prev, [asset.id]: 'uploading' }));
      try {
        const existing = await findLibraryEntryByAsset(uid, asset.id);
        if (!existing) {
          const up = await uploadMusicFile({ uri: asset.uri, filename: asset.filename });
          await saveMusicLibraryEntry(uid, {
            mediaId: up.mediaId,
            url: up.url,
            title: asset.filename ?? `music-${asset.id}`,
            assetId: asset.id,
            duration: asset.duration ?? null,
            addedAt: Date.now(),
          });
        }
        if (mountedRef.current) {
          setStatus((prev) => ({ ...prev, [asset.id]: 'done' }));
          setSelected((prev) => {
            const next = { ...prev };
            delete next[asset.id];
            return next;
          });
        }
        return true;
      } catch (e) {
        if (mountedRef.current) {
          setStatus((prev) => ({ ...prev, [asset.id]: 'failed' }));
          setBatchError(friendlyUploadError(e));
        }
        return false;
      }
    };
    for (let i = 0; i < picked.length; i += 3) {
      const chunk = picked.slice(i, i + 3);
      const results = await Promise.all(chunk.map(resolveOne));
      failed += results.filter((r) => !r).length;
    }
    if (mountedRef.current) {
      setBatchRunning(false);
      if (failed === 0) onAdded();
    }
  };

  const showHelp = () => {
    Alert.alert(
      'Add songs',
      'Add songs from your phone to your library. Pick songs, then tap "Add N Songs". Only mp3, wav, and m4a are supported. Added songs stay in your library in every room until you delete them.',
    );
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={palette.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: palette.text }]}>Add</Text>
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
            onPress={() => {
              setAssets([]);
              loadedRef.current = false;
              loadAudio(true);
            }}
            hitSlop={8}
            style={styles.headerIcon}
          >
            <Feather name="refresh-cw" size={20} color={palette.text} />
          </Pressable>
          <Pressable onPress={showHelp} hitSlop={8} style={styles.headerIcon}>
            <Feather name="help-circle" size={20} color={palette.text} />
          </Pressable>
        </View>
      </View>

      {searching ? (
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search phone songs"
          placeholderTextColor={palette.sub}
          autoFocus
          style={[styles.search, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
        />
      ) : null}

      <Pressable onPress={selectAll} style={[styles.selectAll, { borderBottomColor: palette.border }]}>
        <Text style={[styles.selectAllText, { color: palette.text }]}>Select all</Text>
        <View style={[styles.circle, { borderColor: palette.sub }]}>
          {visible.length > 0 && visible.every((a) => selected[a.id]) ? (
            <Feather name="check" size={14} color={palette.blue} />
          ) : null}
        </View>
      </Pressable>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} />
        </View>
      ) : denied ? (
        <View style={styles.center}>
          <Text style={[styles.centerText, { color: palette.text }]}>Audio access denied</Text>
          <Pressable onPress={() => loadAudio(true)} style={[styles.retryBtn, { backgroundColor: palette.blue }]}>
            <Text style={styles.retryText}>Allow access</Text>
          </Pressable>
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.centerText, { color: palette.sub }]}>No songs found on this phone</Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(a) => a.id}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <PhoneRow
              asset={item}
              selected={!!selected[item.id]}
              status={status[item.id] ?? null}
              palette={palette}
              onToggle={() => toggle(item.id)}
            />
          )}
        />
      )}

      {batchError ? (
        <Text style={[styles.error, { color: '#EF4444' }]} numberOfLines={2}>
          {batchError}
        </Text>
      ) : null}

      {selectedCount > 0 ? (
        <Pressable
          onPress={runBatch}
          disabled={batchRunning}
          style={[styles.addBtn, { backgroundColor: palette.blue }, batchRunning && styles.dim]}
        >
          <Text style={styles.addBtnText}>
            {batchRunning ? 'Adding…' : `Add ${selectedCount} Song${selectedCount === 1 ? '' : 's'}`}
          </Text>
        </Pressable>
      ) : null}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerText: { fontSize: 15, fontWeight: '600' },
  retryBtn: { marginTop: 16, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 22 },
  retryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  error: { fontSize: 13, marginTop: 8, textAlign: 'center' },
  addBtn: { marginTop: 12, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  addBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  dim: { opacity: 0.6 },
});
