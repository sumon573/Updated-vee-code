import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView, Alert, Pressable, Modal } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import { C } from '../constants/theme';
import {
  subscribeRoomMusic,
  addMusicTrack,
  setMusicState,
  setPlayQueueId,
  removeQueueTrack,
  uploadMusicFile,
  friendlyUploadError,
  subscribeMusicLibrary,
  saveMusicLibraryEntry,
  findLibraryEntryByAsset,
  getRoomMusicOnce,
  type RoomMusic,
  type MusicLibraryEntry,
} from '../services/roomMusicService';
import {
  getMusicVolumeSync,
  setMusicVolume as persistMusicVolume,
} from '../services/musicVolumeService';
import { auth } from '@/src/config/firebase';

/* ─────────────────────────── Room Music Modal ─────────────────────────── */

/**
 * RoomMusicModal — room-wide music (2026-10-25, boss: everyone hears).
 * The VPS bot does the actual streaming; this modal is queue + controls.
 * Owner/admin: add from phone, play/pause/next/stop, remove queued tracks,
 * tap any queued song to play it directly (playQueueId).
 * Members: read-only (now playing + queue) — they hear it via LiveKit.
 * Restructured 2026-10-25 to the boss-approved imo-style white layout:
 * "Music Playlist" page + "Add" view (My songs first, then From phone).
 * The picker offers "My songs" (the user's own library, shared by every
 * room — no re-upload) above "From phone".
 */
type PickerRow =
  | { key: string; kind: 'lib'; entry: MusicLibraryEntry }
  | { key: string; kind: 'phone'; asset: MediaLibrary.Asset };

