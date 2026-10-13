/**
 * StoryShareScreen — IMO-exact story editor/share page (Notes 2, Batch C).
 *
 * - REAL posting: text/photo/video/audio stories upload (Cloudinary) and
 *   persist to Firebase. No simulated success anywhere.
 * - Music: picks a real audio file via the phone file manager
 *   (expo-document-picker) and uploads it — filename-only text is NOT accepted.
 * - Right toolbar — every control is REAL and functional:
 *   emoji (inserts into text), text style (cycles styles), draw (freehand SVG
 *   strokes saved with the story), location (real reverse-geocoded place),
 *   @mention (real friend picker, stored as userIds), camera effects
 *   (real visual filters applied to the preview and saved with the story).
 * - Background swatches: TEXT stories only, never photo/video.
 * - Audience: Everyone → public (My Story + Planet); My Contact → contacts only
 *   (server-side enforced via contactStories/ Firebase rules — never Planet).
 * - Video preview uses real expo-video playback, never a static Image.
 * - Every error surfaces its ACTUAL cause (getErrorCause).
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, Pressable, Image, TextInput,
  Dimensions, Alert, ActivityIndicator, ScrollView,
  PanResponder, GestureResponderEvent,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import { VideoView, useVideoPlayer } from 'expo-video';
import Svg, { Polyline } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { ref, get } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { getUser } from '@/src/services/userService';
import { useAuth } from '@/src/context/AuthContext';
import { publishStory } from '@/src/features/chat/services/firebaseStoryService';
import Draggable from '../components/Draggable';
import DraggableZoomable from '../components/DraggableZoomable';
import {
  uploadStoryImage,
  uploadStoryVideo,
  uploadStoryAudio,
} from '@/src/features/chat/services/cloudinaryService';
import { getErrorCause } from '@/src/utils/errorDisplay';
import type { DrawingStroke } from '@/src/features/chat/types';
import { STORY_EFFECTS } from '@/src/features/chat/data/storyEffects';

const { width, height } = Dimensions.get('window');

// 8 background colors for TEXT stories (IMO style)
const BG_COLORS = [
  '#7C3AED', // purple
  '#EC4899', // pink
  '#F59E0B', // orange
  '#10B981', // green
  '#3B82F6', // blue
  '#EF4444', // red
  '#8B5CF6', // violet
  '#000000', // black
];

const EMOJIS = ['😀', '😂', '😍', '🔥', '🎉', '👏', '❤️', '🥳', '😎', '💯'];

const TEXT_STYLES = [
  { fontSize: 24, fontWeight: '700' as const, fontStyle: 'normal' as const, letterSpacing: 0 },
  { fontSize: 34, fontWeight: '900' as const, fontStyle: 'normal' as const, letterSpacing: 0 },
  { fontSize: 24, fontWeight: '400' as const, fontStyle: 'italic' as const, letterSpacing: 0 },
  { fontSize: 26, fontWeight: '800' as const, fontStyle: 'normal' as const, letterSpacing: 3 },
];

const DRAW_COLORS = ['#FFFFFF', '#FFD60A', '#FF453A', '#30D158', '#0A84FF'];

const EFFECTS = STORY_EFFECTS;

type Audience = 'everyone' | 'contacts';

type Friend = { uid: string; name: string; photoURL?: string };

/** Real video preview for the share page (expo-video, not a static Image). */
function ShareVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });
  useEffect(() => {
    return () => {
      try { player.pause(); } catch { /* ignore */ }
    };
  }, [player]);
  return (
    <VideoView
      player={player}
      style={{ width, height: height * 0.7 }}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

export default function StoryShareScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuth();
  const params = useLocalSearchParams();

  const mode = (params.mode as string) || 'photo';
  const assetUri = params.uri as string;
  const assetType = (params.mediaType as string) || 'image'; // 'photo' | 'video' from gallery

  const collageAssets: { id: string; uri: string }[] = (() => {
    try {
      const raw = params.assets as string;
      if (mode === 'collage' && raw) {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch { /* ignore malformed */ }
    return [];
  })();

  const [text, setText] = useState('');
  // 2026-10-11: Text overlay for photo mode (#11, #14).
  const [photoText, setPhotoText] = useState('');
  const [photoTextOpen, setPhotoTextOpen] = useState(false);
  const [bgColor, setBgColor] = useState(BG_COLORS[0]);
  const [audience, setAudience] = useState<Audience>('everyone');
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [musicUri, setMusicUri] = useState<string | null>(null);
  const [musicName, setMusicName] = useState<string | null>(null);
  const [musicMimeType, setMusicMimeType] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [cameraUri, setCameraUri] = useState<string | null>(null);
  const [cameraIsVideo, setCameraIsVideo] = useState(false);

  // ── Toolbar state (all real) ──
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [textStyleIdx, setTextStyleIdx] = useState(0);
  const [drawMode, setDrawMode] = useState(false);
  const [drawColor, setDrawColor] = useState(DRAW_COLORS[0]);
  const [strokes, setStrokes] = useState<DrawingStroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<DrawingStroke | null>(null);
  const [location, setLocation] = useState<{ name: string } | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [mentions, setMentions] = useState<string[]>([]);
  const [effectIdx, setEffectIdx] = useState(0);

  const isTextMode = mode === 'text';
  const isCameraMode = mode === 'camera';
  const isMusicMode = mode === 'music';
  const isCollageMode = mode === 'collage';

  // Refs for the draw PanResponder (avoids stale closures)
  const drawModeRef = useRef(drawMode);
  drawModeRef.current = drawMode;
  const drawColorRef = useRef(drawColor);
  drawColorRef.current = drawColor;
  const layoutRef = useRef({ w: 1, h: 1 });
  const [layoutSize, setLayoutSize] = useState({ w: 1, h: 1 });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => drawModeRef.current,
      onMoveShouldSetPanResponder: () => drawModeRef.current,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        const { locationX, locationY } = e.nativeEvent;
        const { w, h } = layoutRef.current;
        setCurrentStroke({
          color: drawColorRef.current,
          width: 5,
          points: [{ x: locationX / w, y: locationY / h }],
        });
      },
      onPanResponderMove: (e: GestureResponderEvent) => {
        const { locationX, locationY } = e.nativeEvent;
        const { w, h } = layoutRef.current;
        setCurrentStroke((prev) =>
          prev
            ? { ...prev, points: [...prev.points, { x: locationX / w, y: locationY / h }] }
            : prev,
        );
      },
      onPanResponderRelease: () => {
        setCurrentStroke((prev) => {
          if (prev && prev.points.length > 0) {
            setStrokes((s) => [...s, prev]);
          }
          return null;
        });
      },
      onPanResponderTerminate: () => setCurrentStroke(null),
    }),
  ).current;

  // ── Camera (photo AND video for stories) ──
  useEffect(() => {
    if (isCameraMode && !cameraUri) {
      (async () => {
        try {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert(
              t('story.error', { defaultValue: 'Error' }),
              t('story.cameraPermission', { defaultValue: 'Camera permission required' }),
              [{ text: 'OK', onPress: () => router.back() }],
            );
            return;
          }
          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.All,
            quality: 0.8,
            videoMaxDuration: 60,
          });
          if (!result.canceled && result.assets[0]) {
            setCameraUri(result.assets[0].uri);
            setCameraIsVideo(result.assets[0].type === 'video');
          } else {
            router.back();
          }
        } catch (error) {
          Alert.alert(
            t('story.error', { defaultValue: 'Error' }),
            getErrorCause(error),
            [{ text: 'OK', onPress: () => router.back() }],
          );
        }
      })();
    }
  }, [isCameraMode, cameraUri, router, t]);

  // ── Real music picker: phone file manager (audio/*) ──
  const handleSelectMusic = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const file = result.assets[0];
      setMusicUri(file.uri);
      setMusicName(file.name || 'Music');
      setMusicMimeType(file.mimeType || null);
    } catch (error) {
      Alert.alert(
        t('story.error', { defaultValue: 'Error' }),
        getErrorCause(error),
      );
    }
  }, [t]);

  // Music mode: auto-open the file picker on mount
  useEffect(() => {
    if (isMusicMode && !musicUri) {
      handleSelectMusic();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMusicMode]);

  // ── Toolbar: emoji ──
  const handleEmoji = useCallback(() => {
    setEmojiOpen((v) => !v);
  }, []);

  const insertEmoji = useCallback((emoji: string) => {
    // 2026-10-11: In photo mode, emoji goes to the photo text overlay.
    if (!isTextMode && (assetUri || cameraUri)) {
      setPhotoText((prev) => prev + emoji);
    } else {
      setText((prev) => prev + emoji);
    }
  }, [isTextMode, assetUri, cameraUri]);

  // ── Toolbar: text (opens text overlay in photo mode, 2026-10-11) ──
  const handleText = useCallback(() => {
    if (!isTextMode && (assetUri || cameraUri)) {
      setPhotoTextOpen((v) => !v);
    } else {
      // In text mode, focus the text input (handled by UI).
      handleTextStyle();
    }
  }, [isTextMode, assetUri, cameraUri]);

  // ── Toolbar: text style (cycles 4 real styles) ──
  const handleTextStyle = useCallback(() => {
    setTextStyleIdx((i) => (i + 1) % TEXT_STYLES.length);
  }, []);

  // ── Toolbar: draw (toggles freehand mode) ──
  const handleDraw = useCallback(() => {
    setDrawMode((v) => !v);
  }, []);

  const undoStroke = useCallback(() => {
    setStrokes((s) => s.slice(0, -1));
  }, []);

  // ── Toolbar: location (real reverse-geocoded place) ──
  const handleLocation = useCallback(async () => {
    if (location) {
      setLocation(null); // tap again to remove
      return;
    }
    setLocationLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        throw new Error(
          t('story.locationPermission', { defaultValue: 'Location permission denied' }),
        );
      }
      const pos = await Location.getCurrentPositionAsync({});
      const places = await Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      const p = places[0];
      const name =
        p?.city || p?.district || p?.subregion || p?.name || p?.country || null;
      if (!name) {
        throw new Error(
          t('story.locationNotFound', { defaultValue: 'Could not determine your location name' }),
        );
      }
      setLocation({ name });
    } catch (error) {
      Alert.alert(t('story.error', { defaultValue: 'Error' }), getErrorCause(error));
    } finally {
      setLocationLoading(false);
    }
  }, [location, t]);

  // ── Toolbar: @mention (real friend picker) ──
  const openMentions = useCallback(async () => {
    if (!user?.uid) return;
    setMentionOpen(true);
    if (friends.length > 0) return;
    setFriendsLoading(true);
    try {
      const snap = await get(ref(database, `friends/${user.uid}`));
      const uids: string[] = [];
      if (snap.exists()) {
        snap.forEach((child) => {
          if (child.key) uids.push(child.key);
        });
      }
      const list: Friend[] = [];
      for (const uid of uids.slice(0, 30)) {
        try {
          const u: any = await getUser(uid);
          if (u) {
            list.push({
              uid,
              name: u.name || u.displayName || 'Vee User',
              photoURL: u.photoURL || (u as any).avatar || (u as any).dp,
            });
          }
        } catch { /* skip unreadable profiles */ }
      }
      setFriends(list);
    } catch (error) {
      Alert.alert(t('story.error', { defaultValue: 'Error' }), getErrorCause(error));
      setMentionOpen(false);
    } finally {
      setFriendsLoading(false);
    }
  }, [user?.uid, friends.length, t]);

  const selectMention = useCallback((f: Friend) => {
    setText((prev) => (prev ? `${prev} @${f.name} ` : `@${f.name} `));
    setMentions((prev) => (prev.includes(f.uid) ? prev : [...prev, f.uid]));
    setMentionOpen(false);
  }, []);

  // ── Toolbar: camera effects (cycles real visual filters) ──
  const handleEffect = useCallback(() => {
    setEffectIdx((i) => (i + 1) % EFFECTS.length);
  }, []);

  // ── REAL share: upload + publish to Firebase ──
  const handleShare = useCallback(async () => {
    if (!user?.uid) {
      Alert.alert(
        t('story.error', { defaultValue: 'Error' }),
        t('story.notLoggedIn', { defaultValue: 'Please log in to post a story' }),
      );
      return;
    }
    if (posting) return;

    // Validation per mode (before any upload)
    if (isTextMode && !text.trim()) {
      Alert.alert(
        t('story.error', { defaultValue: 'Error' }),
        t('story.emptyText', { defaultValue: 'Please write something' }),
      );
      return;
    }
    if (isMusicMode && !musicUri) {
      Alert.alert(
        t('story.error', { defaultValue: 'Error' }),
        t('story.noMusicSelected', { defaultValue: 'Please select a music file first' }),
      );
      return;
    }
    if (isCollageMode && collageAssets.length === 0) {
      Alert.alert(
        t('story.error', { defaultValue: 'Error' }),
        t('story.noMedia', { defaultValue: 'No photos selected' }),
      );
      return;
    }

    setPosting(true);
    try {
      // Everyone → public (My Story + Planet). My Contact → contacts only,
      // enforced server-side by contactStories/ Firebase rules (never Planet).
      const privacy = audience === 'everyone' ? 'public' : 'contacts';
      // Real name/avatar from RTDB (2026-10-11): Auth fields may be unset/stale.
      let userName = user.displayName || 'Vee User';
      let userAvatar = user.photoURL || undefined;
      try {
        const { get: dbGet, ref: dbRef } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        const nameSnap = await dbGet(dbRef(database, `users/${user.uid}/name`));
        if (nameSnap.exists() && nameSnap.val()) userName = nameSnap.val() as string;
        const avatarSnap = await dbGet(dbRef(database, `users/${user.uid}/photoURL`));
        if (avatarSnap.exists() && avatarSnap.val()) userAvatar = avatarSnap.val() as string;
      } catch { /* non-critical — fallback to Auth fields */ }
      const style = TEXT_STYLES[textStyleIdx];
      const common = {
        bgGradient: [bgColor, bgColor] as [string, string],
        mentions,
        privacy: privacy as 'public' | 'contacts',
        drawing: strokes.length > 0 ? strokes : undefined,
        locationName: location?.name,
        effect: effectIdx === 0 ? undefined : effectIdx,
        textColor: '#FFFFFF',
      };

      if (isTextMode) {
        // 2026-10-11: Text + music — upload selected music as background.
        let musicUrl: string | undefined;
        let musicNameOut: string | undefined;
        if (musicUri) {
          const up = await uploadStoryAudio(musicUri, musicName || undefined, musicMimeType || undefined);
          musicUrl = up.url;
          musicNameOut = musicName || 'Music';
        }
        await publishStory(user.uid, userName, userAvatar, {
          type: 'text',
          content: text.trim(),
          ...(musicUrl ? { musicUrl, musicName: musicNameOut } : {}),
          ...common,
        });
      } else if (isMusicMode) {
        // REAL audio upload — the file is uploaded and its URL stored so it plays.
        const up = await uploadStoryAudio(musicUri!, musicName || undefined, musicMimeType || undefined);
        await publishStory(user.uid, userName, userAvatar, {
          type: 'audio',
          content: up.url,
          audioName: musicName || 'Music',
          cloudinaryId: up.publicId,
          ...common,
        });
      } else if (isCollageMode) {
        // REAL collage: upload every selected photo, publish each as a story.
        for (const a of collageAssets) {
          const up = await uploadStoryImage(a.uri);
          await publishStory(user.uid, userName, userAvatar, {
            type: 'image',
            content: up.url,
            cloudinaryId: up.publicId,
            bgGradient: ['#000000', '#000000'],
            mentions,
            privacy: privacy as 'public' | 'contacts',
            drawing: strokes.length > 0 ? strokes : undefined,
            locationName: location?.name,
            effect: effectIdx === 0 ? undefined : effectIdx,
          });
        }
      } else {
        const mediaUri = assetUri || cameraUri;
        if (!mediaUri) {
          throw new Error(t('story.noMedia', { defaultValue: 'No media selected' }));
        }
        // Gallery picks report mediaType; camera captures track their own flag.
        const isVideo = cameraUri ? cameraIsVideo : assetType === 'video';
        if (isVideo) {
          const up = await uploadStoryVideo(mediaUri);
          await publishStory(user.uid, userName, userAvatar, {
            type: 'video',
            content: up.url,
            cloudinaryId: up.publicId,
            bgGradient: ['#000000', '#000000'],
            mentions,
            privacy: privacy as 'public' | 'contacts',
            drawing: strokes.length > 0 ? strokes : undefined,
            locationName: location?.name,
            effect: effectIdx === 0 ? undefined : effectIdx,
          });
        } else {
          const up = await uploadStoryImage(mediaUri);
          // 2026-10-11: Photo + music — upload selected music as background.
          let musicUrl: string | undefined;
          let musicNameOut: string | undefined;
          if (musicUri) {
            const mUp = await uploadStoryAudio(musicUri, musicName || undefined, musicMimeType || undefined);
            musicUrl = mUp.url;
            musicNameOut = musicName || 'Music';
          }
          await publishStory(user.uid, userName, userAvatar, {
            type: 'image',
            content: up.url,
            cloudinaryId: up.publicId,
            bgGradient: ['#000000', '#000000'],
            mentions,
            privacy: privacy as 'public' | 'contacts',
            drawing: strokes.length > 0 ? strokes : undefined,
            locationName: location?.name,
            effect: effectIdx === 0 ? undefined : effectIdx,
            ...(musicUrl ? { musicUrl, musicName: musicNameOut } : {}),
            ...(photoText.trim() ? { overlayText: photoText.trim() } : {}),
          });
        }
      }

      Alert.alert(
        t('story.success', { defaultValue: 'Success' }),
        t('story.posted', { defaultValue: 'Story posted!' }),
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (error) {
      // Standing rule: show the ACTUAL cause, never a generic message.
      Alert.alert(t('story.error', { defaultValue: 'Error' }), getErrorCause(error));
    } finally {
      setPosting(false);
    }
  }, [
    user, posting, isTextMode, isMusicMode, isCollageMode,
    text, musicUri, musicName, musicMimeType, collageAssets, assetUri, cameraUri,
    cameraIsVideo, assetType, audience, bgColor, textStyleIdx,
    mentions, strokes, location, effectIdx, t, router,
  ]);

  const style = TEXT_STYLES[textStyleIdx];
  const effect = EFFECTS[effectIdx];
  const mediaUri = assetUri || cameraUri;
  const isVideoPreview = !isTextMode && !isMusicMode && !isCollageMode && mediaUri
    && (cameraUri ? cameraIsVideo : assetType === 'video');

  const renderDrawing = () => {
    const all = currentStroke ? [...strokes, currentStroke] : strokes;
    if (all.length === 0) return null;
    const { w, h } = layoutSize;
    return (
      <Svg
        width={w}
        height={h}
        style={{ position: 'absolute', top: 0, left: 0 }}
        pointerEvents="none"
      >
        {all.map((s, i) => (
          <Polyline
            key={i}
            points={s.points.map((p) => `${p.x * w},${p.y * h}`).join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth={s.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </Svg>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* Top bar */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingTop: 50, paddingHorizontal: 16, paddingBottom: 12,
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
      }}>
        <Pressable onPress={() => router.back()} style={{ padding: 4 }}>
          <Feather name="x" size={24} color="#fff" />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Pressable
            onPress={handleSelectMusic}
            style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: 'rgba(255,255,255,0.2)',
              borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8,
            }}
          >
            <Feather name="music" size={14} color="#fff" style={{ marginRight: 6 }} />
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
              {musicName || t('story.selectMusic', { defaultValue: 'Select Music' })}
            </Text>
          </Pressable>
        </View>
        <View style={{ width: 32 }} />
      </View>

      {/* Story content (measured for drawing) */}
      <View
        style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
        onLayout={(e) => {
          const size = {
            w: e.nativeEvent.layout.width,
            h: e.nativeEvent.layout.height,
          };
          layoutRef.current = size;
          setLayoutSize(size);
        }}
      >
        {isTextMode ? (
          <View style={{
            width: width - 40, minHeight: 300,
            backgroundColor: bgColor, borderRadius: 16,
            justifyContent: 'center', alignItems: 'center', padding: 20,
          }}>
            <TextInput
              style={{
                color: '#fff',
                fontSize: style.fontSize,
                fontWeight: style.fontWeight,
                fontStyle: style.fontStyle,
                letterSpacing: style.letterSpacing,
                textAlign: 'center', width: '100%',
              }}
              placeholder={t('story.writeSomething', { defaultValue: 'Write something...' })}
              placeholderTextColor="rgba(255,255,255,0.6)"
              value={text}
              onChangeText={setText}
              multiline
              autoFocus
            />
          </View>
        ) : isVideoPreview ? (
          <ShareVideoPreview uri={mediaUri as string} />
        ) : mediaUri ? (
          <View>
            <Image
              source={{ uri: mediaUri }}
              style={{ width, height: height * 0.7 }}
              resizeMode="contain"
            />
            {/* Draggable + zoomable text overlay (2026-10-11, #14) */}
            {photoText ? (
              <DraggableZoomable initialX={width / 2 - 100} initialY={height * 0.3}>
                {(scale) => (
                  <Text style={{
                    color: '#fff',
                    fontSize: 24 * scale,
                    fontWeight: '800',
                    textAlign: 'center',
                    textShadowColor: 'rgba(0,0,0,0.8)',
                    textShadowOffset: { width: 0, height: 2 },
                    textShadowRadius: 4,
                    minWidth: 200,
                  }}>
                    {photoText}
                  </Text>
                )}
              </DraggableZoomable>
            ) : null}
            {/* Text input for photo overlay (2026-10-11, #11) */}
            {photoTextOpen && (
              <View style={{
                position: 'absolute', bottom: 20, left: 20, right: 20,
                backgroundColor: 'rgba(0,0,0,0.8)', borderRadius: 12, padding: 12,
              }}>
                <TextInput
                  style={{ color: '#fff', fontSize: 16 }}
                  placeholder={t('story.writeSomething', { defaultValue: 'Write something...' })}
                  placeholderTextColor="rgba(255,255,255,0.6)"
                  value={photoText}
                  onChangeText={setPhotoText}
                  multiline
                  autoFocus
                />
                <Pressable
                  onPress={() => setPhotoTextOpen(false)}
                  style={{ marginTop: 8, alignSelf: 'flex-end', backgroundColor: '#1877F2', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>{t('story.done', { defaultValue: 'Done' })}</Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : isMusicMode ? (
          <View style={{
            width: width - 40, minHeight: 300,
            backgroundColor: bgColor, borderRadius: 16,
            justifyContent: 'center', alignItems: 'center', padding: 20,
          }}>
            <Feather name="music" size={48} color="#fff" style={{ marginBottom: 16 }} />
            <Text style={{ color: '#fff', fontSize: 16, textAlign: 'center', marginBottom: 12 }}>
              {musicName || t('story.tapMusic', { defaultValue: 'Tap "Select Music" above to add music' })}
            </Text>
            <TextInput
              style={{
                color: '#fff',
                fontSize: style.fontSize,
                fontWeight: style.fontWeight,
                fontStyle: style.fontStyle,
                textAlign: 'center', width: '100%',
              }}
              placeholder={t('story.writeSomething', { defaultValue: 'Write something...' })}
              placeholderTextColor="rgba(255,255,255,0.6)"
              value={text}
              onChangeText={setText}
              multiline
            />
          </View>
        ) : isCollageMode ? (
          <View style={{
            width: width - 40, flexDirection: 'row', flexWrap: 'wrap',
            borderRadius: 16, overflow: 'hidden',
          }}>
            {collageAssets.map((a) => (
              <Image
                key={a.id}
                source={{ uri: a.uri }}
                style={{
                  width: (width - 40) / 2 - 2, height: (width - 40) / 2 - 2,
                  margin: 1,
                }}
                resizeMode="cover"
              />
            ))}
          </View>
        ) : (
          <Text style={{ color: '#fff' }}>
            {t('story.noMedia', { defaultValue: 'No media selected' })}
          </Text>
        )}

        {/* Camera-effect tint (real visual filter) */}
        {effect.tint && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: effect.tint,
            }}
          />
        )}

        {/* Location chip */}
        {location && (
          <Draggable initialX={width / 2 - 80} initialY={70}>
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 16,
              paddingHorizontal: 12, paddingVertical: 6,
            }}>
              <Feather name="map-pin" size={12} color="#fff" style={{ marginRight: 4 }} />
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{location.name}</Text>
              <Pressable onPress={() => setLocation(null)} style={{ marginLeft: 6 }}>
                <Feather name="x" size={12} color="#fff" />
              </Pressable>
            </View>
          </Draggable>
        )}

        {/* Saved + in-progress drawing strokes */}
        {renderDrawing()}

        {/* Draw capture layer (only while drawing) */}
        {drawMode && (
          <View
            {...panResponder.panHandlers}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />
        )}
      </View>

      {/* Draw mode bar: colors + undo + done */}
      {drawMode && (
        <View style={{
          position: 'absolute', top: 110, left: 0, right: 0, zIndex: 11,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
        }}>
          {DRAW_COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => setDrawColor(c)}
              style={{
                width: 28, height: 28, borderRadius: 14, backgroundColor: c,
                borderWidth: drawColor === c ? 3 : 1,
                borderColor: drawColor === c ? '#fff' : 'rgba(255,255,255,0.4)',
              }}
            />
          ))}
          <Pressable
            onPress={undoStroke}
            style={{
              backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 14,
              paddingHorizontal: 10, paddingVertical: 6,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
              {t('story.undo', { defaultValue: 'Undo' })}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleDraw}
            style={{
              backgroundColor: '#1877F2', borderRadius: 14,
              paddingHorizontal: 10, paddingVertical: 6,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
              {t('story.done', { defaultValue: 'Done' })}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Emoji strip */}
      {emojiOpen && (
        <View style={{
          position: 'absolute', bottom: 170, left: 16, right: 16, zIndex: 11,
          backgroundColor: 'rgba(0,0,0,0.8)', borderRadius: 16, paddingVertical: 10,
        }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 12 }}>
            {EMOJIS.map((e) => (
              <Pressable key={e} onPress={() => insertEmoji(e)} style={{ padding: 4 }}>
                <Text style={{ fontSize: 28 }}>{e}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Mention picker */}
      {mentionOpen && (
        <View style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 30,
          justifyContent: 'center', alignItems: 'center',
        }}>
          <View style={{
            backgroundColor: '#fff', borderRadius: 16,
            width: width - 60, maxHeight: height * 0.6, overflow: 'hidden',
          }}>
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              padding: 16, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
            }}>
              <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: '#000' }}>
                {t('story.mentionFriend', { defaultValue: 'Mention a friend' })}
              </Text>
              <Pressable onPress={() => setMentionOpen(false)}>
                <Feather name="x" size={20} color="#000" />
              </Pressable>
            </View>
            {friendsLoading ? (
              <ActivityIndicator size="large" color="#1877F2" style={{ padding: 24 }} />
            ) : friends.length === 0 ? (
              <Text style={{ padding: 24, textAlign: 'center', color: '#666', fontSize: 14 }}>
                {t('story.noFriends', { defaultValue: 'No friends to mention yet' })}
              </Text>
            ) : (
              <ScrollView>
                {friends.map((f) => (
                  <Pressable
                    key={f.uid}
                    onPress={() => selectMention(f)}
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      paddingHorizontal: 16, paddingVertical: 12,
                      borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
                    }}
                  >
                    {f.photoURL ? (
                      <Image source={{ uri: f.photoURL }} style={{ width: 36, height: 36, borderRadius: 18, marginRight: 10 }} />
                    ) : (
                      <View style={{
                        width: 36, height: 36, borderRadius: 18, marginRight: 10,
                        backgroundColor: '#e5e5e5', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Text style={{ fontWeight: '700', color: '#666' }}>
                          {f.name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <Text style={{ fontSize: 14, fontWeight: '600', color: '#000' }}>{f.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      )}

      {/* Right toolbar — every control is real */}
      <View style={{
        position: 'absolute', right: 12, top: height * 0.3,
        gap: 20, zIndex: 10,
      }}>
        <Pressable onPress={handleEmoji} style={{ alignItems: 'center' }} hitSlop={10}>
          <Feather name="smile" size={24} color={emojiOpen ? '#1877F2' : '#fff'} />
        </Pressable>
        <Pressable onPress={handleText} style={{ alignItems: 'center' }} hitSlop={10}>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>A</Text>
        </Pressable>
        <Pressable onPress={handleDraw} style={{ alignItems: 'center' }} hitSlop={10}>
          <Feather name="edit-3" size={24} color={drawMode ? '#1877F2' : '#fff'} />
        </Pressable>
        <Pressable onPress={handleLocation} style={{ alignItems: 'center' }} hitSlop={10}>
          {locationLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Feather name="map-pin" size={24} color={location ? '#1877F2' : '#fff'} />
          )}
        </Pressable>
        <Pressable onPress={openMentions} style={{ alignItems: 'center' }} hitSlop={10}>
          <Feather name="at-sign" size={24} color={mentions.length > 0 ? '#1877F2' : '#fff'} />
        </Pressable>
        <Pressable onPress={handleEffect} style={{ alignItems: 'center' }} hitSlop={10}>
          <Feather name="camera" size={24} color={effectIdx > 0 ? '#1877F2' : '#fff'} />
          {effectIdx > 0 && (
            <Text style={{ color: '#1877F2', fontSize: 9, fontWeight: '700', marginTop: 2 }}>
              {effect.name}
            </Text>
          )}
        </Pressable>
      </View>

      {/* Bottom area */}
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        paddingHorizontal: 16, paddingBottom: 30, zIndex: 10,
      }}>
        {/* Background colors — TEXT stories ONLY, never photo/video */}
        {isTextMode && (
          <View style={{
            flexDirection: 'row', justifyContent: 'center',
            marginBottom: 16, gap: 8,
          }}>
            {BG_COLORS.map((color) => (
              <Pressable
                key={color}
                onPress={() => setBgColor(color)}
                style={{
                  width: 36, height: 36, borderRadius: 18,
                  backgroundColor: color,
                  borderWidth: bgColor === color ? 3 : 1,
                  borderColor: bgColor === color ? '#fff' : 'rgba(255,255,255,0.3)',
                }}
              />
            ))}
          </View>
        )}

        {/* Audience selector + Share button */}
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <Pressable
            onPress={() => setAudienceOpen(!audienceOpen)}
            style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: 'rgba(255,255,255,0.2)',
              borderRadius: 20, paddingHorizontal: 12, paddingVertical: 10,
            }}
          >
            <Feather
              name="globe"
              size={14}
              color="#fff"
              style={{ marginRight: 6 }}
            />
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', marginRight: 4 }}>
              {audience === 'everyone'
                ? t('story.everyone', { defaultValue: 'Everyone' })
                : t('story.myContacts', { defaultValue: 'My Contact' })}
            </Text>
            <Feather name="chevron-right" size={14} color="#fff" />
          </Pressable>

          <Pressable
            onPress={handleShare}
            disabled={posting}
            style={{
              width: 56, height: 56, borderRadius: 28,
              backgroundColor: '#1877F2',
              alignItems: 'center', justifyContent: 'center',
              opacity: posting ? 0.6 : 1,
            }}
          >
            {posting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Feather name="send" size={24} color="#fff" />
            )}
          </Pressable>
        </View>

        {/* Audience dropdown */}
        {audienceOpen && (
          <View style={{
            position: 'absolute', bottom: 80, left: 16,
            backgroundColor: '#fff', borderRadius: 12,
            shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.25, shadowRadius: 4, elevation: 5,
            overflow: 'hidden',
          }}>
            <Pressable
              onPress={() => { setAudience('everyone'); setAudienceOpen(false); }}
              style={{
                flexDirection: 'row', alignItems: 'center',
                paddingHorizontal: 16, paddingVertical: 12,
                backgroundColor: audience === 'everyone' ? '#f0f7ff' : '#fff',
              }}
            >
              <Feather name="globe" size={16} color="#000" style={{ marginRight: 8 }} />
              <View>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#000' }}>
                  {t('story.everyone', { defaultValue: 'Everyone' })}
                </Text>
                <Text style={{ fontSize: 11, color: '#666' }}>
                  {t('story.everyoneDesc', { defaultValue: 'Public — visible in Planet' })}
                </Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => { setAudience('contacts'); setAudienceOpen(false); }}
              style={{
                flexDirection: 'row', alignItems: 'center',
                paddingHorizontal: 16, paddingVertical: 12,
                backgroundColor: audience === 'contacts' ? '#f0f7ff' : '#fff',
              }}
            >
              <Feather name="users" size={16} color="#000" style={{ marginRight: 8 }} />
              <View>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#000' }}>
                  {t('story.myContacts', { defaultValue: 'My Contact' })}
                </Text>
                <Text style={{ fontSize: 11, color: '#666' }}>
                  {t('story.contactsDesc', { defaultValue: 'Only your contacts can see' })}
                </Text>
              </View>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}
