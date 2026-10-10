import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View, Text, FlatList, Alert, Pressable,
  Animated, Platform, TextInput, ActivityIndicator, Image,
  BackHandler,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ref, get, onValue } from 'firebase/database';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import ScalePress from '@/components/ScalePress';
import { database } from '@/src/config/firebase';
import { setMinimizedRoom } from '@/src/store/minimizedRoom';
import { useLivekitVoiceRoom, setVoiceRoomMinimized } from '../useLivekitVoiceRoom';
import { useAuth } from '@/src/context/AuthContext';
import { getUser } from '@/src/services/userService';
import { subscribeWalletBalance } from '@/src/features/wallet/walletService';
import { submitReport } from '@/src/services/reportService';

import { C, ROOM_META, ROOM_THEMES } from '../constants/theme';
import { markVoiceStage } from '../utils/voiceCrashBreadcrumb';
import { Role, Participant, BlockRecord, ChatMsg, SeatReaction, GiftSentInfo } from '../types/room';
import { fmtDiamonds, getWeekStart } from '../utils/format';
import { SeatCard } from '../components/SeatCard';
import RoomChatMessage from '../components/RoomChatMessage';
import { RoomInfoModal } from '../components/RoomInfoModal';
import { OperationHistoryModal } from '../components/OperationHistoryModal';
import { SettingsModal } from '../components/SettingsModal';
import { SeatActionSheet } from '../components/SeatActionSheet';
import { InviteToSeatModal } from '../components/InviteToSeatModal';
import { InviteModal } from '../components/InviteModal';
import { AudienceModal } from '../components/AudienceModal';
import RoomMembersModal from '../components/RoomMembersModal';
import { GiftsModal } from '../components/GiftsModal';
import { AnimatedThemeBackground } from '../components/AnimatedThemeBackground';
import { MemberManageModal } from '../components/MemberManageModal';
import { EmojiPanel } from '../components/EmojiPanel';
import { ExitModal } from '../components/ExitModal';
// Entry effect: "X is Coming" banner when a user joins (2026-10-10)
import EntryBanner from '../components/EntryBanner';
// Track 3: gift fly animation (sender side) + gift receive banners (Firebase giftFeed)
import { GiftFlyAnimation, GiftReceiveBanners, type GiftFlyHandle } from '../components/GiftFlyAnimation';

// ── Firebase Room Services ─────────────────────────────────────────────────
import {
  subscribeSeats, subscribeAudience, subscribeRoomInfo,
  subscribeLockedSeats,
  joinRoomAsAudience, leaveAudience, takeSeat, leaveSeat as fbLeaveSeat,
  setSeatMute, setSeatRole, removeSeat, removeAudienceMember,
  lockSeat as fbLockSeat, unlockSeat as fbUnlockSeat, setAudienceRole,
  closeRoom, updateRoomSettings, getUserColor, getInitials,
  disbandRoom,
  // Seat Request System (Firebase-persisted)
  sendSeatRequest, subscribeSeatRequests, approveSeatRequest, rejectSeatRequest,
  type SeatRequest,
  // Block System (Firebase-persisted)
  blockUserInRoom, unblockUserInRoom, subscribeRoomBlocks, isUserBlockedInRoom,
  type RoomBlockRecord,
  type RoomSeat, type RoomAudienceMember,
  // Fix 1: Seat invite system
  sendSeatInvite, subscribeSeatInvites, removeSeatInvite, type SeatInvite,
  // Fix 5: Emoji reaction broadcast
  sendRoomEmojiReaction, subscribeRoomEmojiReactions,
} from '../services/firebaseRoomService';
import {
  subscribeRoomChat, sendRoomChatMsg, loadOlderMessages,
  type RoomChatMsg,
} from '../services/firebaseRoomChatService';

/* ═══════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════ */

function fbSeatToParticipant(
  seat: NonNullable<RoomSeat>,
  speakingUsers: Record<string, boolean>,
): Participant {
  return {
    id: seat.userId,
    name: seat.userName,
    initials: seat.initials,
    color: seat.color,
    photoURL: seat.photoURL,
    speaking: speakingUsers[seat.userId] === true,
    muted: seat.muted,
    role: seat.role,
  };
}

function fbAudToParticipant(m: RoomAudienceMember): Participant {
  return {
    id: m.userId,
    name: m.userName,
    initials: m.initials,
    color: m.color,
    photoURL: m.photoURL,
    speaking: false,
    muted: true,
    // Preserve Firebase-synced role (admin / member); default to 'member'
    role: (m.role as Role | undefined) ?? 'member',
  };
}

function fbChatToMsg(m: RoomChatMsg): ChatMsg {
  return {
    id: m.id,
    sender: m.senderName,
    color: m.senderColor,
    text: m.text,
    isMe: m.isMe ?? false,
    ts: m.ts,
    replyTo: m.replyTo,
  };
}

