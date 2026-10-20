import {
  useState, useEffect, useRef, useCallback,
} from 'react';
import {
  View, Text, Modal, Pressable, TextInput,
  Animated, Dimensions, Alert, Image,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useAudioPlayer } from 'expo-audio';
import Svg, { Polyline } from 'react-native-svg';
import { UserStories, Story, DrawingStroke } from '../types';
import { useRealAuthor } from '../hooks/useRealAuthor';
import StoryCommentsSheet from '../components/StoryCommentsSheet';
import { addStoryComment } from '../services/firebaseStoryService';
import { STORY_REACTIONS } from '../data/storyConstants';
import { storyEffectTint } from '../data/storyEffects';
import { getErrorCause } from '@/src/utils/errorDisplay';

const { width, height } = Dimensions.get('window');
const STORY_DURATION = 8000;

/** Real video playback for video-type stories (expo-video). */
function StoryVideoPlayer({ uri, onDuration, onReady }: { uri: string; onDuration?: (durationMs: number) => void; onReady?: () => void }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });
  // 2026-10-20 (boss's concept): the story countdown must NOT run while the
  // video is still loading/buffering — it starts only when the video is
  // actually playing on screen. Report that moment once via onReady.
  const readyFiredRef = useRef(false);
  useEffect(() => {
    if (!onReady) return;
    const sub = player.addListener('playingChange', ({ isPlaying }: { isPlaying: boolean }) => {
      if (isPlaying && !readyFiredRef.current) {
        readyFiredRef.current = true;
        onReady();
      }
    });
    // The video may already be playing by the time the listener attaches.
    try {
      if ((player as { playing?: boolean }).playing && !readyFiredRef.current) {
        readyFiredRef.current = true;
        onReady();
      }
    } catch { /* player not ready yet */ }
    return () => { sub.remove(); };
  }, [player, onReady]);
  useEffect(() => {
    return () => {
      try { player.pause(); } catch { /* ignore */ }
    };
  }, [player]);
  // 2026-10-19 polish: report the real video duration (seconds → ms) so the
  // story timer can match the video instead of the fixed 8s. duration becomes
  // available once the source loads — poll briefly, report once.
  useEffect(() => {
    if (!onDuration) return;
    let tries = 0;
    let reported = false;
    const timer = setInterval(() => {
      if (reported || ++tries > 20) { clearInterval(timer); return; }
      try {
        const d = (player as { duration?: number }).duration;
        if (d && d > 0) {
          reported = true;
          clearInterval(timer);
          onDuration(d * 1000);
        }
      } catch { /* player not ready yet */ }
    }, 400);
    return () => clearInterval(timer);
  }, [player, onDuration]);
  return (
    <VideoView
      player={player}
      style={{ width: width - 40, height: (width - 40) * 1.4, borderRadius: 20 }}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

/** Background music for photo/text stories (2026-10-11): auto-plays, no UI. */
function StoryBackgroundMusic({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  useEffect(() => {
    try {
      player.play();
    } catch { /* ignore */ }
    return () => {
      try { player.pause(); } catch { /* ignore */ }
    };
  }, [player]);
  return null;
}

/** Real audio playback for audio-type stories (expo-audio). Auto-plays on mount (2026-10-11). */
function StoryAudioPlayer({ uri, audioName }: { uri: string; audioName?: string }) {
  const player = useAudioPlayer(uri);
  const [playing, setPlaying] = useState(true);

  // Auto-play when the story is viewed (like video).
  useEffect(() => {
    try {
      player.play();
      setPlaying(true);
    } catch { /* ignore */ }
  }, [player]);

  const toggle = useCallback(() => {
    try {
      if (playing) {
        player.pause();
        setPlaying(false);
      } else {
        player.play();
        setPlaying(true);
      }
    } catch { /* ignore */ }
  }, [player, playing]);

  useEffect(() => {
    return () => {
      try { player.pause(); } catch { /* ignore */ }
    };
  }, [player]);

  return (
    <View style={{
      width: width - 40, minHeight: 220, borderRadius: 20,
      backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <Feather name="music" size={48} color="#8B5CF6" style={{ marginBottom: 12 }} />
      <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' }} numberOfLines={2}>
        {audioName || 'Audio story'}
      </Text>
      <Pressable
        onPress={toggle}
        hitSlop={12}
        style={{
          marginTop: 16, width: 56, height: 56, borderRadius: 28,
          backgroundColor: '#7C3AED', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Feather name={playing ? 'pause' : 'play'} size={24} color="#fff" />
      </Pressable>
    </View>
  );
}

/** Render saved freehand drawing strokes (normalized 0..1 coords). */
function StoryDrawing({ drawing, w, h }: { drawing?: DrawingStroke[]; w: number; h: number }) {
  if (!drawing || drawing.length === 0) return null;
  return (
    <Svg width={w} height={h} style={{ position: 'absolute', top: 0, left: 0 }} pointerEvents="none">
      {drawing.map((s, i) => (
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
}

const C = {
  bg: '#000000',
  text: '#FFFFFF',
  muted: 'rgba(255,255,255,0.65)',
  dim: 'rgba(255,255,255,0.38)',
  primary: '#7C3AED',
  glow: '#8B5CF6',
  glass: 'rgba(255,255,255,0.12)',
  glassBorder: 'rgba(255,255,255,0.18)',
  inputBg: 'rgba(255,255,255,0.08)',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Progress bars
// ─────────────────────────────────────────────────────────────────────────────
function ProgressBars({
  total, current, progress,
}: {
  total: number; current: number; progress: Animated.Value;
}) {
  // 2026-10-19 polish: native-driver-safe fill. Animating `width` can't run
  // on the native driver, so the fill is a full-width bar "wiped" in from the
  // left via translateX (natively animatable). Track width measured once —
  // all bars share flex:1 so widths are equal.
  const [trackW, setTrackW] = useState(0);
  return (
    <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: 12, paddingTop: 8 }}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={{
          flex: 1, height: 2.5, borderRadius: 2,
          backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden',
        }}
          onLayout={(e) => {
            if (i === 0) setTrackW(e.nativeEvent.layout.width);
          }}
        >
          {i < current && <View style={{ flex: 1, backgroundColor: '#fff' }} />}
          {i === current && trackW > 0 && (
            <Animated.View style={{
              width: '100%', height: '100%', backgroundColor: '#fff',
              transform: [{
                translateX: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-trackW, 0],
                }),
              }],
            }} />
          )}
        </View>
      ))}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Single story slide
// ─────────────────────────────────────────────────────────────────────────────
type StoryCardProps = {
  story: Story;
  userStories: UserStories;
  storyIndex: number;
  totalStories: number;
  progressAnim: Animated.Value;
  onTapLeft: () => void;
  onTapRight: () => void;
  onClose: () => void;
  currentUserId?: string;
  currentUserName?: string;
  onDelete?: (storyId: string, userId: string) => void | Promise<void>;
  onCommentFocus?: () => void;
  onCommentBlur?: () => void;
  onReact?: (authorUid: string, storyId: string, emoji: string) => Promise<void>;
  onComment?: (authorUid: string, storyId: string, text: string) => Promise<void>;
  onVideoDuration?: (storyId: string, durationMs: number) => void;
  /** 2026-10-20 (boss): media is actually on screen (video playing / image loaded). */
  onMediaReady?: (storyId: string) => void;
};

function StoryCard({
  story, userStories, storyIndex, totalStories,
  progressAnim, onTapLeft, onTapRight, onClose,
  currentUserId, currentUserName, onDelete, onCommentFocus, onCommentBlur,
  onReact, onComment, onVideoDuration, onMediaReady,
}: StoryCardProps) {
  const { t } = useTranslation();
  // Real author name/avatar (2026-10-11): resolves from RTDB if stored name is placeholder.
  const author = useRealAuthor(userStories.userId, userStories.userName, userStories.userAvatar);
  const [reactionOpen, setReactionOpen] = useState(false);
  const [userReaction, setUserReaction] = useState<string | null>(
    () => (currentUserId ? story.reactions?.[currentUserId] ?? null : null),
  );
  const [reply, setReply] = useState('');
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState(story.comments);
  const [contentSize, setContentSize] = useState({ w: width, h: height });
  const isOwn = !!currentUserId && story.userId === currentUserId;

  // Sync comments/reaction when the story changes or new data arrives via subscription.
  // 2026-10-19 polish: the signature also catches IN-PLACE comment edits
  // (text changed, same id, same count) — the old [story.id, length] deps
  // missed those entirely.
  const commentsSignature = (story.comments ?? [])
    .map((c: any) => `${c.id}:${c.text}:${c.ts}`)
    .join('|');
  useEffect(() => {
    setComments(story.comments);
    setUserReaction(currentUserId ? story.reactions?.[currentUserId] ?? null : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id, commentsSignature]);

  const timeAgo = (ts: number): string => {
    const diff = Date.now() - ts;
    const min = 60_000;
    const h = 3_600_000;
    if (diff < min) return t('chat.storyJustNow');
    if (diff < h) return t('chat.storyMinutesAgo', { count: Math.floor(diff / min) });
    return t('chat.storyHoursAgo', { count: Math.floor(diff / h) });
  };

  const submitReaction = async (emoji: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const prev = userReaction;
    const next = prev === emoji ? null : emoji;
    setUserReaction(next);
    setReactionOpen(false);
    try {
      // REAL persistence — the reaction is written to Firebase.
      await onReact?.(story.userId, story.id, emoji);
    } catch (error) {
      setUserReaction(prev); // revert optimistic state on failure
      Alert.alert(
        t('chat.storyError', { defaultValue: 'Error' }),
        getErrorCause(error),
      );
    }
  };

  const submitComment = async () => {
    const trimmed = reply.trim();
    if (!trimmed) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setReply('');
    onCommentBlur?.();
    // Optimistic UI; replaced by the server version when the subscription delivers.
    const tempId = `temp_${Date.now()}`;
    setComments((c) => [
      ...c,
      {
        id: tempId,
        userId: currentUserId ?? 'me',
        userName: currentUserName ?? t('chat.storyYou', { defaultValue: 'You' }),
        text: trimmed,
        ts: Date.now(),
      },
    ]);
    try {
      // REAL persistence — the comment is written to Firebase.
      await onComment?.(story.userId, story.id, trimmed);
    } catch (error) {
      setComments((c) => c.filter((x) => x.id !== tempId)); // drop optimistic
      Alert.alert(
        t('chat.storyError', { defaultValue: 'Error' }),
        getErrorCause(error),
      );
    }
  };

  const shareToInbox = () => {
    Alert.alert(t('chat.storyShareTitle'), t('chat.storyShareMsg'), [
      { text: t('chat.cancel'), style: 'cancel' },
      {
        text: t('chat.storyShare'),
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert(t('chat.storyShareSuccess'), t('chat.storySharedToInbox'));
        },
      },
    ]);
  };

  const bg = story.bgGradient ? story.bgGradient[0] : '#1a1a2e';

  return (
    <View style={{ width, height, backgroundColor: bg }}>
      {/* Overlay tint */}
      <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.15)' }} />

      {/* Progress + header */}
      <SafeAreaView edges={['top']} style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }}>
        <View style={{ paddingTop: Platform.OS === 'web' ? 67 : 0 }}>
          <ProgressBars total={totalStories} current={storyIndex} progress={progressAnim} />
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
          }}>
            {/* RC6 fix Issue 7: show userAvatar photo when available */}
            <View style={{
              width: 38, height: 38, borderRadius: 19,
              backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
              alignItems: 'center', justifyContent: 'center', marginRight: 10,
              overflow: 'hidden',
            }}>
              {author.avatar ? (
                <Image
                  source={{ uri: author.avatar }}
                  style={{ width: 38, height: 38, borderRadius: 19 }}
                />
              ) : (
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 14 }}>
                  {author.name[0]?.toUpperCase()}
                </Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 14 }}>
                {author.name}
              </Text>
              <Text style={{ color: C.muted, fontSize: 11 }}>{timeAgo(story.createdAt)}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={16}>
              <Feather name="x" size={24} color="#fff" />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      {/* Story content */}
      {/* Background music for photo/text stories (2026-10-11) */}
      {story.musicUrl && (story.type === 'text' || story.type === 'image') && (
        <StoryBackgroundMusic uri={story.musicUrl} />
      )}
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}
        onLayout={(e) => setContentSize({
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height,
        })}
      >
        {story.type === 'text' ? (
          <Text style={{
            // P0-6 fix: white text on bright gradients is illegible.
            // Use dark text on bright backgrounds (luminance check).
            color: (() => {
              const bg = story.bgGradient?.[0] ?? '#7C3AED';
              // Simple luminance: bright backgrounds get dark text.
              const hex = bg.replace('#', '');
              const r = parseInt(hex.slice(0, 2), 16) / 255;
              const g = parseInt(hex.slice(2, 4), 16) / 255;
              const b = parseInt(hex.slice(4, 6), 16) / 255;
              const lum = 0.299 * r + 0.587 * g + 0.114 * b;
              return lum > 0.6 ? '#1a1a2e' : (story.textColor ?? '#fff');
            })(),
            fontSize: 28, fontWeight: '900',
            textAlign: 'center', lineHeight: 40,
            textShadowColor: 'rgba(0,0,0,0.4)',
            textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8,
          }}>
            {story.content}
          </Text>
        ) : story.type === 'video' && story.content ? (
          // NOTE 2 (Batch C): video stories play with expo-video
          <StoryVideoPlayer
            uri={story.content}
            onDuration={onVideoDuration ? (ms) => onVideoDuration(story.id, ms) : undefined}
            onReady={onMediaReady ? () => onMediaReady(story.id) : undefined}
          />
        ) : story.type === 'audio' && story.content ? (
          // NOTE 2 (Batch C): audio stories play the uploaded file with expo-audio
          <StoryAudioPlayer uri={story.content} audioName={story.audioName} />
        ) : story.content ? (
          // RC6 fix Issue 7: render actual Cloudinary image URL stored in story.content
          <View>
            <Image
              source={{ uri: story.content }}
              style={{
                width: width - 40, height: (width - 40) * 1.4, borderRadius: 20,
              }}
              resizeMode="cover"
              onLoad={onMediaReady ? () => onMediaReady(story.id) : undefined}
            />
            {/* Text overlay (2026-10-11) */}
            {story.overlayText && (
              <View style={{ position: 'absolute', top: '40%', left: 0, right: 0, alignItems: 'center' }}>
                <Text style={{
                  color: '#fff', fontSize: 24, fontWeight: '800', textAlign: 'center',
                  textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 2 },
                  textShadowRadius: 4, paddingHorizontal: 20,
                }}>
                  {story.overlayText}
                </Text>
              </View>
            )}
          </View>
        ) : (
          // Fallback: content missing (shouldn't happen with Cloudinary upload)
          <View style={{
            width: width - 40, height: (width - 40) * 1.4, borderRadius: 20,
            backgroundColor: '#222', alignItems: 'center', justifyContent: 'center',
          }}>
            <Feather name="image" size={48} color="rgba(255,255,255,0.3)" />
          </View>
        )}

        {/* Saved camera-effect filter */}
        {(() => {
          const tint = storyEffectTint(story.effect);
          return tint ? (
            <View
              pointerEvents="none"
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: tint }}
            />
          ) : null;
        })()}

        {/* Saved freehand drawing */}
        <StoryDrawing drawing={story.drawing} w={contentSize.w} h={contentSize.h} />

        {/* Saved location chip */}
        {story.locationName ? (
          <View style={{
            position: 'absolute', top: 12, alignSelf: 'center',
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 16,
            paddingHorizontal: 12, paddingVertical: 6,
          }}>
            <Feather name="map-pin" size={12} color="#fff" style={{ marginRight: 4 }} />
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>
              {story.locationName}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Left / Right tap zones — sit above content but below UI overlays */}
      <View style={{ position: 'absolute', left: 0, top: 120, bottom: 160, width: width * 0.4 }}>
        <Pressable style={{ flex: 1 }} onPress={onTapLeft} />
      </View>
      <View style={{ position: 'absolute', right: 0, top: 120, bottom: 160, width: width * 0.6 }}>
        <Pressable style={{ flex: 1 }} onPress={onTapRight} />
      </View>

      {/* Reactions picker */}
      {reactionOpen && (
        <View style={{
          position: 'absolute', bottom: 170, left: 16, right: 16,
          flexDirection: 'row', justifyContent: 'space-evenly',
          backgroundColor: 'rgba(0,0,0,0.85)',
          borderRadius: 40, paddingVertical: 12,
          borderWidth: 1, borderColor: C.glassBorder, zIndex: 20,
        }}>
          {STORY_REACTIONS.map((emoji) => (
            <Pressable key={emoji} onPress={() => submitReaction(emoji)} style={{ padding: 6 }}>
              <Text style={{
                fontSize: 28,
                transform: [{ scale: userReaction === emoji ? 1.35 : 1 }],
              }}>
                {emoji}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Full comments sheet (2026-10-11): all comments + replies + reactions */}
      <StoryCommentsSheet
        visible={showComments}
        comments={comments}
        reactions={story.reactions ?? {}}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        onClose={() => { setShowComments(false); onCommentBlur?.(); }}
        onSendComment={async (text, replyTo) => {
          if (!currentUserId) throw new Error('Not authenticated');
          await addStoryComment(story.userId, story.id, {
            userId: currentUserId,
            userName: currentUserName ?? 'You',
            text,
            ...(replyTo ? { replyTo: replyTo.id, replyToName: replyTo.name } : {}),
          });
        }}
      />

      {/* Bottom bar */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10 }}
      >
        <SafeAreaView edges={['bottom']}>
          <View style={{
            paddingHorizontal: 16, paddingVertical: 12,
            paddingBottom: Platform.OS === 'web' ? 34 : 12,
          }}>
            {/* Reply input */}
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 10,
              backgroundColor: C.inputBg, borderRadius: 30,
              paddingHorizontal: 16, paddingVertical: 10,
              borderWidth: 1, borderColor: C.glassBorder, marginBottom: 10,
            }}>
              <TextInput
                style={{ flex: 1, color: '#fff', fontSize: 14 }}
                placeholder={t('chat.storyReplyPlaceholder', { name: author.name })}
                placeholderTextColor={C.muted}
                value={reply}
                onChangeText={setReply}
                onFocus={onCommentFocus}
                onBlur={onCommentBlur}
                onSubmitEditing={submitComment}
              />
              {reply.length > 0 && (
                <Pressable onPress={submitComment}>
                  <Feather name="send" size={20} color={C.glow} />
                </Pressable>
              )}
            </View>

            {/* Action row */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
              <Pressable onPress={() => setReactionOpen((v) => !v)} style={{ alignItems: 'center', gap: 4 }}>
                <View style={{
                  width: 44, height: 44, borderRadius: 22,
                  backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ fontSize: 20 }}>{userReaction ?? '❤️'}</Text>
                </View>
                <Text style={{ color: C.muted, fontSize: 11 }}>{t('chat.storyReact')}</Text>
              </Pressable>

              <Pressable onPress={() => { setShowComments(true); onCommentFocus?.(); }} style={{ alignItems: 'center', gap: 4 }}>
                <View style={{
                  width: 44, height: 44, borderRadius: 22,
                  backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Feather name="message-circle" size={20} color="#fff" />
                </View>
                <Text style={{ color: C.muted, fontSize: 11 }}>{t('chat.storyComment')}</Text>
              </Pressable>

              {/* Share-to-inbox hidden — the previous implementation faked a
                  success message without sending anything. Re-enable when a
                  real chat-picker share flow is implemented. */}
              {/*
              <Pressable onPress={shareToInbox} style={{ alignItems: 'center', gap: 4 }}>
                <View style={{
                  width: 44, height: 44, borderRadius: 22,
                  backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Feather name="share-2" size={20} color="#fff" />
                </View>
                <Text style={{ color: C.muted, fontSize: 11 }}>{t('chat.storyShare')}</Text>
              </Pressable>
              */}

              <View style={{ alignItems: 'center', gap: 4 }}>
                <View style={{
                  width: 44, height: 44, borderRadius: 22,
                  backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Feather name="eye" size={20} color="#fff" />
                </View>
                <Text style={{ color: C.muted, fontSize: 11 }}>{story.viewCount}</Text>
              </View>

              {/* Delete button — only visible to the story owner */}
              {isOwn && (
                <Pressable
                  onPress={() => {
                    Alert.alert(
                      t('chat.storyDeleteTitle', { defaultValue: 'Delete Story' }),
                      t('chat.storyDeleteMsg', { defaultValue: 'Remove this story for everyone?' }),
                      [
                        { text: t('chat.cancel'), style: 'cancel' },
                        {
                          text: t('chat.storyDeleteConfirm', { defaultValue: 'Delete' }),
                          style: 'destructive',
                          // 2026-10-19 polish: await the delete and surface a
                          // failure instead of fire-and-forget + blind close.
                          onPress: async () => {
                            try {
                              await onDelete?.(story.id, story.userId);
                              onClose();
                            } catch (error) {
                              Alert.alert(
                                t('chat.storyDeleteFailed', { defaultValue: 'Delete failed' }),
                                getErrorCause(error),
                              );
                            }
                          },
                        },
                      ],
                    );
                  }}
                  style={{ alignItems: 'center', gap: 4 }}
                >
                  <View style={{
                    width: 44, height: 44, borderRadius: 22,
                    backgroundColor: 'rgba(239,68,68,0.15)',
                    borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Feather name="trash-2" size={20} color="#EF4444" />
                  </View>
                  <Text style={{ color: '#EF4444', fontSize: 11 }}>
                    {t('chat.storyDelete', { defaultValue: 'Delete' })}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StoryViewer — public component
// Timer uses refs so callbacks never capture stale index state.
// ─────────────────────────────────────────────────────────────────────────────
type Props = {
  visible: boolean;
  startUserIndex: number;
  stories: UserStories[];
  onClose: () => void;
  currentUserId?: string;
  currentUserName?: string;
  onDelete?: (storyId: string, userId: string) => void;
  onReact?: (authorUid: string, storyId: string, emoji: string) => Promise<void>;
  onComment?: (authorUid: string, storyId: string, text: string) => Promise<void>;
};

export default function StoryViewer({ visible, startUserIndex, stories, onClose, currentUserId, currentUserName, onDelete, onReact, onComment }: Props) {
  const [userIndex, setUserIndex]   = useState(startUserIndex);
  const [storyIndex, setStoryIndex] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Refs always hold the latest indices — used inside timer callback
  // so we never have stale closure issues.
  const userIndexRef  = useRef(userIndex);
  const storyIndexRef = useRef(storyIndex);
  useEffect(() => { userIndexRef.current  = userIndex;  }, [userIndex]);
  useEffect(() => { storyIndexRef.current = storyIndex; }, [storyIndex]);

  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  // 2026-10-19 polish: keep stories/onClose in refs so the timer callbacks
  // (advance/startTimer/resumeTimer) stay referentially stable — otherwise the
  // timer-restart effect below would re-run on every subscription data tick.
  const storiesRef = useRef(stories);
  useEffect(() => { storiesRef.current = stories; }, [stories]);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  // 2026-10-19 polish: timestamp-driven pause/resume with the native driver —
  // no private __getValue. elapsedRef accumulates wall-clock run time across
  // pauses; segmentStartRef marks the current running segment (null = paused).
  const elapsedRef = useRef(0);
  const segmentStartRef = useRef<number | null>(null);
  const durationRef = useRef(STORY_DURATION);
  // 2026-10-20 (boss's concept): ids of image/video stories whose media has
  // actually appeared on screen (image loaded / video playing). The countdown
  // for a gated story may only start once its id is in this set; until then
  // the progress bar stays parked at 0.
  const readyStoriesRef = useRef<Set<string>>(new Set());

  const stopTimer = useCallback(() => {
    animRef.current?.stop();
    animRef.current = null;
    segmentStartRef.current = null;
    progressAnim.setValue(0);
  }, [progressAnim]);

  /**
   * Advance to next story or next user's stories.
   * Reads from refs to avoid stale closures.
   */
  const advance = useCallback(() => {
    const ui = userIndexRef.current;
    const si = storyIndexRef.current;
    const currentUser = storiesRef.current[ui];
    if (!currentUser) { onCloseRef.current(); return; }

    if (si < currentUser.stories.length - 1) {
      // next story within same user
      storyIndexRef.current = si + 1;
      setStoryIndex(si + 1);
    } else if (ui < storiesRef.current.length - 1) {
      // next user
      userIndexRef.current  = ui + 1;
      storyIndexRef.current = 0;
      setUserIndex(ui + 1);
      setStoryIndex(0);
    } else {
      onCloseRef.current();
    }
  }, []);

  const pauseTimer = useCallback(() => {
    if (segmentStartRef.current == null) return; // already paused
    animRef.current?.stop();
    animRef.current = null;
    // Wall-clock elapsed of this segment — no __getValue needed.
    elapsedRef.current += Date.now() - segmentStartRef.current;
    segmentStartRef.current = null;
  }, []);

  const resumeTimer = useCallback(() => {
    if (segmentStartRef.current != null) return; // already running
    // 2026-10-20 (boss): never resume on a story whose media hasn't shown yet —
    // the countdown only exists once the media is on screen.
    const curStory = storiesRef.current[userIndexRef.current]?.stories[storyIndexRef.current];
    if (curStory && (curStory.type === 'video' || curStory.type === 'image')
        && !readyStoriesRef.current.has(curStory.id)) return;
    const duration = durationRef.current;
    const remaining = Math.max(0, duration - elapsedRef.current);
    if (remaining <= 0) { advance(); return; }
    segmentStartRef.current = Date.now();
    progressAnim.setValue(elapsedRef.current / duration);
    const anim = Animated.timing(progressAnim, {
      toValue: 1,
      duration: remaining,
      useNativeDriver: true,
    });
    animRef.current = anim;
    anim.start(({ finished }) => {
      if (finished) advance();
    });
  }, [progressAnim, advance]);

  const startTimer = useCallback((durationMs: number) => {
    stopTimer();
    durationRef.current = durationMs;
    elapsedRef.current = 0;
    segmentStartRef.current = Date.now();
    progressAnim.setValue(0);
    const anim = Animated.timing(progressAnim, {
      toValue: 1,
      duration: durationMs,
      useNativeDriver: true,
    });
    animRef.current = anim;
    anim.start(({ finished }) => {
      if (finished) advance();
    });
  }, [progressAnim, stopTimer, advance]);

  // 2026-10-19 polish: video stories run for their REAL duration, not the
  // fixed 8s. Durations arrive asynchronously from the video player; when the
  // current story's duration lands, its timer restarts with the real value.
  const storyDurationsRef = useRef<Record<string, number>>({});
  const handleVideoDuration = useCallback((storyId: string, durationMs: number) => {
    if (!durationMs || durationMs <= 0) return;
    if (storyDurationsRef.current[storyId] === durationMs) return;
    storyDurationsRef.current[storyId] = durationMs;
    const cur = storiesRef.current[userIndexRef.current]?.stories[storyIndexRef.current];
    if (cur?.id === storyId) {
      // Duration alone must not start the countdown (boss 2026-10-20): the
      // timer starts only once the video is actually playing — see
      // handleMediaReady. If it already is, restart with the real duration.
      if (readyStoriesRef.current.has(storyId)) startTimer(durationMs);
    }
  }, [startTimer]);

  // 2026-10-20 (boss's concept): media-visible gate. Text stories render
  // instantly and are never gated; image/video stories start their countdown
  // only when the media is actually on screen.
  const mediaGateApplies = useCallback((story: Story): boolean =>
    story.type === 'video' || story.type === 'image', []);

  const durationForStory = useCallback((story: Story): number => {
    if (story.type === 'video') {
      const known = storyDurationsRef.current[story.id];
      if (known && known > 0) return known;
    }
    return STORY_DURATION;
  }, []);

  // 2026-10-20 (boss's concept): fired by the card when the media is actually
  // on screen — image onLoad, or the video's first playing state. Only then
  // does this story's countdown begin.
  const handleMediaReady = useCallback((storyId: string) => {
    if (readyStoriesRef.current.has(storyId)) return;
    readyStoriesRef.current.add(storyId);
    const cur = storiesRef.current[userIndexRef.current]?.stories[storyIndexRef.current];
    if (cur?.id === storyId) {
      startTimer(durationForStory(cur));
    }
  }, [startTimer, durationForStory]);

  const goPrev = useCallback(() => {
    const ui = userIndexRef.current;
    const si = storyIndexRef.current;
    if (si > 0) {
      storyIndexRef.current = si - 1;
      setStoryIndex(si - 1);
    } else if (ui > 0) {
      userIndexRef.current  = ui - 1;
      storyIndexRef.current = 0;
      setUserIndex(ui - 1);
      setStoryIndex(0);
    }
    // timer restarts via the useEffect below
  }, []);

  // Restart timer whenever the story changes (index or user changes)
  useEffect(() => {
    if (!visible) { stopTimer(); return; }
    const user  = stories[userIndex];
    const story = user?.stories[storyIndex];
    if (!user || !story) { onClose(); return; }
    // 2026-10-20 (boss's concept): gated stories (image/video) do NOT start
    // counting down on open — the bar stays at 0 until the media is actually
    // on screen; handleMediaReady starts the timer at that moment. Revisited
    // stories (already in the ready set) start immediately.
    if (mediaGateApplies(story) && !readyStoriesRef.current.has(story.id)) {
      stopTimer();
      progressAnim.setValue(0);
      return () => stopTimer();
    }
    // 2026-10-19 polish: video stories use their real duration when known.
    startTimer(durationForStory(story));
    return () => stopTimer();
    // stories/onClose intentionally omitted: data-only subscription ticks must
    // NOT restart the timer (same as before this change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, userIndex, storyIndex, startTimer, durationForStory, mediaGateApplies]);

  // Reset indices when viewer is (re-)opened
  useEffect(() => {
    if (visible) {
      userIndexRef.current  = startUserIndex;
      storyIndexRef.current = 0;
      setUserIndex(startUserIndex);
      setStoryIndex(0);
    } else {
      stopTimer();
    }
  }, [visible, startUserIndex]);

  const currentUser  = stories[userIndex];
  const currentStory = currentUser?.stories[storyIndex];

  if (!currentUser || !currentStory) return null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <StoryCard
          story={currentStory}
          userStories={currentUser}
          storyIndex={storyIndex}
          totalStories={currentUser.stories.length}
          progressAnim={progressAnim}
          onTapLeft={goPrev}
          onTapRight={advance}
          onClose={onClose}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          onDelete={onDelete}
          onCommentFocus={pauseTimer}
          onCommentBlur={resumeTimer}
          onReact={onReact}
          onComment={onComment}
          onVideoDuration={handleVideoDuration}
          onMediaReady={handleMediaReady}
        />
      </View>
    </Modal>
  );
}