export function RoomMusicModal({
  visible, onClose, roomId, canControl, myName, onVolumeChange,
}: {
  visible: boolean;
  onClose: () => void;
  roomId: string;
  canControl: boolean;
  myName: string;
  /** Engine apply for the local music volume (0–1). */
  onVolumeChange: (v: number) => void;
}) {
  const [music, setMusic] = useState<RoomMusic | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  // Multi-select: picked rows (library songs + phone songs), per-row add
  // status, batch run. Row keys are 'lib:<libraryKey>' / 'ph:<assetId>'.
  const [selected, setSelected] = useState<Record<string, PickerRow>>({});
  const [addStatus, setAddStatus] = useState<Record<string, 'uploading' | 'done' | 'failed'>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);
  // The user's own song library (all rooms share it — songs added once
  // stay available in every room without re-uploading).
  const [library, setLibrary] = useState<MusicLibraryEntry[]>([]);
  // Phone library, loaded once per room session — reopening the picker or
  // adding songs must not refetch the whole library again.
  const assetsLoadedRef = useRef(false);
  const [volume, setVolumeState] = useState(getMusicVolumeSync());
  // Playback-control confirmation: an RTDB set() resolves on LOCAL commit
  // even while offline and pends silently when disconnected — so a tap
  // can look accepted while the bot never sees it (the 2026-10-25
  // post-pause dead-button failure: no error, no bot action). The
  // modal's own roomMusic subscription is the witness: musicRef always
  // holds the latest subscribed value, and control() checks bot-side
  // activity against it (see isControlConfirmed below).
  const musicRef = useRef<RoomMusic | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmSeqRef = useRef(0);
  const mountedRef = useRef(true);

  // Picker rows: library first (newest first), then phone songs that are
  // NOT already in the library (they are already in "My songs" above).
  const libraryAssetIds = new Set(
    library.map((e) => e.assetId).filter((x): x is string => !!x),
  );
  const libraryRows: PickerRow[] = library.map((entry) => ({
    key: `lib:${entry.libraryKey}`,
    kind: 'lib',
    entry,
  }));
  const phoneRows: PickerRow[] = assets
    .filter((a) => !libraryAssetIds.has(a.id))
    .map((a) => ({ key: `ph:${a.id}`, kind: 'phone', asset: a }));
  const rows: PickerRow[] = [...libraryRows, ...phoneRows];

  useEffect(() => {
    if (!visible || !roomId) return;
    return subscribeRoomMusic(roomId, setMusic);
  }, [visible, roomId]);

  useEffect(() => {
    musicRef.current = music;
  }, [music]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = null;
      }
    };
  }, []);

  // A pending confirmation must never alert after the user has moved
  // on — closing the modal cancels it outright.
  useEffect(() => {
    if (!visible && confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) setPickerOpen(false);
    else setVolumeState(getMusicVolumeSync());
  }, [visible]);

  // The library belongs to the user, not the room — subscribe whenever
  // the modal is open so the picker can offer it in any room.
  const uid = auth.currentUser?.uid ?? null;
  useEffect(() => {
    if (!visible || !uid) {
      setLibrary([]);
      return;
    }
    return subscribeMusicLibrary(uid, setLibrary);
  }, [visible, uid]);

  const loadAudio = useCallback(async (force = false) => {
    // Cached after the first load: reopening the picker is instant and
    // adding songs never triggers a library refetch. Refresh forces reload.
    if (!force && assetsLoadedRef.current) return;
    setAssetsLoading(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow access to audio files to add music.');
        return;
      }
      const result = await MediaLibrary.getAssetsAsync({
        first: 100,
        mediaType: [MediaLibrary.MediaType.audio],
        sortBy: [MediaLibrary.SortBy.creationTime],
      });
      setAssets([...result.assets].sort((a, b) => (b.creationTime || 0) - (a.creationTime || 0)));
      assetsLoadedRef.current = true;
    } catch {
      Alert.alert('Error', 'Could not load audio files.');
    } finally {
      setAssetsLoading(false);
    }
  }, []);

  const openPicker = () => {
    setPickerOpen(true);
    setSelected({});
    setAddStatus({});
    setBatchError(null);
    setBatchIds([]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    loadAudio();
  };

  const toggleSelect = (row: PickerRow) => {
    if (batchRunning) return;
    setSelected((prev) => {
      const next = { ...prev };
      if (next[row.key]) delete next[row.key];
      else next[row.key] = row;
      return next;
    });
  };

  const selectedCount = Object.keys(selected).length;
  // "Select all" covers phone rows only: the library can hold 200 songs
  // and queueing all of them at once is never what "select all" means.
  const phoneRowKeys = new Set(phoneRows.map((r) => r.key));
  const allSelected = phoneRows.length > 0 && phoneRows.every((r) => selected[r.key]);

  const toggleSelectAll = () => {
    if (batchRunning) return;
    if (allSelected) {
      setSelected((prev) => {
        const next: Record<string, PickerRow> = {};
        Object.values(prev).forEach((r) => {
          if (!phoneRowKeys.has(r.key)) next[r.key] = r;
        });
        return next;
      });
      return;
    }
    setSelected((prev) => {
      const next = { ...prev };
      phoneRows.forEach((r) => {
        next[r.key] = r;
      });
      return next;
    });
  };

  /**
   * Add every selected song. Library songs queue directly (no upload);
   * phone songs reuse their library entry when one exists, otherwise
   * upload once and save to the library so the next room never uploads
   * them again. Resolves run up to 3 at a time (fast), but the queue
   * inserts stay sequential in picker order, so the room hears songs in
   * the order picked. One failure never blocks the rest; failed songs
   * stay selected for a one-tap retry and the picker stays open with the
   * per-song status visible. No raw engine error ever reaches the user.
   */
  const handleAddSelected = async () => {
    // Picker order first; a selected row that vanished from the visible
    // list (library loaded mid-pick and filtered its phone twin) is kept
    // at the end rather than silently dropped.
    const visibleList = rows.filter((r) => selected[r.key]);
    const hiddenSelected = Object.values(selected).filter(
      (r) => !rows.some((x) => x.key === r.key),
    );
    const list = [...visibleList, ...hiddenSelected];
    if (list.length === 0 || batchRunning) return;
    const ids = list.map((r) => r.key);
    setBatchRunning(true);
    setBatchError(null);
    setBatchIds(ids);
    setAddStatus((prev) => {
      const next = { ...prev };
      ids.forEach((id) => {
        next[id] = 'uploading';
      });
      return next;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Phase 1: resolve every row to { title, url, mediaId }, 3 at a time.
    type Resolved =
      | { row: PickerRow; title: string; url: string; mediaId: string; durationSec: number | null }
      | { row: PickerRow; error: string };
    const resolved: Resolved[] = new Array(list.length);
    let nextIdx = 0;
    const workers = Array.from({ length: Math.min(3, list.length) }, async () => {
      while (nextIdx < list.length) {
        const idx = nextIdx++;
        const row = list[idx];
        if (row.kind === 'lib') {
          resolved[idx] = { row, title: row.entry.title, url: row.entry.url, mediaId: row.entry.mediaId, durationSec: row.entry.duration ?? null };
          continue;
        }
        const asset = row.asset;
        const filename = asset.filename || `music-${Date.now()}.mp3`;
        const uidNow = auth.currentUser?.uid ?? null;
        try {
          // Same-device dedup: a phone song already in the library is
          // never uploaded twice.
          if (uidNow) {
            const hit = await findLibraryEntryByAsset(uidNow, asset.id).catch(() => null);
            if (hit) {
              resolved[idx] = { row, title: hit.title, url: hit.url, mediaId: hit.mediaId, durationSec: hit.duration ?? null };
              continue;
            }
          }
          const { mediaId, url } = await uploadMusicFile({ uri: asset.uri, filename });
          if (uidNow) {
            await saveMusicLibraryEntry(uidNow, {
              mediaId,
              url,
              title: filename,
              assetId: asset.id,
              duration: asset.duration ?? null,
              addedAt: Date.now(),
            }).catch(() => {});
          }
          resolved[idx] = { row, title: filename, url, mediaId, durationSec: asset.duration ?? null };
        } catch (e) {
          resolved[idx] = { row, error: friendlyUploadError(e) };
        }
      }
    });
    await Promise.all(workers);

    // Phase 2: queue in picker order.
    let added = 0;
    let failed = 0;
    let firstError: string | null = null;
    const failedKeys = new Set<string>();
    for (const item of resolved) {
      if ('error' in item) {
        failed++;
        failedKeys.add(item.row.key);
        firstError = firstError ?? item.error;
        setAddStatus((prev) => ({ ...prev, [item.row.key]: 'failed' }));
        continue;
      }
      try {
        await addMusicTrack(roomId, { title: item.title, url: item.url, mediaId: item.mediaId, durationSec: item.durationSec }, myName);
        added++;
        setAddStatus((prev) => ({ ...prev, [item.row.key]: 'done' }));
      } catch {
        failed++;
        failedKeys.add(item.row.key);
        firstError = firstError ?? 'Could not add this song to the queue. Please try again.';
        setAddStatus((prev) => ({ ...prev, [item.row.key]: 'failed' }));
      }
    }
    // Auto-play from a FRESH read, never the render closure: after a Stop
    // the room can sit in 'stopped' until the bot converts it to 'idle',
    // and the old `music.state === 'idle'` check missed exactly that
    // window — leaving the song stuck in the queue with no Play button.
    if (added > 0) {
      const fresh = await getRoomMusicOnce(roomId).catch(() => null);
      if (!fresh || fresh.state === 'idle' || fresh.state === 'stopped') {
        await setMusicState(roomId, 'playing').catch(() => {});
      }
    }
    // Clear what made it; keep failures selected for retry.
    setSelected((prev) => {
      const next: Record<string, PickerRow> = {};
      Object.values(prev).forEach((r) => {
        if (failedKeys.has(r.key)) next[r.key] = r;
      });
      return next;
    });
    setBatchRunning(false);
    if (failed > 0) {
      setBatchError(
        added > 0
          ? `${failed} song${failed === 1 ? '' : 's'} failed — ${firstError ?? 'please try again.'} They stay selected for retry.`
          : (firstError ?? 'Could not add songs. Please try again.'),
      );
    } else {
      setBatchError(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  /**
   * Did the BOT act on a control tap? The client itself writes the
   * state, so the subscribed state alone proves nothing for 'playing'
   * (the write lands locally even offline) — only bot-written current
   * changes count there. For 'paused'/'stopped' the subscribed state
   * reflecting the tap is the signal (the bot converts 'stopped' to
   * 'idle', so both count).
   */
  const isControlConfirmed = (
    target: 'playing' | 'paused' | 'next' | 'stopped',
    before: RoomMusic | null,
  ): boolean => {
    const now = musicRef.current;
    if (!now) return false;
    if (target === 'playing') {
      // Resume / Play: a bot start writes a fresh current (new
      // startedAt, or a new queueId when the queue head starts). A
      // ticking positionSec while state is playing is also bot work.
      // Nothing to play (no current, bot dropped to idle) also counts
      // as acted — the bot answered, there was just no song.
      const b = before?.current ?? null;
      const c = now.current;
      if (!c) return !b && now.state === 'idle';
      if (!b) return true;
      if (c.queueId !== b.queueId) return true;
      if (c.startedAt !== b.startedAt) return true;
      if (now.state === 'playing' && c.positionSec !== b.positionSec) return true;
      return false;
    }
    if (target === 'next') {
      // Next: the bot removes the queue head and starts the next song
      // (current queueId changes), or clears current and drops to idle
      // when the queue is empty.
      const b = before?.current ?? null;
      const c = now.current;
      if ((c?.queueId ?? null) !== (b?.queueId ?? null)) return true;
      if (!c && b && now.state === 'idle') return true;
      return false;
    }
    if (target === 'paused') return now.state === 'paused';
    return now.state === 'stopped' || now.state === 'idle';
  };

  /**
   * Drive playback with confirmation. The write itself cannot fail
   * visibly (local commit resolves while offline), so after writing we
   * watch the subscription for bot activity: unconfirmed after ~8s,
   * the write is retried ONCE, and if still unconfirmed the user gets
   * a visible error instead of a dead button. A newer tap supersedes
   * any pending confirmation, and closing/unmounting cancels it — so
   * no alert ever fires for a tap the user has already moved past.
   * The fast path is unchanged: a bot that acts quickly shows nothing.
   */
  const control = (target: 'playing' | 'paused' | 'next' | 'stopped') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    const seq = ++confirmSeqRef.current;
    const before = musicRef.current;
    let retried = false;
    const check = () => {
      confirmTimerRef.current = null;
      if (seq !== confirmSeqRef.current || !mountedRef.current) return;
      if (isControlConfirmed(target, before)) return;
      if (!retried) {
        retried = true;
        setMusicState(roomId, target).catch(() => {});
        confirmTimerRef.current = setTimeout(check, 8000);
        return;
      }
      Alert.alert('Error', 'Could not change playback. Check connection and try again.');
    };
    setMusicState(roomId, target)
      .then(() => {
        if (seq !== confirmSeqRef.current || !mountedRef.current) return;
        confirmTimerRef.current = setTimeout(check, 8000);
      })
      .catch(() => {
        if (seq !== confirmSeqRef.current || !mountedRef.current) return;
        Alert.alert('Error', 'Could not change playback. Check connection and try again.');
      });
  };

  /** Local volume (this phone only): persist + apply to the bot track. */
  const setVol = (v: number) => {
    const clamped = Math.min(1, Math.max(0, Math.round(v * 10) / 10));
    setVolumeState(clamped);
    persistMusicVolume(clamped).catch(() => {});
    onVolumeChange(clamped);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  /**
   * Tap-to-play: play one queued song directly (2026-10-25, boss —
   * no Next-stepping). Writes roomMusic/{roomId}/playQueueId; the bot
   * consumes it first in reconcile. Confirmation reuses the control
   * pattern: the write itself resolves on local commit even offline,
   * so only bot-side activity counts — the tapped song becoming
   * current, or the tapped id leaving the queue while current changed.
   * Unconfirmed after ~8s, the write is retried ONCE, then the user
   * gets a visible error instead of a dead tap. A newer tap supersedes
   * any pending confirmation.
   */
  const playTrack = (queueId: string) => {
    if (!canControl) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    const seq = ++confirmSeqRef.current;
    const before = musicRef.current;
    const beforeCurrentId = before?.current?.queueId ?? null;
    let retried = false;
    const isTapConfirmed = (): boolean => {
      const now = musicRef.current;
      if (!now) return false;
      if (now.current?.queueId === queueId) return true;
      const stillQueued = (now.queue ?? []).some((t) => t.queueId === queueId);
      if (!stillQueued && (now.current?.queueId ?? null) !== beforeCurrentId) return true;
      return false;
    };
    const check = () => {
      confirmTimerRef.current = null;
      if (seq !== confirmSeqRef.current || !mountedRef.current) return;
      if (isTapConfirmed()) return;
      if (!retried) {
        retried = true;
        setPlayQueueId(roomId, queueId).catch(() => {});
        confirmTimerRef.current = setTimeout(check, 8000);
        return;
      }
      Alert.alert('Error', 'Could not play this song. Check connection and try again.');
    };
    setPlayQueueId(roomId, queueId)
      .then(() => {
        if (seq !== confirmSeqRef.current || !mountedRef.current) return;
        confirmTimerRef.current = setTimeout(check, 8000);
      })
      .catch(() => {
        if (seq !== confirmSeqRef.current || !mountedRef.current) return;
        Alert.alert('Error', 'Could not play this song. Check connection and try again.');
      });
  };

  const displayTitle = (title: string) => title.replace(/\.[^.]+$/, '');
  const fmtDur = (sec: number) => {
    const s = Math.floor(sec || 0);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  /** One picker row (library song or phone song) with its select box. */
  const renderPickerRow = (row: PickerRow) => {
    const isSel = !!selected[row.key];
    const status = addStatus[row.key];
    const title = row.kind === 'lib' ? row.entry.title : row.asset.filename || 'Unknown';
    const sub =
      status === 'uploading'
        ? 'Uploading…'
        : status === 'done'
          ? 'Added ✓'
          : status === 'failed'
            ? 'Failed — stays selected for retry'
            : row.kind === 'lib'
              ? row.entry.duration
                ? fmtDur(row.entry.duration)
                : 'Saved song'
              : fmtDur(row.asset.duration);
    return (
      <Pressable
        key={row.key}
        onPress={() => toggleSelect(row)}
        disabled={batchRunning}
        style={{ flexDirection: 'row', alignItems: 'center',
          paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.borderFaint,
          opacity: batchRunning && status !== 'uploading' ? 0.5 : 1 }}>
        <Feather name="music" size={16} color="#7C3AED" style={{ marginRight: 10 }} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>
            {displayTitle(title)}
          </Text>
          <Text style={{ color: status === 'failed' ? '#EF4444' : C.muted, fontSize: 12, marginTop: 2 }}>
            {sub}
          </Text>
        </View>
        <View style={{ width: 24, height: 24, borderRadius: 12,
          borderWidth: 2, borderColor: isSel ? '#7C3AED' : C.borderFaint,
          backgroundColor: isSel ? '#7C3AED' : 'transparent',
          alignItems: 'center', justifyContent: 'center' }}>
          {isSel && <Feather name="check" size={14} color="#FFF" />}
        </View>
      </Pressable>
    );
  };

  const current = music?.current ?? null;
  const state = music?.state ?? 'idle';
  const playing = state === 'playing';
  const paused = state === 'paused';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26,
        borderWidth: 1, borderColor: 'rgba(139,92,246,0.35)', maxHeight: '88%' }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.muted,
          alignSelf: 'center', marginTop: 12, marginBottom: 4 }} />
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: pickerOpen ? 100 : 20 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            {pickerOpen ? (
              <>
                <Pressable onPress={() => setPickerOpen(false)} style={{ padding: 6, marginRight: 8 }}>
                  <Feather name="arrow-left" size={24} color={C.sub} />
                </Pressable>
                <Text style={{ color: C.text, fontSize: 22, flex: 1 }}>
                  Add
                </Text>
                <Pressable onPress={() => loadAudio(true)} disabled={assetsLoading || batchRunning} style={{ padding: 6 }}>
                  <Feather name="refresh-cw" size={20} color="#7C3AED" />
                </Pressable>
              </>
            ) : (
              <>
                <Text style={{ color: C.text, fontSize: 22, flex: 1 }}>
                  Music Playlist
                </Text>
                {canControl && (
                  <Pressable onPress={openPicker} style={{ padding: 6, marginRight: 8 }}>
                    <Feather name="plus" size={28} color="#7C3AED" />
                  </Pressable>
                )}
                <Pressable onPress={onClose} style={{ padding: 6 }}>
                  <Feather name="x" size={22} color={C.sub} />
                </Pressable>
              </>
            )}
          </View>

          {pickerOpen ? (
            <>
              <Pressable onPress={toggleSelectAll} disabled={assetsLoading || batchRunning}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.borderFaint }}>
                <Text style={{ color: C.text, fontSize: 16 }}>
                  {allSelected ? 'Clear selection' : 'Select all'}
                </Text>
                <View style={{ width: 26, height: 26, borderRadius: 13,
                  borderWidth: 2, borderColor: allSelected ? '#7C3AED' : C.borderFaint,
                  backgroundColor: allSelected ? '#7C3AED' : 'transparent',
                  alignItems: 'center', justifyContent: 'center' }}>
                  {allSelected && <Feather name="check" size={15} color="#FFF" />}
                </View>
              </Pressable>
              <Text style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>
                {assetsLoading
                  ? 'Loading…'
                  : `${rows.length} songs — tap to select (Select all covers phone songs)`}
              </Text>
              {assetsLoading ? (
                <Text style={{ color: C.muted, fontSize: 14, textAlign: 'center', paddingVertical: 24 }}>
                  Loading audio…
                </Text>
              ) : rows.length === 0 ? (
                <Text style={{ color: C.muted, fontSize: 14, textAlign: 'center', paddingVertical: 24 }}>
                  No audio files found on this phone.
                </Text>
              ) : (
                <>
                  {libraryRows.length > 0 && (
                    <>
                      <Text style={{ color: C.sub, fontSize: 12, fontWeight: '800', marginTop: 8, marginBottom: 2 }}>
                        My songs — in any room, no re-upload ({libraryRows.length})
                      </Text>
                      {libraryRows.map(renderPickerRow)}
                    </>
                  )}
                  {phoneRows.length > 0 && (
                    <>
                      <Text style={{ color: C.sub, fontSize: 12, fontWeight: '800', marginTop: 8, marginBottom: 2 }}>
                        From phone
                      </Text>
                      {phoneRows.map(renderPickerRow)}
                    </>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              {/* Now playing */}
              <View style={{ backgroundColor: 'rgba(139,92,246,0.08)',
                borderRadius: 16, padding: 16,
                borderWidth: 1, borderColor: 'rgba(139,92,246,0.25)' }}>
                <Text style={{ color: C.sub, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>
                  {playing ? 'NOW PLAYING' : paused ? 'PAUSED' : current ? 'STOPPED' : 'NOTHING PLAYING'}
                </Text>
                <Text numberOfLines={2} style={{ color: C.text, fontSize: 16, fontWeight: '800' }}>
                  {current ? displayTitle(current.title) : 'No music yet'}
                </Text>
                {!!current && (
                  <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
                    Added by {current.addedByName} · Playing for the whole room
                  </Text>
                )}
                {canControl && (playing || paused) && (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                    {playing && (
                      <Pressable onPress={() => control('paused')}
                        style={{ flex: 1, backgroundColor: '#7C3AED', borderRadius: 12,
                          paddingVertical: 11, alignItems: 'center' }}>
                        <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 14 }}>Pause</Text>
                      </Pressable>
                    )}
                    {paused && (
                      <Pressable onPress={() => control('playing')}
                        style={{ flex: 1, backgroundColor: '#7C3AED', borderRadius: 12,
                          paddingVertical: 11, alignItems: 'center' }}>
                        <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 14 }}>Resume</Text>
                      </Pressable>
                    )}
                    <Pressable onPress={() => control('next')}
                      style={{ flex: 1, backgroundColor: C.card, borderRadius: 12,
                        paddingVertical: 11, alignItems: 'center',
                        borderWidth: 1, borderColor: C.borderFaint }}>
                      <Text style={{ color: C.text, fontWeight: '800', fontSize: 14 }}>Next</Text>
                    </Pressable>
                    <Pressable onPress={() => control('stopped')}
                      style={{ flex: 1, backgroundColor: C.card, borderRadius: 12,
                        paddingVertical: 11, alignItems: 'center',
                        borderWidth: 1, borderColor: C.borderFaint }}>
                      <Text style={{ color: C.text, fontWeight: '800', fontSize: 14 }}>Stop</Text>
                    </Pressable>
                  </View>
                )}
                {/* After a Stop the song used to be unrecoverable and the
                    queue orphaned with no way to start it. Play restarts
                    the stopped song from the beginning, or the queue head
                    when nothing is current. */}
                {canControl && (state === 'idle' || state === 'stopped') && (current || (music?.queue.length ?? 0) > 0) && (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                    <Pressable onPress={() => control('playing')}
                      style={{ flex: 1, backgroundColor: '#7C3AED', borderRadius: 12,
                        paddingVertical: 11, alignItems: 'center' }}>
                      <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 14 }}>Play</Text>
                    </Pressable>
                    {(music?.queue.length ?? 0) > 0 && (
                      <Pressable onPress={() => control('next')}
                        style={{ flex: 1, backgroundColor: C.card, borderRadius: 12,
                          paddingVertical: 11, alignItems: 'center',
                          borderWidth: 1, borderColor: C.borderFaint }}>
                        <Text style={{ color: C.text, fontWeight: '800', fontSize: 14 }}>Next</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>

              {/* Music volume — LOCAL to this phone (everyone, not gated). */}
              {!!current && (
                <View style={{ marginTop: 16 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: C.sub, fontSize: 13, fontWeight: '700' }}>
                      Music volume
                    </Text>
                    <Text style={{ color: C.sub, fontSize: 13, fontWeight: '800' }}>
                      {Math.round(volume * 100)}%
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
                    <Pressable onPress={() => setVol(volume - 0.1)}
                      style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.card,
                        alignItems: 'center', justifyContent: 'center',
                        borderWidth: 1, borderColor: C.borderFaint }}>
                      <Feather name="minus" size={16} color={C.text} />
                    </Pressable>
                    <View style={{ flex: 1, flexDirection: 'row', gap: 3 }}>
                      {Array.from({ length: 10 }, (_, i) => (
                        <Pressable key={i} onPress={() => setVol((i + 1) / 10)}
                          style={{ flex: 1, height: 10, borderRadius: 5,
                            backgroundColor: i < Math.round(volume * 10) ? '#7C3AED' : C.borderFaint }}
                        />
                      ))}
                    </View>
                    <Pressable onPress={() => setVol(volume + 0.1)}
                      style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.card,
                        alignItems: 'center', justifyContent: 'center',
                        borderWidth: 1, borderColor: C.borderFaint }}>
                      <Feather name="plus" size={16} color={C.text} />
                    </Pressable>
                  </View>
                  <Text style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>
                    Volume is only for your phone — it never changes others'.
                  </Text>
                </View>
              )}

              {/* Queue — rows are tappable (canControl): tap plays the song
                  directly via playQueueId; the × remove stays a sibling so
                  the two Pressables never nest. */}
              <Text style={{ color: C.sub, fontSize: 13, fontWeight: '700', marginTop: 20, marginBottom: 4 }}>
                Up next ({music?.queue.length ?? 0})
              </Text>
              {canControl && (music?.queue.length ?? 0) > 0 && (
                <Text style={{ color: '#7C3AED', fontSize: 12, marginBottom: 4 }}>
                  Tap any song to play it directly.
                </Text>
              )}
              {(music?.queue.length ?? 0) === 0 ? (
                <Text style={{ color: C.muted, fontSize: 13, paddingVertical: 8 }}>
                  Queue is empty.
                </Text>
              ) : (
                music!.queue.map((t) => (
                  <View key={t.queueId} style={{ flexDirection: 'row', alignItems: 'center',
                    paddingVertical: 11, borderTopWidth: 1, borderTopColor: C.borderFaint }}>
                    <Pressable onPress={() => playTrack(t.queueId)} disabled={!canControl}
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                      <Feather name="music" size={15} color={C.muted} style={{ marginRight: 10 }} />
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>
                          {displayTitle(t.title)}
                        </Text>
                        <Text style={{ color: C.muted, fontSize: 12, marginTop: 1 }}>
                          Added by {t.addedByName}
                        </Text>
                      </View>
                      {canControl && (
                        <Feather name="play" size={14} color="#7C3AED" style={{ marginLeft: 8 }} />
                      )}
                    </Pressable>
                    {canControl && (
                      <Pressable
                        onPress={() => removeQueueTrack(roomId, t.queueId).catch(() => {})}
                        style={{ padding: 6, marginLeft: 4 }}>
                        <Feather name="x" size={16} color={C.muted} />
                      </Pressable>
                    )}
                  </View>
                ))
              )}

              {canControl && (
                <>
                  <Pressable onPress={openPicker}
                    style={{ marginTop: 16, backgroundColor: '#7C3AED', borderRadius: 14,
                      paddingVertical: 14, alignItems: 'center' }}>
                    <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 15 }}>
                      + Add
                    </Text>
                  </Pressable>
                  <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 10 }}>
                    Only mp3, wav, and m4a are supported for music playing.
                  </Text>
                </>
              )}
            </>
          )}
        </ScrollView>
        {pickerOpen && (
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0,
            backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: C.borderFaint,
            paddingHorizontal: 20, paddingVertical: 12 }}>
            {!!batchError && (
              <Text style={{ color: '#EF4444', fontSize: 12, marginBottom: 8 }}>{batchError}</Text>
            )}
            <Pressable onPress={handleAddSelected}
              disabled={selectedCount === 0 || batchRunning}
              style={{ backgroundColor: selectedCount === 0 || batchRunning ? C.borderFaint : '#7C3AED',
                borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}>
              <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 15 }}>
                {batchRunning
                  ? `Adding ${batchIds.filter((id) => addStatus[id] === 'done' || addStatus[id] === 'failed').length}/${batchIds.length}…`
                  : selectedCount > 0
                    ? `Add ${selectedCount} song${selectedCount === 1 ? '' : 's'}`
                    : 'Select songs to add'}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}