/* ═══════════════════════════════════════════
   MAIN SCREEN
═══════════════════════════════════════════ */
export default function VoiceRoomScreen() {
  const { roomId: paramRoomId } = useLocalSearchParams<{ roomId: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { t } = useTranslation();

  // Fix 4: Remove hardcoded ROOM_META.id fallback — roomId must come from route param
  const roomId = paramRoomId ?? '';
  const myUid  = user?.uid ?? 'anonymous';
  const myUidRef = useRef(myUid);
  useEffect(() => { myUidRef.current = myUid; }, [myUid]);

  // CRITICAL-6/7 fix: Firebase Auth user.displayName / photoURL are NOT updated
  // when the user edits their profile inside Vee (those writes go to RTDB only).
  // Fetch the canonical profile from RTDB once at mount so seat cards show the
  // real name and photo.  The one-time fetch avoids triggering a voice engine
  // re-init (which would happen if we subscribed and the value changed).
  const [myProfile, setMyProfile] = useState<{ name: string; photoURL?: string } | null>(null);
  useEffect(() => {
    if (!myUid || myUid === 'anonymous') return;
    getUser(myUid).then((p) => {
      if (p) setMyProfile({ name: p.name, photoURL: p.photoURL || undefined });
    }).catch(() => {/* background: safe to swallow — profile prefetch, fallbacks exist */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const myName = myProfile?.name ?? user?.displayName ?? t('voiceRoom.screen.defaultUserName');
  const myPhotoURL = myProfile?.photoURL || user?.photoURL || undefined;
  const myColor = getUserColor(myUid);
  const myInitials = getInitials(myName);

  // Stable voice username — computed once so profile load doesn't cause a voice
  // engine re-init.
  // The voice engine's userName is used for its own presence layer; Vee's UI
  // shows myName from Firebase.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const voiceUserName = useMemo(() => user?.displayName ?? myUid, []);

  /**
   * Staged voice init (crash-hardening): the native LiveKit/WebRTC stack is
   * NOT initialized when this screen mounts. The room UI (Firebase seats,
   * chat, info) renders first; only after the room info is confirmed valid
   * AND the screen has stabilized do we hand a real roomID to the voice hook.
   * A dead/closed room therefore never touches native audio at all.
   */
  const [voiceReady, setVoiceReady] = useState(false);
  const voiceReadyRef = useRef(false);
  const voiceReadyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    markVoiceStage('screen_mount', roomId);
    return () => {
      if (voiceReadyTimerRef.current !== null) {
        clearTimeout(voiceReadyTimerRef.current);
        voiceReadyTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Called once the room info subscription confirms a live room. */
  const handleRoomInfoOk = useCallback(() => {
    markVoiceStage('room_info_ok', roomId);
    if (voiceReadyRef.current) return;
    voiceReadyRef.current = true;
    // Let the screen settle (layout, first Firebase snapshots) before the
    // native audio stack initializes.
    voiceReadyTimerRef.current = setTimeout(() => {
      voiceReadyTimerRef.current = null;
      setVoiceReady(true);
    }, 1200);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  /* ── LiveKit real audio ── */
  const {
    joined: voiceJoined,
    muted,
    speakerOn,
    speakingUsers,
    localSpeaking,
    isPublishing,
    error: voiceError,
    retryConnection,
    startPublishing,
    stopPublishing,
    toggleMic: engineToggleMic,
    toggleSpeaker: engineToggleSpeaker,
    setMicMuted,
    muteRemoteUser,
    playUserStream,
    stopUserStream,
    wasRestored,
  } = useLivekitVoiceRoom({
    // Empty until staged init completes — the hook skips native init for ''.
    roomID: voiceReady ? roomId : '',
    userID: myUid,
    // Use the stable voiceUserName (never changes after mount) so a profile
    // load doesn't trigger a full voice engine re-init mid-session.
    userName: voiceUserName,
  });

  /* ── Core state ── */
  const [seats,         setSeats]        = useState<Array<Participant | null>>(Array(10).fill(null));
  const [lockedSeats,   setLockedSeats]  = useState<Set<number>>(new Set<number>());
  const [audience,      setAudience]     = useState<Participant[]>([]);
  const [blockedRecs,   setBlockedRecs]  = useState<BlockRecord[]>([]);
  // Entry effect: "X is Coming" banner (2026-10-10)
  const [entryBanner, setEntryBanner] = useState<{ name: string; photoURL?: string | null } | null>(null);
  const prevAudienceIdsRef = useRef<Set<string>>(new Set());
  const [pendingRequests, setPendingRequests] = useState<SeatRequest[]>([]);
  const [ownerId,       setOwnerId]      = useState<string>('');
  const [walletBalance, setWalletBalance] = useState(0);
  // Fix 9: Weekly diamonds earned (separate from total balance)
  const [weeklyEarned,  setWeeklyEarned] = useState(0);
  // Fix 1: Incoming seat invites for this user in this room
  const [pendingSeatInvites, setPendingSeatInvites] = useState<SeatInvite[]>([]);
  // Fix 11: Chat pagination state
  const [chatOldestKey,    setChatOldestKey]    = useState<string | null>(null);
  const [loadingOlderMsgs, setLoadingOlderMsgs] = useState(false);
  const [hasOlderMsgs,     setHasOlderMsgs]     = useState(true);

  // Ref to keep speakingUsers accessible in callbacks without re-creating them
  const speakingRef = useRef<Record<string, boolean>>({});
  useEffect(() => { speakingRef.current = speakingUsers; }, [speakingUsers]);

  // Fix 5: Ref for seats used inside emoji reaction subscription callback
  const seatsRef = useRef<Array<Participant | null>>(Array(10).fill(null));
  useEffect(() => { seatsRef.current = seats; }, [seats]);

  /**
   * CRITICAL-1 fix (minimize/restore): After returning from the minimized bar,
   * the persisted LiveKit room is reused — but subscription events will NOT
   * re-fire for tracks that were already subscribed before minimize.  We must
   * manually re-subscribe each speaker's track so audio resumes for all
   * participants.
   * `wasRestored` is set once by the hook on detect of a persisted room;
   * `hasRestoredRef` ensures the sweep runs at most once per session.
   */
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (!wasRestored || hasRestoredRef.current) return;
    if (seats.every((s) => s === null)) return; // wait for seat data to arrive
    hasRestoredRef.current = true;
    seats.forEach((seat) => {
      if (seat && seat.id !== myUid) {
        playUserStream(seat.id);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wasRestored, seats]);

  // Fix 5: Track last processed reaction timestamp to skip old/replayed events
  const lastReactionTsRef = useRef(0);

  // Fix 1: Track which invite IDs have already shown an Alert (so we don't re-alert)
  const handledInviteIds = useRef<Set<string>>(new Set());

  // Fix 4: Navigate back if no roomId is provided (removes ROOM_META.id fallback)
  useEffect(() => {
    if (!roomId) {
      Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.screen.roomNotFound'));
      router.back();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Real-time wallet balance subscription ── */
  useEffect(() => {
    if (!myUid || myUid === 'anonymous') return;
    return subscribeWalletBalance(myUid, setWalletBalance);
  }, [myUid]);

  /* ── Fix 9: Weekly diamonds earned subscription ── */
  useEffect(() => {
    if (!myUid || myUid === 'anonymous') return;
    return onValue(
      ref(database, `wallets/${myUid}/weeklyEarned`),
      (snap) => { setWeeklyEarned(snap.exists() ? (snap.val() as number) : 0); },
      () => { setWeeklyEarned(0); },
    );
  }, [myUid]);

  /* ── Fix 1: Subscribe to incoming seat invites for this room ── */
  useEffect(() => {
    if (!myUid || myUid === 'anonymous' || !roomId) return;
    return subscribeSeatInvites(myUid, roomId, setPendingSeatInvites);
  }, [myUid, roomId]);

  /* ── Fix 1: Show Alert when a seat invite arrives ── */
  useEffect(() => {
    pendingSeatInvites.forEach((invite) => {
      if (handledInviteIds.current.has(invite.id)) return;
      handledInviteIds.current.add(invite.id);
      Alert.alert(
        t('voiceRoom.screen.seatInviteTitle'),
        t('voiceRoom.screen.seatInviteMsg', {
          inviterName: invite.inviterName,
          number: invite.seatIdx + 1,
          roomName: invite.roomName,
        }),
        [
          {
            text: t('voiceRoom.screen.accept'),
            onPress: async () => {
              // H1 fix: take the seat FIRST, only delete the invite on success.
              // If takeSeat throws (offline/rules), the invite stays so the
              // user can retry instead of losing it silently.
              // H3 fix: vacate current seat first to avoid double occupancy.
              const currentIdx = mySeatIdxRef.current;
              if (currentIdx >= 0 && currentIdx !== invite.seatIdx) {
                try {
                  await fbLeaveSeat(roomId, currentIdx, myUid);
                } catch {
                  // If vacate fails, don't proceed — better to keep the
                  // current seat than risk double occupancy.
                  Alert.alert(t('voiceRoom.screen.seatNoLongerAvailableTitle'), t('voiceRoom.screen.seatNoLongerAvailableMsg'));
                  return;
                }
              }
              let result: { success: boolean };
              try {
                result = await takeSeat(roomId, invite.seatIdx, {
                  userId: myUid, userName: myName,
                  initials: myInitials, color: myColor,
                  muted: true, role: 'member',
                  ...(myPhotoURL ? { photoURL: myPhotoURL } : {}),
                });
              } catch {
                Alert.alert(t('voiceRoom.screen.seatNoLongerAvailableTitle'), t('voiceRoom.screen.seatNoLongerAvailableMsg'));
                return;
              }
              if (result.success) {
                removeSeatInvite(myUid, invite.id).catch(() => {/* background: safe to swallow — invite cleanup after successful seat take */});
                startPublishing();
                sendRoomChatMsg(roomId, {
                  senderId: 'system', senderName: 'System', senderColor: C.gold,
                  text: t('voiceRoom.screen.memberJoinedSeat', { name: myName, number: invite.seatIdx + 1 }),
                  ts: Date.now(),
                }).catch(() => {/* background: safe to swallow — ephemeral system chat message */});
              } else {
                Alert.alert(t('voiceRoom.screen.seatNoLongerAvailableTitle'), t('voiceRoom.screen.seatNoLongerAvailableMsg'));
              }
            },
          },
          {
            text: t('voiceRoom.screen.decline'),
            style: 'cancel',
            onPress: () => { removeSeatInvite(myUid, invite.id).catch(() => {/* background: safe to swallow — invite cleanup on decline */}); },
          },
        ],
      );
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSeatInvites]);

  /* ── Fix 5: Subscribe to emoji reactions broadcast by any participant ── */
  useEffect(() => {
    if (!roomId) return;
    return subscribeRoomEmojiReactions(roomId, (reaction) => {
      if (!reaction) return;
      // Ignore stale reactions older than 5 seconds
      if (reaction.ts <= lastReactionTsRef.current) return;
      if (Date.now() - reaction.ts > 5000) return;
      lastReactionTsRef.current = reaction.ts;
      // Animate the emoji over every occupied seat
      const newReactions: Record<string, SeatReaction> = {};
      seatsRef.current.forEach((member) => {
        if (!member) return;
        const translateY = new Animated.Value(0);
        const opacity    = new Animated.Value(1);
        newReactions[member.id] = { emoji: reaction.emoji, translateY, opacity };
        Animated.parallel([
          Animated.timing(translateY, { toValue: -55, duration: 1600, useNativeDriver: true }),
          Animated.sequence([
            Animated.delay(800),
            Animated.timing(opacity, { toValue: 0, duration: 800, useNativeDriver: true }),
          ]),
        ]).start(() => {
          setSeatReactions((prev: Record<string, SeatReaction>) => {
            const n = { ...prev }; delete n[member.id]; return n;
          });
        });
      });
      if (Object.keys(newReactions).length > 0) {
        setSeatReactions((prev: Record<string, SeatReaction>) => ({ ...prev, ...newReactions }));
      }
    });
  }, [roomId]);

  /* ── Room settings ── */
  const [roomTopic,     setRoomTopic]    = useState<string>(t('voiceRoom.creation.defaultTopic'));
  const [roomName,      setRoomName]     = useState(ROOM_META.name);
  const [roomImageUri, setRoomImageUri] = useState<string | null>(null);
  const [activeThemeId, setActiveThemeId] = useState('cosmic');
  /** Tracks the last Firebase-synced theme to avoid echo loops. */
  const activeThemeIdRef = useRef('cosmic');
  /** Persisted room visibility — synced from Firebase via subscribeRoomInfo. */
  const [roomIsPublic,  setRoomIsPublic]  = useState(true);
  /** Persisted room lock state — synced from Firebase via subscribeRoomInfo. */
  const [roomIsLocked,  setRoomIsLocked]  = useState(false);
  /** Room description — synced from Firebase via subscribeRoomInfo. */
  const [roomDescription, setRoomDescription] = useState('');
  const accentColor = useMemo(
    () => ROOM_THEMES.find((th: { id: string; accent: string }) => th.id === activeThemeId)?.accent ?? C.primary,
    [activeThemeId],
  );
  /** Deep background color for the current theme. */
  const themeBg = useMemo(
    () => ROOM_THEMES.find((th) => th.id === activeThemeId)?.bg ?? C.bg,
    [activeThemeId],
  );
  /** Surface/card color for the current theme. */
  const themeSurface = useMemo(
    () => ROOM_THEMES.find((th) => th.id === activeThemeId)?.surface ?? 'rgba(255,255,255,0.055)',
    [activeThemeId],
  );

  /* ── Join state ── */
  const [hasJoined, setHasJoined] = useState(false);

  // ENTRY EFFECT (2026-10-10): Show "X is Coming" banner when the local user
  // joins too, so they see the effect working (not just when others join).
  const hasShownSelfEntryRef = useRef(false);
  useEffect(() => {
    if (hasJoined && !hasShownSelfEntryRef.current && myUid) {
      hasShownSelfEntryRef.current = true;
      // Get the user's name and photo from the profile or auth
      const displayName = user?.displayName || 'You';
      setEntryBanner({
        name: displayName,
        photoURL: user?.photoURL || null,
      });
    }
  }, [hasJoined, myUid, user?.displayName, user?.photoURL]);

  // REJOIN FIX (2026-10-09): On mount, check if user is already in the
  // room's audience/seats (e.g. rejoining after leave). Without this,
  // hasJoined stays false and the Join button shows incorrectly.
  // REAL FIX (2026-10-10): also check the persistent userRooms/{uid}/{roomId}
  // membership index. Audience/seats are cleared on leave, so a member
  // returning later was never found there — the Join banner showed again
  // every time. userRooms is never cleared on leave: if it exists, this
  // user has joined before and enters directly as audience, no Join tap.
  useEffect(() => {
    if (!roomId || !myUid || hasJoined) return;
    let cancelled = false;
    (async () => {
      try {
        const { get, ref } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        // Persistent membership first — the source of truth for "has joined".
        const memberSnap = await get(ref(database, `userRooms/${myUid}/${roomId}`));
        if (cancelled) return;
        if (memberSnap.exists()) {
          setHasJoined(true);
          return;
        }
        const [audSnap, seatsSnap] = await Promise.all([
          get(ref(database, `rooms/${roomId}/audience/${myUid}`)),
          get(ref(database, `rooms/${roomId}/seats`)),
        ]);
        if (cancelled) return;
        if (audSnap.exists()) {
          setHasJoined(true);
          return;
        }
        // Check if user is on any seat
        if (seatsSnap.exists()) {
          let onSeat = false;
          seatsSnap.forEach((child) => {
            const s = child.val() as { userId?: string } | null;
            if (s?.userId === myUid) onSeat = true;
          });
          if (onSeat) setHasJoined(true);
        }
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [roomId, myUid, hasJoined]);

  /* ── Chat ── */
  const [messages,   setMessages]   = useState<ChatMsg[]>([]);
  const chatRef = useRef<FlatList<ChatMsg>>(null);
  /** Holds the id of the last auto-scroll setTimeout so it can be cancelled on unmount. */
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [chatInput,    setChatInput]    = useState('');
  const [replyingTo,   setReplyingTo]   = useState<ChatMsg | null>(null);
  /** Active @-mention query: non-null while the user is typing an @-prefixed word. */
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [sendingMsg,   setSendingMsg]   = useState(false);

  /* ── Seat reaction overlays ── */
  const [seatReactions,  setSeatReactions]  = useState<Record<string, SeatReaction>>({});

  /* ── Track 3: gift fly animation refs ──
     Each seated member's wrapper View is stored here keyed by member id and
     measured ON DEMAND via measureInWindow when a gift is sent — this keeps
     the target correct even after scrolling, since no layout-time snapshot
     can go stale. Missing/unknown targets fall back to a top-center point. */
  const giftFlyRef = useRef<GiftFlyHandle>(null);
  const seatViewRefs = useRef<Record<string, View | null>>({});

  /* ── Modal states ── */
  const [roomInfoOpen,    setRoomInfoOpen]    = useState(false);
  const [opHistOpen,      setOpHistOpen]      = useState(false);
  const [settingsOpen,    setSettingsOpen]    = useState(false);
  const [seatActionOpen,  setSeatActionOpen]  = useState(false);
  const [seatActionIdx,   setSeatActionIdx]   = useState(-1);
  const [invToSeatOpen,   setInvToSeatOpen]   = useState(false);
  const [invToSeatIdx,    setInvToSeatIdx]    = useState(-1);
  const [inviteOpen,      setInviteOpen]      = useState(false);
  const [audienceOpen,    setAudienceOpen]    = useState(false);
  const [membersOpen,     setMembersOpen]     = useState(false);
  const [giftsOpen,       setGiftsOpen]       = useState(false);
  const [giftsRecipient,  setGiftsRecipient]  = useState<Participant | null>(null);
  const [activeMember,    setActiveMember]    = useState<Participant | null>(null);
  const [exitModalOpen,   setExitModalOpen]   = useState(false);
  const [emojiPanelOpen,  setEmojiPanelOpen]  = useState(false);

  /* ── My Vee ID (for the "Copy V ID" self-profile action) ── */
  const [myVId, setMyVId] = useState<string>('');
  useEffect(() => {
    if (!user?.uid) return;
    getUser(user.uid).then((profile) => { if (profile?.vId) setMyVId(profile.vId); }).catch(() => {/* background: safe to swallow — Vee ID prefetch for copy button */});
  }, [user?.uid]);

  const handleViewOwnProfile = useCallback(() => {
    router.push('/profile');
  }, []);

  const handleEditOwnProfile = useCallback(() => {
    router.push('/profile/edit');
  }, []);

  const handleCopyVId = useCallback(() => {
    if (!myVId) return;
    Clipboard.setStringAsync(myVId).then(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t('voiceRoom.memberManage.vIdCopiedTitle'), myVId);
    }).catch(() => {
      Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.memberManage.vIdCopyFailed'));
    });
  }, [myVId, t]);

  /* ── Weekly diamond reset ── */
  const [weekStart, setWeekStart] = useState<number>(() => getWeekStart());
  useEffect(() => {
    const ws = getWeekStart();
    if (ws > weekStart) { setWeekStart(ws); }
  }, [weekStart]);

  /* ═══════════════════════════════════════════
     FIREBASE SUBSCRIPTIONS
  ═══════════════════════════════════════════ */

  // Subscribe to room info — BUG 16 fix: navigate away when room is closed
  useEffect(() => {
    return subscribeRoomInfo(roomId, (info) => {
      // info is null (deleted) or active:false (host closed it)
      if (!info || info.active === false) {
        // Only navigate if we haven't already started leaving ourselves.
        // This prevents a double router.back() when the host closes their own room
        // and the subscription fires AFTER handleLeave already called router.back().
        if (!hasLeftRef.current) {
          hasLeftRef.current = true;
          // Navigate first, THEN show the informational alert.
          // Showing the alert before navigating on Android can block the navigation
          // and calling router.back() again inside the alert button causes a double-pop.
          router.back();
          Alert.alert(
            t('voiceRoom.screen.roomClosed'),
            t('voiceRoom.screen.roomClosedMsg'),
          );
        }
        return;
      }
      setRoomName(info.name);
      setRoomTopic(info.topic);
      setOwnerId(info.ownerId);
      // Self-heal: if WE are the owner but our seat says 'member'/'admin'
      // (e.g. seated before ownerId loaded), correct it in Firebase.
      // Runs on every info update but only writes when actually wrong.
      if (info.ownerId && info.ownerId === myUidRef.current) {
        const mySeatIdxNow = seatsRef.current.findIndex(
          (s: Participant | null) => s?.id === myUidRef.current,
        );
        const mySeatNow = mySeatIdxNow >= 0 ? seatsRef.current[mySeatIdxNow] : null;
        if (mySeatNow && mySeatNow.role !== 'host') {
          setSeatRole(roomId, mySeatIdxNow, 'host').catch(() => {});
        }
      }
      setRoomImageUri(info.coverImageUrl ?? null);
      setRoomIsPublic(info.isPublic);
      setRoomIsLocked(info.isLocked ?? false);
      setRoomDescription(info.description ?? '');
      // Theme sync: owner/admin changes propagate to ALL users via Firebase.
      if (info.themeId && info.themeId !== activeThemeIdRef.current) {
        activeThemeIdRef.current = info.themeId;
        setActiveThemeId(info.themeId);
      }
      // Room is live — begin the staged native voice init.
      handleRoomInfoOk();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Subscribe to Firebase-persisted room blocks
  useEffect(() => {
    return subscribeRoomBlocks(roomId, (blocksMap) => {
      const records: BlockRecord[] = Array.from(blocksMap.values()).map((b: RoomBlockRecord) => ({
        id: b.userId,
        name: b.userName,
        initials: b.initials,
        color: b.color,
        action: b.action,
        actionBy: b.byName,
        timestamp: b.blockedAt,
        isActive: true,
      }));
      setBlockedRecs(records);
    });
  }, [roomId]);

  // Subscribe to pending seat requests (shown to host/admin)
  useEffect(() => {
    return subscribeSeatRequests(roomId, setPendingRequests);
  }, [roomId]);

  // Subscribe to seats
  useEffect(() => {
    return subscribeSeats(roomId, (fbSeats) => {
      setSeats(fbSeats.map(seat =>
        seat ? fbSeatToParticipant(seat, speakingRef.current) : null,
      ));
    });
  }, [roomId]);

  // Subscribe to audience
  useEffect(() => {
    return subscribeAudience(roomId, (fbAudience) => {
      const participants = fbAudience.map(fbAudToParticipant);
      setAudience(participants);
      // ENTRY EFFECT (2026-10-10): Detect new joins and show "X is Coming" banner.
      // Compare with previous IDs; skip the initial load (prev set is empty).
      const prevIds = prevAudienceIdsRef.current;
      if (prevIds.size > 0) {
        for (const p of participants) {
          if (!prevIds.has(p.id) && p.id !== myUid) {
            // New joiner (not me) — show entry banner
            setEntryBanner({
              name: p.name || 'User',
              photoURL: (p as any).photoURL || null,
            });
            break; // show one at a time
          }
        }
      }
      prevAudienceIdsRef.current = new Set(participants.map((p) => p.id));
    });
  }, [roomId, myUid]);

  // Subscribe to room chat — Fix 11: track oldest key for pagination
  useEffect(() => {
    return subscribeRoomChat(roomId, myUid, (fbMsgs) => {
      setMessages(fbMsgs.map(fbChatToMsg));
      if (fbMsgs.length > 0) {
        setChatOldestKey(fbMsgs[0].id);
        // If we got a full page (50), there might be older messages
        setHasOlderMsgs(fbMsgs.length >= 50);
      }
      // Clear any pending scroll timer before scheduling a new one
      if (scrollTimerRef.current !== null) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        scrollTimerRef.current = null;
        chatRef.current?.scrollToEnd({ animated: false });
      }, 80);
    });
  }, [roomId, myUid]);

  /* ── mySeatIdx: declared early so all effects below can reference it safely ── */
  const mySeatIdx = useMemo(
    () => seats.findIndex((s: Participant | null) => s?.id === myUid),
    [seats, myUid],
  );

  /**
   * Ref that always holds the latest mySeatIdx.
   */
  const mySeatIdxRef = useRef(mySeatIdx);
  useEffect(() => {
    mySeatIdxRef.current = mySeatIdx;
  }, [mySeatIdx]);

  /**
   * Auto-publish guard: fires at most once per room session.
   * Handles two cases where startPublishing() would otherwise be skipped:
   *   1. Owner: createRoom() places them in seat 0, so they arrive in the
   *      room already seated — they never call joinSeat() and thus never
   *      reach the startPublishing() call inside it.
   *   2. Invited to seat: host calls takeSeat() on behalf of an audience
   *      member. That member's client sees the seat appear via subscribeSeats,
   *      but joinSeat() is never called on their device.
   * Guard fires only once (hasAutoPublishedRef) so it doesn't re-publish on
   * subsequent mySeatIdx changes (e.g. moving between seats).
   */
  const hasAutoPublishedRef = useRef(false);
  useEffect(() => {
    if (hasAutoPublishedRef.current) return;
    if (!voiceJoined || mySeatIdx < 0) return;
    hasAutoPublishedRef.current = true;
    // Mark as joined so leave/unmount cleanup runs correctly for owner
    if (!hasJoined) setHasJoined(true);
    startPublishing();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceJoined, mySeatIdx]);

  /**
   * Owner auto-join fix: Auto-mark owner as joined when they enter their own
   * room — regardless of whether they currently have a seat.
   *
   * Previously the guard `mySeatIdx >= 0` blocked auto-join when the owner
   * re-entered after leaving their seat (e.g. via "My Rooms"). Without this
   * fix the owner was never added to the audience list, `hasJoined` stayed
   * false, and they could not interact with the room properly.
   *
   * Removing the seat-index guard is safe: `joinRoomAsAudience` is idempotent,
   * and `takeSeat` removes the owner from audience as soon as they sit down.
   */
  useEffect(() => {
    if (!hasJoined && ownerId && ownerId === myUid) {
      setHasJoined(true);
    }
  }, [hasJoined, ownerId, myUid]);

  /**
   * Issue 2 fix: Sync host-driven Firebase seat.muted changes → local mic.
   * When a host/admin toggles someone's mute in SeatActionSheet → setSeatMute(),
   * the target user's Firebase seat entry updates. This effect detects the change
   * and mutes/unmutes the local microphone to match.
   */
  const prevFbMutedRef = useRef<boolean | null>(null);
  // CRITICAL-4 fix: track seat index to reset mute-sync on seat changes
  const prevMySeatIdxRef = useRef<number>(-1);
  useEffect(() => {
    if (mySeatIdx < 0) {
      prevFbMutedRef.current = null;
      prevMySeatIdxRef.current = -1;
      // SAFETY (2026-10-09): if not on any seat but still publishing
      // (e.g. rapid seat-switch race left us seatless), stop the mic.
      // Prevents "ghost mic" where ID disappears but audio continues.
      if (isPublishing) {
        stopPublishing();
      }
      return;
    }
    // Seat changed — always apply new seat's muted value regardless of prev
    if (prevMySeatIdxRef.current !== mySeatIdx) {
      prevFbMutedRef.current = null;
      prevMySeatIdxRef.current = mySeatIdx;
    }
    const mySeat = seats[mySeatIdx];
    if (!mySeat) return;
    const fbMuted = mySeat.muted;
    if (!isPublishing) {
      // FIX (2026-10-10): Do NOT mark the mute as applied when not publishing.
      // Previously prevFbMutedRef was set even when setMicMuted was skipped,
      // so when publishing later started, the effect saw "no change" and never
      // applied the seat's mute — the engine stayed muted=true while the UI
      // showed unmuted (mic dead on some IDs). Reset instead so the mute is
      // applied on the first effect run after publishing starts.
      prevFbMutedRef.current = null;
      return;
    }
    if (prevFbMutedRef.current === fbMuted) return; // no change
    prevFbMutedRef.current = fbMuted;
    setMicMuted(fbMuted);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seats, mySeatIdx, isPublishing]);

  /* ── LiveKit speaking detection → seats speaking state ── */
  useEffect(() => {
    if (!speakingUsers || Object.keys(speakingUsers).length === 0) return;
    setSeats((prev: Array<Participant | null>) => prev.map((s: Participant | null) => {
      if (!s || s.id === myUid) return s;
      const isSpeaking = speakingUsers[s.id] === true;
      return isSpeaking !== s.speaking ? { ...s, speaking: isSpeaking } : s;
    }));
  }, [speakingUsers, myUid]);

  // Local user
  useEffect(() => {
    if (mySeatIdx < 0) return;
    setSeats((prev: Array<Participant | null>) => prev.map((s: Participant | null, i: number) => {
      if (i !== mySeatIdx || !s) return s;
      return s.speaking !== localSpeaking ? { ...s, speaking: localSpeaking } : s;
    }));
  }, [localSpeaking, mySeatIdx]);

  /* ── Join room: check if blocked before joining ── */
  useEffect(() => {
    if (!hasJoined) return;
    isUserBlockedInRoom(roomId, myUid).then((blocked) => {
      if (blocked) {
        Alert.alert(t('voiceRoom.screen.accessDenied'), t('voiceRoom.screen.accessDeniedMsg'));
        router.back();
      }
    }).catch(() => {/* background: safe to swallow — block check; fail-open keeps user in room */});
  }, [hasJoined, roomId, myUid]);

  /* ── BUG 11 fix: track whether the leave cleanup has already been run
     (either explicitly via handleLeave/handleMinimize, or by the effect
     cleanup on unmount). Prevents the double-remove that occurred when
     router.back() unmounted the screen right after handleLeave ran. ── */
  const hasLeftRef = useRef(false);

  /* ── Join room: add to Firebase audience ── */
  useEffect(() => {
    if (!hasJoined) return;
    hasLeftRef.current = false;

    joinRoomAsAudience(roomId, {
      userId: myUid,
      userName: myName,
      initials: myInitials,
      color: myColor,
      ...(myPhotoURL ? { photoURL: myPhotoURL } : {}),
    }).catch(() => {/* background: safe to swallow — audience join lifecycle */});

    // Send join message to room chat
    sendRoomChatMsg(roomId, {
      senderId: 'system',
      senderName: 'System',
      senderColor: C.gold,
      text: t('voiceRoom.screen.joinedRoom', { name: myName }),
      ts: Date.now(),
    }).catch(() => {/* background: safe to swallow — ephemeral join chat message */});

    return () => {
      // BUG 11 fix: only run cleanup once — handleLeave marks hasLeftRef first
      if (hasLeftRef.current) return;
      hasLeftRef.current = true;
      if (mySeatIdxRef.current >= 0) {
        removeSeat(roomId, mySeatIdxRef.current).catch(() => {/* background: safe to swallow — unmount cleanup */});
      } else {
        leaveAudience(roomId, myUid).catch(() => {/* background: safe to swallow — unmount cleanup */});
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasJoined]);

  /* ── Cleanup scroll timer on unmount ── */
  useEffect(() => {
    return () => {
      if (scrollTimerRef.current !== null) {
        clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
    };
  }, []);

  /* ═══════════════════════════════════════════
     DERIVED STATE
  ═══════════════════════════════════════════ */

  const seatMembers = useMemo(() => seats.filter((s: Participant | null): s is Participant => s !== null), [seats]);
  // DEDUPE FIX (2026-10-09): the same user can appear in seats + audience
  // (or ghost seats) — dedupe by ID so member lists, counts and gift
  // recipient pickers never show the same person twice.
  const allMembers  = useMemo(() => {
    const map = new Map<string, Participant>();
    for (const p of [...seatMembers, ...audience]) {
      if (!map.has(p.id)) map.set(p.id, p);
    }
    return [...map.values()];
  }, [seatMembers, audience]);

  const myRole: Role = useMemo(() => {
    const mySeat = seats.find((s: Participant | null) => s?.id === myUid);
    // Fall back to ownerId when the user currently has no seat (e.g. the
    // host stepped down from their seat) so the owner never gets
    // misdetected as a plain member and loses host-only capabilities.
    return mySeat?.role ?? (ownerId && ownerId === myUid ? 'host' : 'member');
  }, [seats, myUid, ownerId]);

  const isOwnerOrAdmin = myRole === 'host' || myRole === 'admin';

  // "Tap to join" must only ever be shown to audience who have not joined
  // yet — never to the owner/admin/member who are already inside the room.
  const showJoinBanner = !hasJoined && !isOwnerOrAdmin && mySeatIdx < 0;

  const seatActionMember = seatActionIdx >= 0 ? seats[seatActionIdx] ?? null : null;

  /** Live members whose names start with the current @-query (max 6, excludes self). */
  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return allMembers
      .filter((m: Participant) => m.id !== myUid)
      .filter((m: Participant) => !q || m.name.toLowerCase().startsWith(q));
  }, [mentionQuery, allMembers, myUid]);

  /** Handles chat TextInput changes and detects @-mention triggers. */
  const handleChatInput = useCallback((text: string) => {
    setChatInput(text);
    const match = text.match(/@(\w*)$/);
    if (match) {
      setMentionQuery(match[1] ?? '');
    } else {
      setMentionQuery(null);
    }
  }, []);

  /** Replaces the trailing @query with the selected member name and closes the picker. */
  const handleSelectMention = useCallback((memberName: string) => {
    setChatInput((prev: string) => prev.replace(/@\w*$/, `@${memberName} `));
    setMentionQuery(null);
  }, []);

  /* ═══════════════════════════════════════════
     ACTIONS
  ═══════════════════════════════════════════ */

  const toggleMic = useCallback(() => {
    // Must be in a seat to toggle mic
    if (mySeatIdx < 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (!isPublishing) {
      // Not publishing yet (e.g. voice engine still initialising, or owner pre-seated).
      // Start publishing — mic will start muted; user taps again to unmute.
      startPublishing();
      return;
    }

    const newMuted = engineToggleMic(); // single source of truth — never `!muted`
    // Optimistically update local seat indicator (no wait for Firebase round-trip)
    setSeats(prev => prev.map((s, i) =>
      i === mySeatIdx && s ? { ...s, muted: newMuted } : s,
    ));
    // Persist mute state so other clients see the mic indicator change
    setSeatMute(roomId, mySeatIdx, newMuted).catch(() => {});
  }, [engineToggleMic, startPublishing, isPublishing, mySeatIdx, roomId]);

  const toggleSpeaker = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    engineToggleSpeaker();
  }, [engineToggleSpeaker]);

  const handleSeatPress = useCallback((seatIdx: number) => {
    const member = seats[seatIdx];
    // Tapping your OWN seat always opens your own profile view (View/Edit
    // Profile, Copy V ID) — regardless of role. Previously audience members
    // got no reaction at all, and hosts/admins got the moderation sheet
    // meant for other people.
    if (member && member.id === myUid) { setActiveMember(member); return; }
    if (!isOwnerOrAdmin) {
      if (member && member.id !== myUid) { setActiveMember(member); return; }
      if (!member) {
        if (lockedSeats.has(seatIdx)) {
          // CRITICAL-5 fix: Locked seat → prompt to send a request
          Alert.alert(
            t('voiceRoom.screen.lockedSeat'),
            t('voiceRoom.screen.lockedSeatMsg'),
            [
              {
                text: t('voiceRoom.screen.requestSeat'),
                onPress: async () => {
                  try {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    await sendSeatRequest(roomId, {
                      userId: myUid,
                      userName: myName,
                      initials: myInitials,
                      color: myColor,
                      seatIdx,
                      ts: Date.now(),
                      hostId: ownerId || myUid,
                    });
                    Alert.alert(
                      t('voiceRoom.screen.requestSentTitle'),
                      t('voiceRoom.screen.requestSentMsg'),
                    );
                  } catch {
                    Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.screen.requestError'));
                  }
                },
              },
              { text: t('voiceRoom.screen.cancel'), style: 'cancel' },
            ],
          );
          return;
        }
        // CRITICAL-5 fix: Unlocked empty seat → join immediately, no request needed
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        joinSeat(seatIdx);
      }
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSeatActionIdx(seatIdx);
    setSeatActionOpen(true);
  }, [isOwnerOrAdmin, seats, myUid, lockedSeats, roomId, myName, myInitials, myColor, ownerId, t]);

  const muteToggleMember = useCallback((memberId: string) => {
    const seatIdx = seats.findIndex((s: Participant | null) => s?.id === memberId);
    setSeats((prev: Array<Participant | null>) => prev.map((s: Participant | null) => {
      if (s?.id !== memberId) return s;
      const newMuted = !s.muted;
      if (newMuted) muteRemoteUser(memberId);
      else playUserStream(memberId);
      if (seatIdx >= 0) {
        setSeatMute(roomId, seatIdx, newMuted).catch(() => {});
      }
      return { ...s, muted: newMuted };
    }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [muteRemoteUser, playUserStream, seats, roomId]);

  const downFromSeat = useCallback((seatIdx: number) => {
    const member = seats[seatIdx];
    if (!member) return;
    if (member.id === myUid) {
      stopPublishing();
    } else {
      stopUserStream(member.id);
    }
    // Issue 6: pass full member data (including photoURL + role) so the user
    // is properly restored to the Live Audience list with their profile photo.
    fbLeaveSeat(roomId, seatIdx, member.id, {
      userId: member.id,
      userName: member.name,
      initials: member.initials,
      color: member.color,
      ...(member.photoURL ? { photoURL: member.photoURL } : {}),
      ...(member.role && member.role !== 'host' ? { role: member.role } : {}),
    }).catch(() => {/* background: safe to swallow — ephemeral system chat message */});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [seats, myUid, roomId, stopPublishing, stopUserStream]);

  const joinSeat = useCallback(async (seatIdx: number) => {
    // Already sitting in this seat — nothing to do. (takeSeat's transaction
    // would abort on our own occupied seat, so short-circuit here.)
    if (mySeatIdx === seatIdx) return;
    const target = seats[seatIdx];
    if (target && target.id !== myUid) {
      Alert.alert(t('voiceRoom.screen.seatOccupied'), t('voiceRoom.screen.seatOccupiedFirst'));
      return;
    }

    // role: the owner MUST always be seated as 'host', even if room info
    // (ownerId) hasn't finished loading yet — otherwise a race seats the
    // owner as 'member' and they lose host powers + see the wrong badge.
    // Belt-and-braces: check ownerId directly, not just the myRole memo.
    const seatRole: Role = (ownerId && ownerId === myUid) ? 'host' : myRole;
    const seatData: NonNullable<RoomSeat> = {
      userId: myUid,
      userName: myName,
      initials: myInitials,
      color: myColor,
      ...(myPhotoURL ? { photoURL: myPhotoURL } : {}),
      // CRITICAL-4 fix: preserve current mute state when moving between seats;
      // start muted only on first join from audience (mySeatIdx < 0).
      muted: mySeatIdx >= 0 ? muted : true,
      role: seatRole,
    };

    // RACE FIX: await the takeSeat transaction BEFORE vacating the old seat.
    // Previously takeSeat() was fire-and-forget and removeSeat(oldSeat) ran
    // unconditionally — losing the seat race (or a network/rules failure)
    // left the user seatless in the audience with publishing state out of sync.
    let won = false;
    try {
      won = (await takeSeat(roomId, seatIdx, seatData)).success;
    } catch {
      won = false; // network/rules failure — keep the current seat
    }
    if (!won) {
      Alert.alert(t('voiceRoom.screen.seatOccupied'), t('voiceRoom.screen.seatOccupiedFirst'));
      return;
    }

    // H8 FIX: Use ref (not stale state) for old seat index. During rapid
    // switches, mySeatIdx (from useMemo on seats) can be stale because
    // Firebase hasn't synced yet. Update ref synchronously.
    const oldIdx = mySeatIdxRef.current;
    mySeatIdxRef.current = seatIdx;
    if (oldIdx >= 0 && oldIdx !== seatIdx) {
      removeSeat(roomId, oldIdx).catch(() => {});
    } else if (oldIdx < 0) {
      startPublishing();
      // FIRST-SEAT FIX (2026-10-09): Firebase seat.muted=true but the local
      // mic starts live — explicitly mute to match. Otherwise the UI shows
      // muted while the mic is actually transmitting.
      setMicMuted(true);
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [seats, myUid, myName, myInitials, myColor, myRole, mySeatIdx, roomId, startPublishing, muted, t]);

  /**
   * CRITICAL-3 fix: Mic bar button behaves differently by role.
   * Placed after joinSeat declaration to avoid "used before assigned" TS error.
   * • Audience (not in a seat): tapping joins the first available unlocked seat.
   * • Speaker (in a seat): tapping toggles Mute / Unmute.
   */
  const handleMicBarPress = useCallback(() => {
    if (mySeatIdx >= 0) {
      toggleMic();
      return;
    }
    const firstAvail = seats.findIndex(
      (s: Participant | null, idx: number) => !s && !lockedSeats.has(idx),
    );
    if (firstAvail >= 0) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      joinSeat(firstAvail);
    } else {
      Alert.alert(
        t('voiceRoom.screen.noSeatsTitle'),
        t('voiceRoom.screen.noSeatsMsg'),
      );
    }
  }, [mySeatIdx, toggleMic, seats, lockedSeats, joinSeat, t]);

  // ── Subscribe to Firebase-synced locked seats ──────────────────────────────
  useEffect(() => {
    if (!roomId) return;
    const unsub = subscribeLockedSeats(roomId, setLockedSeats);
    return unsub;
  }, [roomId]);

  const lockSeat = useCallback((seatIdx: number) => {
    fbLockSeat(roomId, seatIdx).catch(() => {});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [roomId]);

  const unlockSeat = useCallback((seatIdx: number) => {
    fbUnlockSeat(roomId, seatIdx).catch(() => {});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [roomId]);

  const setAdminRole = useCallback((memberId: string) => {
    const seatIdx = seats.findIndex((s: Participant | null) => s?.id === memberId);
    if (seatIdx >= 0) {
      setSeatRole(roomId, seatIdx, 'admin').catch(() => {});
    }
    const inAudience = audience.find((m: Participant) => m.id === memberId);
    if (inAudience) {
      setAudienceRole(roomId, memberId, 'admin').catch(() => {});
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [seats, audience, roomId]);

  const dismissAdmin = useCallback((memberId: string) => {
    const seatIdx = seats.findIndex((s: Participant | null) => s?.id === memberId);
    if (seatIdx >= 0) {
      setSeatRole(roomId, seatIdx, 'member').catch(() => {});
    }
    const inAudience = audience.find((m: Participant) => m.id === memberId);
    if (inAudience) {
      setAudienceRole(roomId, memberId, 'member').catch(() => {});
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [seats, audience, roomId]);

  const blockUser = useCallback((memberId: string, action: 'room-block' | 'comment-block') => {
    const inSeat = seats.find((s: Participant | null) => s?.id === memberId);
    const inAud  = audience.find((m: Participant) => m.id === memberId);
    const member = inSeat ?? inAud;
    if (!member) return;

    if (inSeat) {
      const seatIdx = seats.findIndex((s: Participant | null) => s?.id === memberId);
      removeSeat(roomId, seatIdx).catch(() => {});
    } else {
      removeAudienceMember(roomId, memberId).catch(() => {});
    }

    const blockRecord: RoomBlockRecord = {
      userId: member.id,
      userName: member.name,
      initials: member.initials,
      color: member.color,
      blockedAt: Date.now(),
      blockedBy: myUid,
      byName: myName,
      action,
    };
    blockUserInRoom(roomId, blockRecord).catch(() => {});

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Alert.alert(
      t('voiceRoom.screen.userBlockedDone'),
      action === 'room-block'
        ? t('voiceRoom.screen.userRoomBlocked', { name: member.name })
        : t('voiceRoom.screen.userCommentBlocked', { name: member.name }),
    );
  }, [seats, audience, roomId, myUid, myName, t]);

  const unblockUser = useCallback((userId: string) => {
    const record = blockedRecs.find((r: BlockRecord) => r.id === userId && r.isActive);
    if (!record) return;
    unblockUserInRoom(roomId, userId).catch(() => {});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [blockedRecs, roomId]);

  // Fix 1: Send seat invite via Firebase instead of directly placing the user
  const inviteToSeat = useCallback((memberId: string, seatIdx: number) => {
    const member = audience.find((m: Participant) => m.id === memberId);
    if (!member) return;
    if (seats[seatIdx]) {
      Alert.alert(t('voiceRoom.screen.seatOccupied'), t('voiceRoom.screen.seatAlreadyTaken'));
      return;
    }
    Alert.alert(
      t('voiceRoom.screen.inviteMember', { name: member.name }),
      t('voiceRoom.screen.sendInviteToSeat', { number: seatIdx + 1 }),
      [
        {
          text: t('voiceRoom.screen.sendInvite'),
          onPress: () => {
            // Fix 1: Write invite to Firebase — invited user decides to accept/decline
            sendSeatInvite(member.id, {
              roomId, roomName, seatIdx,
              inviterUid: myUid, inviterName: myName,
              ts: Date.now(),
            }).then(() => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }).catch(() => {
              Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.screen.inviteSendError'));
            });
          },
        },
        { text: t('voiceRoom.screen.cancel'), style: 'cancel' },
      ],
    );
  }, [audience, seats, roomId, roomName, myUid, myName, t]);

  const handleLeave = useCallback(() => {
    // BUG 11 fix: mark as already cleaned up so the effect cleanup
    // (triggered by router.back() → unmount) doesn't run it a second time.
    hasLeftRef.current = true;

    if (mySeatIdx >= 0) {
      stopPublishing();
      removeSeat(roomId, mySeatIdx).catch(() => {/* background: safe to swallow — leave teardown; screen navigates away */});
    } else if (hasJoined) {
      leaveAudience(roomId, myUid).catch(() => {/* background: safe to swallow — leave teardown; screen navigates away */});
    }
    // Issue 8 fix: Rooms persist until the owner explicitly deletes them from
    // Settings. Do NOT auto-close when the host leaves — other users can still
    // rejoin and the room remains discoverable in the room list.
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setExitModalOpen(false);
    router.back();
  }, [mySeatIdx, hasJoined, myUid, myRole, seats, audience, roomId, stopPublishing]);

  const handleMinimize = useCallback(() => {
    // BUG 11 fix: mark as already cleaned up so the effect cleanup
    // does not incorrectly remove the user from the room on minimize.
    // The user is still "in" the minimized room — do NOT remove them.
    hasLeftRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Minimize fix: signal the voice hook to persist the LiveKit room instead
    // of disconnecting it when the screen unmounts.
    setVoiceRoomMinimized(true);
    setMinimizedRoom({
      id:       roomId,
      name:     roomName,
      topic:    roomTopic,
      myUid,
      mySeatIdx,
      muted,
    });
    setExitModalOpen(false);
    router.back();
  }, [roomId, roomName, roomTopic, myUid, mySeatIdx, muted]);

  // BACK BUTTON → MINIMIZE (2026-10-10, Sumon's order): pressing the phone's
  // back button while in a voice room minimizes instead of leaving.
  // The room keeps running in the background (talk + listen).
  useEffect(() => {
    const onBackPress = () => {
      handleMinimize();
      return true; // prevent default back behavior
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [handleMinimize]);

  // RACE FIX (double-tap): `sendingMsg` is state — two invocations within the
  // same frame (double-tap, or keyboard submit racing the send button) both
  // read the stale `false` value and send duplicates. The ref closes that
  // window; it also serializes sends so same-device messages stay in order.
  // The input is only cleared on success, so a dropped duplicate loses nothing.
  const sendingMsgRef = useRef(false);

  const sendMessage = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || sendingMsgRef.current) return;
    sendingMsgRef.current = true;
    setSendingMsg(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await sendRoomChatMsg(roomId, {
        senderId: myUid,
        senderName: myName,
        senderColor: myColor,
        text,
        ts: Date.now(),
        ...(replyingTo ? { replyTo: { sender: replyingTo.sender, text: replyingTo.text, color: replyingTo.color } } : {}),
      });
      // Only clear input + scroll on success
      setChatInput('');
      setReplyingTo(null);
      setMentionQuery(null);
      if (scrollTimerRef.current !== null) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        scrollTimerRef.current = null;
        chatRef.current?.scrollToEnd({ animated: true });
      }, 80);
    } catch (err) {
      // Comment-block / room-block enforcement: show feedback to the user
      if (err instanceof Error && err.message === 'blocked') {
        Alert.alert(
          t('voiceRoom.screen.blockedTitle'),
          t('voiceRoom.screen.commentBlockedMsg'),
        );
      }
    } finally {
      sendingMsgRef.current = false;
      setSendingMsg(false);
    }
  }, [chatInput, replyingTo, roomId, myUid, myName, myColor, t]);

  const handleMention  = useCallback((name: string) => { setChatInput((prev: string) => `@${name} ${prev}`); }, []);

  const handleJoinRoom = useCallback(() => {
    setHasJoined(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  /** Disband the room entirely (owner only) — removes all Firebase data then navigates away. */
  const handleDisband = useCallback(async () => {
    hasLeftRef.current = true;
    stopPublishing();
    try {
      await disbandRoom(roomId);
    } catch {
      // DISBAND FIX (2026-10-10): never fail silently — the user must know
      // the room was NOT deleted (previously the rules denied the delete and
      // the room silently survived).
      Alert.alert('Disband failed', 'Could not delete the room. Please try again.');
      hasLeftRef.current = false;
      return;
    }
    router.back();
  }, [roomId, stopPublishing]);

  // Track 3: GiftsModal now delivers a GiftSentInfo payload. Keep the ephemeral
  // chat message, then trigger the sender-side fly animation once per recipient.
  const handleGiftSent = useCallback((info: GiftSentInfo) => {
    // Wallet balance updates automatically via Firebase subscription
    sendRoomChatMsg(roomId, {
      senderId: myUid,
      senderName: myName,
      senderColor: myColor,
      text: t('voiceRoom.screen.sentGift', { emoji: info.emoji, names: info.recipients.map((r) => r.name).join(', '), coins: info.coins }),
      ts: Date.now(),
    }).catch(() => {/* background: safe to swallow — ephemeral gift chat message */});

    const fly = (toUid: string, toName: string, toAvatar: string | undefined, target: { x: number; y: number } | null) => {
      giftFlyRef.current?.playFly({
        fromName: info.senderName,
        fromAvatar: info.senderAvatar,
        toUid, toName, toAvatar,
        giftId: info.giftId,
        emoji: info.emoji,
        coins: info.coins,
        target,
      });
    };
    for (const r of info.recipients) {
      try {
        const v = seatViewRefs.current[r.uid];
        if (v) {
          // measureInWindow gives screen coords the overlay can use directly.
          v.measureInWindow((x, y, w, h) => fly(r.uid, r.name, r.photoURL, { x: x + w / 2, y: y + h / 2 }));
        } else {
          fly(r.uid, r.name, r.photoURL, null); // recipient not on a seat → top-center fallback
        }
      } catch {
        fly(r.uid, r.name, r.photoURL, null);
      }
    }
  }, [roomId, myUid, myName, myColor, t]);

  // Fix 5: Broadcast emoji via Firebase so all clients animate simultaneously
  const sendEmojiReaction = useCallback((emoji: string) => {
    setEmojiPanelOpen(false);
    // Write to Firebase — subscribeRoomEmojiReactions handles animation on ALL clients
    sendRoomEmojiReaction(roomId, { emoji, byUid: myUid, byName: myName }).catch(() => {/* background: safe to swallow — ephemeral emoji broadcast */});
    sendRoomChatMsg(roomId, {
      senderId: myUid,
      senderName: myName,
      senderColor: myColor,
      text: emoji,
      ts: Date.now(),
    }).catch(() => {/* background: safe to swallow — ephemeral emoji chat message */});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [roomId, myUid, myName, myColor]);

  // Fix 11: Load older messages (chat pagination)
  const handleLoadOlderMessages = useCallback(async () => {
    if (!chatOldestKey || loadingOlderMsgs || !hasOlderMsgs) return;
    setLoadingOlderMsgs(true);
    try {
      const older = await loadOlderMessages(roomId, myUid, chatOldestKey, 30);
      if (older.length === 0) {
        setHasOlderMsgs(false);
      } else {
        setMessages((prev: ChatMsg[]) => [...older.map(fbChatToMsg), ...prev]);
        setChatOldestKey(older[0].id);
      }
    } catch { /* non-critical */ }
    setLoadingOlderMsgs(false);
  }, [chatOldestKey, loadingOlderMsgs, hasOlderMsgs, roomId, myUid]);

  // Fix 13: Navigate to another user's profile screen
  const handleViewOtherProfile = useCallback((uid: string, name: string) => {
    router.push({ pathname: '/user-profile', params: { uid, name } } as Parameters<typeof router.push>[0]);
  }, []);

  const renderChatMessage = useCallback(
    ({ item }: { item: ChatMsg }) => (
      <RoomChatMessage item={item} accentColor={accentColor} onReply={setReplyingTo} />
    ),
    [accentColor],
  );

  /* ── Layout ── */
  const bottomPad  = Math.max(insets.bottom, Platform.OS === 'web' ? 20 : 8) + 14;
  const BOTTOM_BAR_H = bottomPad + 14 + 58;

  /* ═══ RENDER ═══ */
  return (
    <View style={{ flex: 1, backgroundColor: themeBg }}>
      {/* Animated theme background — breathing glow + floating particles.
          Theme is Firebase-synced so every user sees the same animation. */}
      <AnimatedThemeBackground accentColor={accentColor} />
      <SafeAreaView edges={['top']}>
        {/* ═══ HEADER ═══ */}
        <View style={{ paddingHorizontal: 14, paddingTop: Platform.OS === 'web' ? 68 : 10, paddingBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {/* Room avatar — cover image or first-letter initials */}
            <Pressable onPress={() => setRoomInfoOpen(true)}>
              <View style={{
                width: 36, height: 36, borderRadius: 18,
                overflow: 'hidden',
                borderWidth: 1.5, borderColor: accentColor + '66',
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: accentColor + '22',
              }}>
                {roomImageUri ? (
                  <Image source={{ uri: roomImageUri }} style={{ width: 36, height: 36 }} />
                ) : (
                  <Text style={{ color: accentColor, fontSize: 14, fontWeight: '900' }}>
                    {roomName.charAt(0).toUpperCase()}
                  </Text>
                )}
              </View>
            </Pressable>

            {/* Room name — taps open room info panel */}
            <Pressable onPress={() => setRoomInfoOpen(true)} style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: C.text, fontSize: 16, fontWeight: '900' }}>
                {roomName}
              </Text>
            </Pressable>

            {/* Join button — shown to passive viewers who haven't tapped Join yet */}
            {showJoinBanner && (
              <ScalePress onPress={handleJoinRoom}>
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 5,
                  backgroundColor: accentColor, borderRadius: 20,
                  paddingHorizontal: 14, paddingVertical: 7,
                  shadowColor: accentColor, shadowOpacity: 0.5, shadowRadius: 8,
                  shadowOffset: { width: 0, height: 2 },
                }}>
                  <Feather name="user-plus" size={14} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>
                    {t('voiceRoom.screen.joinRoom')}
                  </Text>
                </View>
              </ScalePress>
            )}

            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              {/* Diamond counter */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4,
                backgroundColor: 'rgba(245,158,11,0.14)', borderRadius: 999,
                paddingHorizontal: 10, paddingVertical: 5,
                borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)',
              }}>
                <Text style={{ color: C.gold, fontSize: 13 }}>💎</Text>
                <Text style={{ color: C.gold, fontSize: 13, fontWeight: '800' }}>
                  {fmtDiamonds(walletBalance)}
                </Text>
              </View>

              {/* Pending seat requests badge — host/admin only */}
              {isOwnerOrAdmin && pendingRequests.length > 0 && (
                <ScalePress
                  onPress={() => {
                    const req = pendingRequests[0];
                    if (!req) return;
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    Alert.alert(
                      t('voiceRoom.screen.seatRequestTitle', { count: pendingRequests.length }),
                      t('voiceRoom.screen.seatRequestMsg', { name: req.userName, number: req.seatIdx + 1 }),
                      [
                        {
                          text: t('voiceRoom.screen.approve'),
                          onPress: async () => {
                            try {
                              const [seatsSnap, lockedSnap] = await Promise.all([
                                get(ref(database, `rooms/${roomId}/seats/${req.seatIdx}`)),
                                get(ref(database, `rooms/${roomId}/lockedSeats/${req.seatIdx}`)),
                              ]);
                              if (seatsSnap.exists()) {
                                Alert.alert(t('voiceRoom.screen.seatNoLongerEmpty'), t('voiceRoom.screen.seatNoLongerEmptyMsg'));
                                rejectSeatRequest(roomId, req.id).catch(() => {/* background: safe to swallow — request cleanup after alert shown */});
                                return;
                              }
                              if (lockedSnap.exists() && lockedSnap.val() === true) {
                                Alert.alert(t('voiceRoom.screen.seatLocked'), t('voiceRoom.screen.seatLockedMsg'));
                                rejectSeatRequest(roomId, req.id).catch(() => {/* background: safe to swallow — request cleanup after alert shown */});
                                return;
                              }
                              // RACE FIX: the emptiness check above is read-then-act —
                              // someone may sit down in the gap before the write.
                              // Only mark the request approved when the seat was
                              // actually won, otherwise the requester gets an
                              // "approved" push but no seat.
                              const seatResult = await takeSeat(roomId, req.seatIdx, {
                                userId: req.userId,
                                userName: req.userName,
                                initials: req.initials,
                                color: req.color,
                                muted: true,
                                role: 'member',
                              });
                              if (!seatResult.success) {
                                Alert.alert(t('voiceRoom.screen.seatNoLongerEmpty'), t('voiceRoom.screen.seatNoLongerEmptyMsg'));
                                rejectSeatRequest(roomId, req.id).catch(() => {/* background: safe to swallow — request cleanup after alert shown */});
                                return;
                              }
                              await approveSeatRequest(roomId, req.id);
                              sendRoomChatMsg(roomId, {
                                senderId: 'system',
                                senderName: 'System',
                                senderColor: C.gold,
                                text: t('voiceRoom.screen.memberJoinedSeatApproved', { name: req.userName, number: req.seatIdx + 1 }),
                                ts: Date.now(),
                              }).catch(() => {/* background: safe to swallow — ephemeral system chat message */});
                              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            } catch {
                              Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.screen.approveError'));
                            }
                          },
                        },
                        {
                          text: t('voiceRoom.screen.reject'),
                          style: 'destructive',
                          onPress: () => {
                            rejectSeatRequest(roomId, req.id).catch(() => {});
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                          },
                        },
                        { text: t('voiceRoom.screen.later'), style: 'cancel' },
                      ],
                    );
                  }}
                >
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', gap: 4,
                    backgroundColor: accentColor + '22', borderRadius: 999,
                    paddingHorizontal: 10, paddingVertical: 5,
                    borderWidth: 1, borderColor: accentColor + '55',
                  }}>
                    <Feather name="mic" size={13} color={accentColor} />
                    <Text style={{ color: accentColor, fontSize: 12, fontWeight: '800' }}>
                      {pendingRequests.length}
                    </Text>
                  </View>
                </ScalePress>
              )}
              {isOwnerOrAdmin && (
                <ScalePress onPress={() => setSettingsOpen(true)}>
                  <Feather name="settings" size={26} color={C.sub} />
                </ScalePress>
              )}
            </View>
          </View>
        </View>
      </SafeAreaView>

      {/* ═══ BODY ═══ */}
      <View style={{ flex: 1, paddingHorizontal: 14, paddingBottom: BOTTOM_BAR_H }}>

        {/* ── Join banner: audience only, never owner/admin/already-joined ── */}
        {showJoinBanner && (
          <ScalePress onPress={handleJoinRoom}>
            <View style={{
              marginVertical: 10, borderRadius: 16, padding: 14,
              backgroundColor: accentColor,
              flexDirection: 'row', alignItems: 'center', gap: 10,
              shadowColor: accentColor, shadowOpacity: 0.5,
              shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
            }}>
              <Feather name="log-in" size={20} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '900', flex: 1 }}>
                {t('voiceRoom.screen.joinBanner')}
              </Text>
            </View>
          </ScalePress>
        )}

        {/* ── My role badge — shown once actually inside the room ── */}
        {(hasJoined || mySeatIdx >= 0) && (
          <View style={{
            alignSelf: 'flex-start', marginBottom: 8, flexDirection: 'row', alignItems: 'center',
            backgroundColor: myRole === 'host'  ? C.gold + '22'
                           : myRole === 'admin' ? accentColor + '22'
                           : 'rgba(255,255,255,0.07)',
            borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5,
            borderWidth: 1,
            borderColor: myRole === 'host'  ? C.gold + '66'
                       : myRole === 'admin' ? accentColor + '66'
                       : C.borderFaint,
          }}>
            <Text style={{
              color: myRole === 'host'  ? C.gold
                   : myRole === 'admin' ? accentColor
                   : C.sub,
              fontSize: 12, fontWeight: '800',
            }}>
              {myRole === 'host'
                ? t('voiceRoom.screen.roleOwner')
                : myRole === 'admin'
                  ? t('voiceRoom.screen.roleAdmin')
                  : t('voiceRoom.screen.roleMember')}
            </Text>
          </View>
        )}

        {/* ── Voice connection error banner ──
            Previously `voiceError` (token fetch failure, LiveKit connect
            failure, mic denial, unexpected disconnect) was destructured but
            never rendered — the user sat in the room with no audio and no
            explanation. The banner surfaces the engine's message with a
            Retry action (hook's retryConnection: leave + re-join). */}
        {voiceError && (
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 10,
            backgroundColor: 'rgba(239,68,68,0.12)',
            borderWidth: 1, borderColor: 'rgba(239,68,68,0.45)',
            borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10,
            marginBottom: 10,
          }}>
            <Feather name="alert-triangle" size={18} color={C.red} />
            <Text style={{ flex: 1, color: C.text, fontSize: 12, fontWeight: '600' }}>
              {voiceError}
            </Text>
            <ScalePress onPress={retryConnection}>
              <View style={{
                backgroundColor: C.red, borderRadius: 999,
                paddingHorizontal: 14, paddingVertical: 7,
              }}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>
                  {t('voiceRoom.screen.retry')}
                </Text>
              </View>
            </ScalePress>
          </View>
        )}

        {/* ── Seat grid — clean 5-column professional layout ── */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
          {seats.map((member: Participant | null, idx: number) => (
            /* Track 3: wrapper measured on demand (measureInWindow) so gift fly
               animations can target this seat's screen center. collapsable={false}
               keeps a real native view for measurement. */
            <View
              key={idx}
              collapsable={false}
              style={{ width: '20%', alignItems: 'center', paddingVertical: 6 }}
              ref={(v) => {
                const id = member?.id;
                if (!id) return;
                if (v) seatViewRefs.current[id] = v;
                else delete seatViewRefs.current[id];
              }}
            >
              <SeatCard
                seatIndex={idx}
                member={member}
                isLocked={lockedSeats.has(idx)}
                accentColor={accentColor}
                myId={myUid}
                onPress={() => handleSeatPress(idx)}
                reaction={member ? seatReactions[member.id] : undefined}
              />
            </View>
          ))}
        </View>

        {/* ── Room members (imo style: owner → admins → members, total count) ── */}
        <ScalePress onPress={() => setMembersOpen(true)}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            backgroundColor: C.card, borderRadius: 12, padding: 10,
            borderWidth: 1, borderColor: C.borderFaint, marginBottom: 10,
          }}>
            <Feather name="users" size={15} color={C.sub} />
            <Text style={{ color: C.sub, fontSize: 13, fontWeight: '700' }}>
              {t('voiceRoom.screen.members', { count: allMembers.length })}
            </Text>
            <Feather name="chevron-right" size={14} color={C.muted} style={{ marginLeft: 'auto' }} />
          </View>
        </ScalePress>

        {/* ── Room Chat ── */}
        <View style={{
          flex: 1, borderRadius: 16,
          backgroundColor: themeSurface + '55',
          borderWidth: 1, borderColor: accentColor + '22',
          overflow: 'hidden',
        }}>
          {/* Fix 11: Chat pagination — "Load earlier" button at the top */}
          <FlatList<ChatMsg>
            ref={chatRef}
            data={messages}
            keyExtractor={(item: ChatMsg) => item.id}
            renderItem={renderChatMessage}
            contentContainerStyle={{ padding: 8 }}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={hasOlderMsgs ? (
              <Pressable
                onPress={handleLoadOlderMessages}
                disabled={loadingOlderMsgs}
                style={{ alignItems: 'center', paddingVertical: 8 }}
              >
                {loadingOlderMsgs
                  ? <ActivityIndicator size="small" color={accentColor} />
                  : <Text style={{ color: accentColor, fontSize: 12, fontWeight: '700' }}>
                      {t('voiceRoom.screen.loadEarlier')}
                    </Text>
                }
              </Pressable>
            ) : null}
            onContentSizeChange={() => chatRef.current?.scrollToEnd({ animated: true })}
            initialNumToRender={20}
            maxToRenderPerBatch={10}
          />
        </View>

        {/* ── @ Mention picker ── */}
        {mentionQuery !== null && mentionCandidates.length > 0 && (
          <View style={{
            maxHeight: 180,
            backgroundColor: '#0F0A1E',
            borderRadius: 14,
            borderWidth: 1, borderColor: accentColor + '55',
            marginTop: 6, overflow: 'hidden',
            shadowColor: accentColor, shadowOpacity: 0.25,
            shadowRadius: 12, shadowOffset: { width: 0, height: -2 },
            elevation: 8,
          }}>
            {mentionCandidates.slice(0, 6).map((m: Participant) => (
              <Pressable
                key={m.id}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  handleSelectMention(m.name);
                }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  paddingHorizontal: 14, paddingVertical: 10,
                  borderBottomWidth: 1, borderBottomColor: accentColor + '1A',
                }}
              >
                <View style={{
                  width: 32, height: 32, borderRadius: 16,
                  backgroundColor: m.color + '33',
                  borderWidth: 1.5, borderColor: m.color + '66',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ color: m.color, fontSize: 11, fontWeight: '800' }}>{m.initials}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>
                    <Text style={{ color: accentColor, fontWeight: '900' }}>@</Text>{m.name}
                  </Text>
                  <Text style={{ color: C.muted, fontSize: 10, marginTop: 1 }}>
                    {m.role === 'host' ? t('voiceRoom.screen.mentionOwner') : m.role === 'admin' ? t('voiceRoom.screen.mentionAdmin') : t('voiceRoom.screen.mentionMember')}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {/* ── Reply preview ── */}
        {replyingTo && (
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: 'rgba(255,255,255,0.07)',
            borderRadius: 10, padding: 8, marginTop: 6,
            borderLeftWidth: 3, borderLeftColor: accentColor,
          }}>
            <Text numberOfLines={1} style={{ flex: 1, color: C.sub, fontSize: 12 }}>
              ↩ {replyingTo.sender}: {replyingTo.text}
            </Text>
            <Pressable onPress={() => setReplyingTo(null)}>
              <Feather name="x" size={14} color={C.muted} />
            </Pressable>
          </View>
        )}

        {/* ── Chat input ── */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          marginTop: 8, marginBottom: 6,
        }}>
          <ScalePress onPress={() => setEmojiPanelOpen(true)}>
            <Feather name="smile" size={22} color={C.sub} />
          </ScalePress>

          {/* @ Mention shortcut — opens picker for all live members */}
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setChatInput((prev: string) => prev + '@');
              setMentionQuery('');
            }}
            style={{
              width: 32, height: 32, borderRadius: 16,
              backgroundColor: accentColor + '22',
              borderWidth: 1, borderColor: accentColor + '44',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ color: accentColor, fontSize: 14, fontWeight: '900' }}>@</Text>
          </Pressable>

          <TextInput
            style={{
              flex: 1, color: C.text, fontSize: 14,
              backgroundColor: C.card, borderRadius: 20,
              paddingHorizontal: 14, paddingVertical: 8,
              borderWidth: 1, borderColor: C.borderFaint,
            }}
            value={chatInput}
            onChangeText={handleChatInput}
            placeholder={t('voiceRoom.screen.messagePlaceholder')}
            placeholderTextColor={C.muted}
            onSubmitEditing={sendMessage}
            blurOnSubmit={false}
            returnKeyType="send"
          />

          <Pressable
            onPress={sendMessage}
            disabled={sendingMsg}
            style={{
              width: 38, height: 38, borderRadius: 19,
              backgroundColor: chatInput.trim() ? accentColor : C.muted,
              alignItems: 'center', justifyContent: 'center',
              opacity: sendingMsg ? 0.5 : 1,
            }}
          >
            <Feather name="send" size={15} color={C.text} />
          </Pressable>
        </View>
      </View>

      {/* ═══ EMOJI PANEL ═══ */}
      <EmojiPanel
        visible={emojiPanelOpen}
        onSelect={sendEmojiReaction}
        onClose={() => setEmojiPanelOpen(false)}
        bottomOffset={BOTTOM_BAR_H + 8}
      />

      {/* ═══ BOTTOM BAR ═══ */}
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
        paddingBottom: bottomPad, paddingTop: 14, paddingHorizontal: 10,
        backgroundColor: themeBg, borderTopWidth: 1, borderTopColor: accentColor + '33',
      }}>
        {/* CRITICAL-3: Mic bar — "Join Seat" for audience, Mute/Unmute for speakers */}
        <ScalePress onPress={handleMicBarPress}>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <View style={{
              width: 42, height: 42, borderRadius: 21,
              backgroundColor: mySeatIdx < 0 ? accentColor + '22'
                : muted ? 'rgba(239,68,68,0.16)' : 'rgba(34,197,94,0.16)',
              borderWidth: 1.5,
              borderColor: mySeatIdx < 0 ? accentColor + '66'
                : muted ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.4)',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Feather
                name={mySeatIdx < 0 ? 'user-plus' : muted ? 'mic-off' : 'mic'}
                size={20}
                color={mySeatIdx < 0 ? accentColor : muted ? C.red : C.mic}
              />
            </View>
            <Text style={{
              color: mySeatIdx < 0 ? accentColor : muted ? C.red : C.mic,
              fontSize: 10, fontWeight: '700',
            }}>
              {mySeatIdx < 0
                ? t('voiceRoom.screen.joinSeat')
                : t('voiceRoom.screen.mic')}
            </Text>
          </View>
        </ScalePress>

        {/* Speaker */}
        <ScalePress onPress={toggleSpeaker}>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Feather name={speakerOn ? 'volume-2' : 'volume-x'} size={24} color={speakerOn ? C.text : C.sub} />
            <Text style={{ color: speakerOn ? C.text : C.sub, fontSize: 10, fontWeight: '700' }}>
              {t('voiceRoom.screen.speaker')}
            </Text>
          </View>
        </ScalePress>

        {/* Gifts */}
        <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setGiftsOpen(true); }}>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.pink,
              alignItems: 'center', justifyContent: 'center',
              shadowColor: C.pink, shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
            }}>
              <Text style={{ fontSize: 22 }}>🎁</Text>
            </View>
            <Text style={{ color: C.text, fontSize: 10, fontWeight: '700' }}>
              {t('voiceRoom.screen.gift')}
            </Text>
          </View>
        </ScalePress>

        {/* Invite */}
        <ScalePress onPress={() => setInviteOpen(true)}>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Feather name="user-plus" size={24} color={C.text} />
            <Text style={{ color: C.text, fontSize: 10, fontWeight: '700' }}>
              {t('voiceRoom.screen.invite')}
            </Text>
          </View>
        </ScalePress>

        {/* Exit Room */}
        <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setExitModalOpen(true); }}>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <View style={{
              width: 42, height: 42, borderRadius: 21,
              backgroundColor: 'rgba(239,68,68,0.15)',
              borderWidth: 1.5, borderColor: 'rgba(239,68,68,0.4)',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Feather name="log-out" size={18} color="#EF4444" />
            </View>
            <Text style={{ color: '#EF4444', fontSize: 10, fontWeight: '700' }}>
              {t('voiceRoom.screen.exit')}
            </Text>
          </View>
        </ScalePress>
      </View>

      {/* ═══ MODALS ═══ */}
      {/* Fix 3/8/9: Cloudinary upload happens inside RoomInfoModal; we persist the URL here */}
      <RoomInfoModal
        visible={roomInfoOpen}
        onClose={() => setRoomInfoOpen(false)}
        allMembers={allMembers}
        weeklyEarned={weeklyEarned}
        description={roomDescription}
        roomTopic={roomTopic}
        accent={accentColor}
        roomName={roomName}
        onChangeRoomName={(newName) => {
          setRoomName(newName);
          updateRoomSettings(roomId, { name: newName }).catch(() => {
            Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.screen.settingsSaveError'));
          });
        }}
        roomImageUri={roomImageUri}
        onChangeRoomImage={(cloudUrl) => {
          setRoomImageUri(cloudUrl);
          updateRoomSettings(roomId, { coverImageUrl: cloudUrl }).catch(() => {
            Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.screen.settingsSaveError'));
          });
        }}
        roomId={roomId}
        isOwner={myRole === 'host'}
        isAdmin={myRole === 'admin'}
        ownerId={ownerId}
        onDisband={handleDisband}
        onLeave={() => { setRoomInfoOpen(false); setExitModalOpen(true); }}
      />
      <OperationHistoryModal
        visible={opHistOpen}
        onClose={() => setOpHistOpen(false)}
        records={blockedRecs}
        onUnblock={unblockUser}
        accent={accentColor}
      />
      <SettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        isOwnerOrAdmin={isOwnerOrAdmin}
        topic={roomTopic}
        setTopic={(newTopic) => {
          setRoomTopic(newTopic);
          updateRoomSettings(roomId, { topic: newTopic }).catch(() => {
            Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.screen.settingsSaveError'));
          });
        }}
        activeThemeId={activeThemeId}
        onThemeChange={(newThemeId) => {
          // Optimistic local update + Firebase sync so ALL users see the change.
          activeThemeIdRef.current = newThemeId;
          setActiveThemeId(newThemeId);
          updateRoomSettings(roomId, { themeId: newThemeId }).catch(() => {
            Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.screen.settingsSaveError'));
          });
        }}
        onOpenHistory={() => { setSettingsOpen(false); setOpHistOpen(true); }}
        accent={accentColor}
        roomIsPublic={roomIsPublic}
        roomIsLocked={roomIsLocked}
        onSaveSettings={(newIsPublic, newIsLocked) => {
          setRoomIsPublic(newIsPublic);
          setRoomIsLocked(newIsLocked);
          updateRoomSettings(roomId, { isPublic: newIsPublic, isLocked: newIsLocked }).catch(() => {
            Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.screen.settingsSaveError'));
          });
        }}
        roomId={roomId}
      />
      <SeatActionSheet
        visible={seatActionOpen}
        seatIdx={seatActionIdx}
        member={seatActionMember ?? undefined}
        myRole={myRole}
        myId={myUid}
        locked={seatActionIdx >= 0 && lockedSeats.has(seatActionIdx)}
        audience={audience}
        onClose={() => setSeatActionOpen(false)}
        onDown={() => { downFromSeat(seatActionIdx); setSeatActionOpen(false); }}
        onJoin={() => { joinSeat(seatActionIdx); setSeatActionOpen(false); }}
        onMute={() => { if (seatActionMember) muteToggleMember(seatActionMember.id); setSeatActionOpen(false); }}
        onSetAdmin={() => { if (seatActionMember) setAdminRole(seatActionMember.id); setSeatActionOpen(false); }}
        onDismissAdmin={() => { if (seatActionMember) dismissAdmin(seatActionMember.id); setSeatActionOpen(false); }}
        onMention={() => { if (seatActionMember) { handleMention(seatActionMember.name); setSeatActionOpen(false); } }}
        onBlock={() => { if (seatActionMember) { blockUser(seatActionMember.id, 'room-block'); setSeatActionOpen(false); } }}
        onLock={() => { lockSeat(seatActionIdx); setSeatActionOpen(false); }}
        onUnlock={() => { unlockSeat(seatActionIdx); setSeatActionOpen(false); }}
        onInvite={() => { setInvToSeatIdx(seatActionIdx); setSeatActionOpen(false); setInvToSeatOpen(true); }}
        accent={accentColor}
      />
      <InviteToSeatModal
        visible={invToSeatOpen}
        audience={audience}
        seatIdx={invToSeatIdx}
        onClose={() => setInvToSeatOpen(false)}
        onInvite={(memberId) => { inviteToSeat(memberId, invToSeatIdx); setInvToSeatOpen(false); }}
        accent={accentColor}
      />
      <InviteModal
        visible={inviteOpen}
        onClose={() => setInviteOpen(false)}
        roomId={roomId}
        roomName={roomName}
      />
      {/* ── Track 3: gift showpiece overlays (absolute, pointerEvents=none) ──
          Above the seat grid/chat, below the modals. */}
      <GiftFlyAnimation ref={giftFlyRef} />
      {roomId ? <GiftReceiveBanners roomId={roomId} /> : null}
      {/* ── Entry effect: "X is Coming" banner (2026-10-10) ── */}
      {entryBanner ? (
        <EntryBanner
          name={entryBanner.name}
          photoURL={entryBanner.photoURL}
          onDismiss={() => setEntryBanner(null)}
        />
      ) : null}
      <GiftsModal
        visible={giftsOpen}
        onClose={() => { setGiftsOpen(false); setGiftsRecipient(null); }}
        onGiftSent={handleGiftSent}
        members={allMembers}
        initialRecipient={giftsRecipient}
        walletBalance={walletBalance}
        myUid={myUid}
        myName={myName}
        roomId={roomId}
      />
      <AudienceModal
        visible={audienceOpen}
        onClose={() => setAudienceOpen(false)}
        audience={audience}
        myRole={myRole}
        onManageMember={(m) => { setAudienceOpen(false); setActiveMember(m); }}
      />
      <RoomMembersModal
        visible={membersOpen}
        onClose={() => setMembersOpen(false)}
        ownerId={ownerId}
        seats={seats}
        audience={audience}
        onManageMember={(m) => { setMembersOpen(false); setActiveMember(m); }}
      />
      <MemberManageModal
        member={activeMember}
        myRole={myRole}
        myId={myUid}
        onClose={() => setActiveMember(null)}
        onGift={() => { setGiftsRecipient(activeMember); setActiveMember(null); setGiftsOpen(true); }}
        onMention={handleMention}
        onBlock={(action) => { if (activeMember) blockUser(activeMember.id, action); setActiveMember(null); }}
        onReport={(memberId, memberName) => {
          submitReport({
            reporterUid: myUid,
            reporterName: myName,
            reportedUid: memberId,
            reportedName: memberName,
            reason: 'inappropriate',
            roomId,
          }).catch(() => {
            Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.memberManage.reportError'));
          });
          setActiveMember(null);
        }}
        onSetAdmin={() => { if (activeMember) setAdminRole(activeMember.id); setActiveMember(null); }}
        onDismissAdmin={() => { if (activeMember) dismissAdmin(activeMember.id); setActiveMember(null); }}
        onViewProfile={handleViewOwnProfile}
        onViewOtherProfile={handleViewOtherProfile}
        onEditProfile={handleEditOwnProfile}
        // Issue 2: Down Mic / Leave Seat (self view — replaces Copy V ID)
        isSeated={activeMember ? seats.some((s) => s?.id === activeMember.id) : false}
        onDown={() => { if (mySeatIdx >= 0) downFromSeat(mySeatIdx); setActiveMember(null); }}
        // Issue 4: Owner/Admin — move another member down from their seat
        onDownFromSeat={() => {
          if (activeMember) {
            const targetIdx = seats.findIndex((s) => s?.id === activeMember.id);
            if (targetIdx >= 0) downFromSeat(targetIdx);
          }
          setActiveMember(null);
        }}
      />
      <ExitModal
        visible={exitModalOpen}
        onClose={() => setExitModalOpen(false)}
        onLeave={handleLeave}
        onMinimize={handleMinimize}
        roomName={roomName}
      />
    </View>
  );
}
