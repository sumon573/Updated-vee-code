import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View, Text, FlatList, Alert, Pressable,
  Animated, Platform, TextInput, ActivityIndicator, Image,
  BackHandler, Modal, KeyboardAvoidingView,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ref, get, onValue, update } from 'firebase/database';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import ScalePress from '@/components/ScalePress';
import { database } from '@/src/config/firebase';
import { setMinimizedRoom, getMinimizedRoom } from '@/src/store/minimizedRoom';
import { useLivekitVoiceRoom, setVoiceRoomMinimized, destroyPersistedVoiceRoomEngine } from '../useLivekitVoiceRoom';
import { useAuth } from '@/src/context/AuthContext';
import { getUser, subscribeUser } from '@/src/services/userService';
import { subscribeWalletBalance } from '@/src/features/wallet/walletService';
import { submitReport } from '@/src/services/reportService';

import { getErrorCause } from '@/src/utils/errorDisplay';
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
  grantRoomAdmin, revokeRoomAdmin,
  closeRoom, updateRoomSettings, getUserColor, getInitials,
  disbandRoom,
  // Seat Request System (Firebase-persisted)
  sendSeatRequest, subscribeSeatRequests, approveSeatRequest, rejectSeatRequest,
  type SeatRequest,
  // Block System (Firebase-persisted)
  blockUserInRoom, unblockUserInRoom, subscribeRoomBlocks, isUserBlockedInRoom,
  type RoomBlockRecord,
  type RoomSeat, type RoomAudienceMember,
  verifyRoomPin,
  // Fix 1: Seat invite system
  sendSeatInvite, subscribeSeatInvites, removeSeatInvite, type SeatInvite,
  // Fix 5: Emoji reaction broadcast
  sendRoomEmojiReaction, subscribeRoomEmojiReactions,
  // P1 ghost-seat fix (2026-10-12): heartbeat + stale sweep
  refreshSeatHeartbeat, sweepStaleSeats,
  // P0 security (2026-10-12): shared PIN session cache (2026-10-13: moved to
  // the service so VoiceRoomHome's PIN dialog and this screen share it —
  // previously a verified PIN at the list level was re-prompted in-screen).
  isPinVerifiedForSession as isPinVerified,
  setPinVerifiedForSession as setPinVerified,
  // Entry broadcast (2026-10-10): all users see everyone's entry
  sendRoomEntryEvent, subscribeRoomEntryEvents,
  // Gift animation broadcast (2026-10-10): all users see gift fly animations
  sendRoomGiftEvent, subscribeRoomGiftEvents,
} from '../services/firebaseRoomService';
import {
  subscribeRoomChat, sendRoomChatMsg, loadOlderMessages,
  type RoomChatMsg,
} from '../services/firebaseRoomChatService';

/* ═══════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════ */

// P0 security (2026-10-12): PIN session cache এখন firebaseRoomService-এ
// শেয়ার্ড (isPinVerifiedForSession / setPinVerifiedForSession) — VoiceRoomHome-এর
// PIN dialog আর এই স্ক্রিন একই ক্যাশ দেখে, double PIN prompt হয় না।
// 2026-10-12 (Sumon): versioned — PIN বদলালে (pinVersion bump) পুরনো সেশন
// অকার্যকর; 2026-10-12 review fix: uid দিয়ে key — logout/login-এ আগের
// ইউজারের verification inherit হয় না।

// P1 anti-spam (2026-10-12): per-room last-send timestamps for the 1.5s
// chat throttle. Module-level so rapid re-renders can't reset it.
const lastChatSendAt = new Map<string, number>();

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
    // 2026-10-13 (Sumon): active frame for audience list display
    activeFrame: (m as any).activeFrame || undefined,
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
  const [myProfile, setMyProfile] = useState<{ name: string; photoURL?: string; activeFrame?: string } | null>(null);
  // 2026-10-13 (Sumon): Verified badge status for voice room seats
  const [myVerified, setMyVerified] = useState(false);
  useEffect(() => {
    if (!myUid || myUid === 'anonymous') return;
    // 2026-10-13 (Sumon): Real-time subscription so DP/frame changes reflect immediately.
    // Fixes Google-login DP sync issue (profile vs voice room showing different pictures).
    const unsub = subscribeUser(myUid, (p) => {
      if (p) setMyProfile({ name: p.name, photoURL: p.photoURL || undefined, activeFrame: (p as any).activeFrame || undefined });
    });
    // Check verified badge
    import('@/src/services/verifiedService').then(({ hasOfficialBadge }) => {
      hasOfficialBadge(myUid).then(setMyVerified).catch(() => {});
    }).catch(() => {});
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2026-10-13 (Sumon): When activeFrame loads/changes and user is seated,
  // update the seat data so the frame shows in voice room.
  // Fixes race condition where seat was taken before profile loaded.
  useEffect(() => {
    const frame = (myProfile as any)?.activeFrame;
    const seatIdx = mySeatIdxRef.current;
    if (!roomId || seatIdx < 0 || !myUid) return;
    if (frame) {
      // 2026-10-14 (Sumon): Log failures — silent catch hid seat sync issues
      update(ref(database, `rooms/${roomId}/seats/${seatIdx}`), { activeFrame: frame })
        .then(() => console.log(`[VoiceRoom] ✅ Seat ${seatIdx} frame synced: ${frame}`))
        .catch((e) => console.log(`[VoiceRoom] ❌ Seat frame sync FAILED:`, e?.message || e));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(myProfile as any)?.activeFrame]);

  // 2026-10-14 (Sumon): Periodic seat frame sync — frame grant হলে seat update
  // না হলে অন্যরা frame দেখতে পায় না। প্রতি 30s-এ sync করো।
  useEffect(() => {
    if (!roomId || !myUid || myUid === 'anonymous') return;
    const syncFrame = () => {
      const frame = (myProfile as any)?.activeFrame;
      const seatIdx = mySeatIdxRef.current;
      if (!frame || seatIdx < 0) return;
      // 2026-10-14 (Sumon): Log failures — silent catch hid seat sync issues
      update(ref(database, `rooms/${roomId}/seats/${seatIdx}`), { activeFrame: frame })
        .then(() => console.log(`[VoiceRoom] ✅ Periodic seat ${seatIdx} frame sync: ${frame}`))
        .catch((e) => console.log(`[VoiceRoom] ❌ Periodic seat frame sync FAILED:`, e?.message || e));
    };
    // Initial sync after 5s (profile loaded by then)
    const initial = setTimeout(syncFrame, 5000);
    // Periodic sync every 30s
    const interval = setInterval(syncFrame, 30000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, myUid]);

  const myName = myProfile?.name || user?.displayName || t('voiceRoom.screen.defaultUserName');
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

  /* ── AUTO-LEAVE PREVIOUS ROOM (2026-10-11 Issue #2): If the user minimized
     a DIFFERENT room and now opens this one, leave the old room completely —
     disconnect its LiveKit engine, remove Firebase seat/audience entries, and
     clear the mini-player. The user is only ever in ONE room at a time.
     ── FIX (2026-10-11): If the user opens the SAME room that was minimized
     (e.g. via room list instead of Return button), clear the minimized state
     so the Return bar disappears — they're back in the room now. ── */
  // 2026-10-14 (Sumon): Voice room-এ ফিরলেই minimize bar গায়েব।
  // useEffect শুধু roomId change-এ চলে — profile দেখে back করলে roomId same থাকে,
  // তাই bar থেকে যেত। useFocusEffect দিয়ে প্রতিবার focus-এ clear করি।
  useFocusEffect(
    useCallback(() => {
      const prev = getMinimizedRoom();
      if (prev && prev.id === roomId) {
        setMinimizedRoom(null);
      }
    }, [roomId])
  );

  useEffect(() => {
    if (!roomId || !myUid || myUid === 'anonymous') return;
    const prev = getMinimizedRoom();
    if (!prev) return;
    if (prev.id === roomId) {
      // Same room re-opened directly (not via Return) — clear minimized state
      // so the Return bar disappears. The LiveKit engine persists.
      setMinimizedRoom(null);
      return;
    }
    // Different room — tear down the old one.
    try {
      destroyPersistedVoiceRoomEngine();
    } catch { /* non-critical */ }
    if (prev.mySeatIdx >= 0) {
      // 2026-10-12: revoke admin powers too if the user was an admin —
      // otherwise the admins-node entry goes stale with live powers.
      const demoteUid = prev.role === 'admin' ? (prev.myUid || myUid) : undefined;
      removeSeat(prev.id, prev.mySeatIdx, demoteUid).catch(() => {});
      // 2026-10-12 audit fix (HIGH): clean audience record on room switch —
      // seated users keep it, leaving a ghost in the old room.
      leaveAudience(prev.id, prev.myUid || myUid).catch(() => {});
    } else {
      leaveAudience(prev.id, prev.myUid || myUid).catch(() => {});
      if (prev.role === 'admin') {
        revokeRoomAdmin(prev.id, prev.myUid || myUid).catch(() => {});
      }
    }
    setMinimizedRoom(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

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

  // 2026-10-12 review fix: if the room info arrived before myUid loaded,
  // the PIN gate skipped evaluation — re-evaluate now that auth is ready.
  useEffect(() => {
    if (!myUid || myUid === 'anonymous') return;
    if (pinEvaluatedForRef.current === roomId) return;
    const info = pinInfoRef.current;
    if (!info) return;
    pinEvaluatedForRef.current = roomId;
    const pinVersion = typeof info.pinVersion === 'number' ? info.pinVersion : 0;
    const needsPin =
      info.isPublic !== true &&
      info.ownerId !== myUid &&
      !isPinVerified(myUid, roomId, pinVersion);
    const nextGate = needsPin ? 'open' : 'passed';
    pinGateRef.current = nextGate;
    setPinGate(nextGate);
    if (nextGate === 'passed') handleRoomInfoOk();
  }, [myUid, roomId, handleRoomInfoOk]);

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
  /**
   * Instant comment-block state for the current user (2026-10-12).
   * Derived from the live roomBlocks subscription — the moment an admin/owner
   * comment-blocks (or room-blocks) me, the chat input shows
   * "Your Comment blocked" and disables sending; unblocking restores it
   * instantly. No polling, no waiting for a failed send.
   */
  const amChatBlocked = useMemo(
    () => blockedRecs.some(
      (r) => r.id === myUid && r.isActive &&
        (r.action === 'comment-block' || r.action === 'room-block'),
    ),
    [blockedRecs, myUid],
  );
  // Entry effect: "X is Coming" banner (2026-10-10)
  const [entryBanner, setEntryBanner] = useState<{ name: string; photoURL?: string | null; fancy?: boolean } | null>(null);
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
  // 2026-10-14 (Sumon): scroll-to-bottom floating button — উপরে গেলে দেখাবে।
  const [showChatScrollBtn, setShowChatScrollBtn] = useState(false);

  // Ref to keep speakingUsers accessible in callbacks without re-creating them
  const speakingRef = useRef<Record<string, boolean>>({});
  useEffect(() => { speakingRef.current = speakingUsers; }, [speakingUsers]);

  // Fix 5: Ref for seats used inside emoji reaction subscription callback
  const seatsRef = useRef<Array<Participant | null>>(Array(10).fill(null));
  useEffect(() => { seatsRef.current = seats; }, [seats]);
  // 2026-10-12: Ref for audience used inside the room-info self-heal
  // (admin registry repair needs the latest audience roles).
  const audienceRef = useRef<Participant[]>([]);
  useEffect(() => { audienceRef.current = audience; }, [audience]);

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
  // 2026-10-13: ১০ মিনিটের পুরনো invite প্রথম snapshot-এ প্রুন করো — পুরনো
  // invite রুমে ঢুকলেই বারবার Alert দেখাত (Android-এ back দিয়ে dismiss
  // করলে invite থেকে যেত)।
  const invitesPrunedRef = useRef(false);
  useEffect(() => {
    if (!myUid || myUid === 'anonymous' || !roomId) return;
    return subscribeSeatInvites(myUid, roomId, (invites) => {
      if (!invitesPrunedRef.current) {
        invitesPrunedRef.current = true;
        const now = Date.now();
        const fresh = invites.filter((inv) => now - (inv.ts || 0) <= 10 * 60 * 1000);
        for (const inv of invites) {
          if (!fresh.includes(inv)) {
            removeSeatInvite(myUid, inv.id).catch(() => {});
          }
        }
        setPendingSeatInvites(fresh);
      } else {
        setPendingSeatInvites(invites);
      }
    });
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
                // 2026-10-13 (Sumon): Check verified badge for seat display
                let isVerified = false;
                try {
                  const { hasOfficialBadge } = await import('@/src/services/verifiedService');
                  isVerified = await hasOfficialBadge(myUid);
                } catch { /* non-critical */ }
                result = await takeSeat(roomId, invite.seatIdx, {
                  userId: myUid, userName: myName,
                  initials: myInitials, color: myColor,
                  muted: true, role: 'member',
                  ...(myPhotoURL ? { photoURL: myPhotoURL } : {}),
                  ...((myProfile as any)?.activeFrame ? { activeFrame: (myProfile as any).activeFrame } : {}),
                  ...(isVerified ? { verified: true } : {}),
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
      // Animate the emoji ONLY over the sender's seat (not everyone's)
      const senderMember = seatsRef.current.find((m) => m && m.id === reaction.byUid);
      if (!senderMember) return;
      const translateY = new Animated.Value(0);
      const opacity = new Animated.Value(1);
      const newReactions: Record<string, SeatReaction> = {
        [senderMember.id]: { emoji: reaction.emoji, translateY, opacity },
      };
      Animated.parallel([
        Animated.timing(translateY, { toValue: -55, duration: 1600, useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(800),
          Animated.timing(opacity, { toValue: 0, duration: 800, useNativeDriver: true }),
        ]),
      ]).start(() => {
        setSeatReactions((prev: Record<string, SeatReaction>) => {
          const n = { ...prev }; delete n[senderMember.id]; return n;
        });
      });
      setSeatReactions((prev: Record<string, SeatReaction>) => ({ ...prev, ...newReactions }));
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

  // 2026-10-13: প্রোফাইল লোড/বদলালে নিজের সিট/অডিয়েন্স রেকর্ডে নাম+ছবি সিঙ্ক
  // করো। আগে প্রোফাইল লোডের আগেই audience join হয়ে গেলে খালি/পুরনো নাম
  // আটকে থাকত (Google user-দের ক্ষেত্রে সবচেয়ে বেশি)। শুধু নিজের রেকর্ড
  // লিখি, আর node না থাকলে তৈরি করি না (get-then-update)।
  useEffect(() => {
    if (!myProfile?.name || !roomId || !myUid || myUid === 'anonymous') return;
    let cancelled = false;
    (async () => {
      const patch: Record<string, unknown> = {
        userName: myProfile.name,
        initials: getInitials(myProfile.name),
        ...(myProfile.photoURL ? { photoURL: myProfile.photoURL } : {}),
      };
      try {
        const idx = mySeatIdxRef.current;
        if (idx >= 0) {
          const seatSnap = await get(ref(database, `rooms/${roomId}/seats/${idx}`));
          const seatUser = (seatSnap.val() as { userId?: string } | null)?.userId;
          if (!cancelled && seatSnap.exists() && seatUser === myUid) {
            await update(ref(database, `rooms/${roomId}/seats/${idx}`), patch);
          }
        } else if (hasJoined) {
          const audSnap = await get(ref(database, `rooms/${roomId}/audience/${myUid}`));
          if (!cancelled && audSnap.exists()) {
            await update(ref(database, `rooms/${roomId}/audience/${myUid}`), patch);
          }
        }
      } catch { /* background: safe to swallow — profile sync */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myProfile, roomId, hasJoined]);

  // ── P0 security (2026-10-12): in-screen private-room PIN gate ──
  // Direct deep-links (invite links, push-notification taps, profile room
  // taps) navigate straight to /voice-room, bypassing the list-level
  // PrivateRoomGate. Enforce the 4-digit PIN inside this screen BEFORE any
  // audience join, chat presence, or voice init can run.
  // Session cache: rooms verified once per app session don't re-prompt
  // (covers minimize → return without weakening the gate).
  const [pinGate, setPinGate] = useState<'checking' | 'open' | 'passed'>('checking');
  const pinGateRef = useRef<'checking' | 'open' | 'passed'>('checking');
  const pinEvaluatedForRef = useRef<string | null>(null);
  // Latest room info for PIN-gate re-evaluation when myUid loads late.
  const pinInfoRef = useRef<{ isPublic?: boolean; ownerId?: string; pinVersion?: number } | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinVerifying, setPinVerifying] = useState(false);
  const pinSubmittingRef = useRef(false); // double-tap submit guard

  /**
   * P0 security (2026-10-12): verify the in-screen PIN gate.
   * Double-tap guarded; network/transport failures surface their real cause
   * (never misreported as "Incorrect PIN").
   */
  const submitPinGate = useCallback(async () => {
    if (pinSubmittingRef.current || pinVerifying) return;
    if (pinInput.length !== 4 || !/^\d{4}$/.test(pinInput)) {
      setPinError(t('voiceRoom.screen.pinInvalid'));
      return;
    }
    pinSubmittingRef.current = true;
    setPinVerifying(true);
    try {
      const Crypto = await import('expo-crypto');
      const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pinInput);
      const ok = await verifyRoomPin(roomId, hashed);
      if (ok) {
        // Cache the CURRENT pin version — a later PIN change bumps the
        // version and forces re-entry (Sumon 2026-10-12).
        const curVer = typeof pinInfoRef.current?.pinVersion === 'number' ? pinInfoRef.current.pinVersion : 0;
        setPinVerified(myUidRef.current, roomId, curVer);
        pinGateRef.current = 'passed';
        setPinGate('passed');
        setPinInput('');
        setPinError('');
        // PIN passed after info already arrived — kick off voice init now.
        handleRoomInfoOk();
      } else {
        setPinError(t('voiceRoom.screen.pinIncorrect'));
      }
    } catch (e) {
      setPinError(t('voiceRoom.screen.pinVerifyFailed', { cause: getErrorCause(e) }));
    } finally {
      setPinVerifying(false);
      pinSubmittingRef.current = false;
    }
  }, [pinInput, pinVerifying, roomId, handleRoomInfoOk, t]);

  /** User cancelled the PIN gate — leave the room screen. */
  const cancelPinGate = useCallback(() => {
    router.back();
  }, [router]);

  // ENTRY EFFECT (2026-10-10): Show "X is Coming" banner when the local user
  // joins too, so they see the effect working (not just when others join).
  // ALSO broadcast the entry so ALL room participants see it.
  const hasShownSelfEntryRef = useRef(false);
  const hasSentEntryChatMsgRef = useRef(false);
  useEffect(() => {
    // Wait for myProfile to load (has real name + photoURL from RTDB)
    // before broadcasting — otherwise DP/name may be empty.
    if (hasJoined && !hasShownSelfEntryRef.current && myUid && myProfile) {
      hasShownSelfEntryRef.current = true;
      // Use myName/myPhotoURL (from RTDB profile) — not auth which may be empty
      const displayName = myName || 'User';
      // NOTE 10 (2026-10-11): Noble "Fancy Entry Effects" — computed from the
      // joiner's REAL noble state (Marquis+ with maintenance secured).
      (async () => {
        let fancyEntry = false;
        try {
          const { getNobleState } = await import('@/src/services/nobleService');
          const noble = await getNobleState(myUid);
          fancyEntry = !!noble && noble.rankIndex >= 4 && !noble.lapsed;
        } catch {
          // Noble read failed — fall back to the standard entry effect.
        }
        setEntryBanner({
          name: displayName,
          photoURL: myPhotoURL || null,
          fancy: fancyEntry,
        });
        // Broadcast entry to all participants
        sendRoomEntryEvent(roomId, {
          uid: myUid,
          name: displayName,
          photoURL: myPhotoURL || null,
          fancyEntry,
        }).catch(() => {/* non-critical */});
      })();
    }
  }, [hasJoined, myUid, myProfile, myName, myPhotoURL, roomId]);

  // ENTRY BROADCAST SUBSCRIPTION (2026-10-10): Show entry banner when ANY
  // participant joins — so everyone sees everyone's entry effect.
  const lastEntryTsRef = useRef(0);
  useEffect(() => {
    if (!roomId) return;
    return subscribeRoomEntryEvents(roomId, (entry) => {
      if (!entry) return;
      // Ignore stale entries
      if (entry.ts <= lastEntryTsRef.current) return;
      if (Date.now() - entry.ts > 10000) return; // 10s TTL
      lastEntryTsRef.current = entry.ts;
      // Don't show for our own entry (we already showed it locally)
      if (entry.uid === myUid) return;
      setEntryBanner({
        name: entry.name || 'User',
        photoURL: entry.photoURL || null,
        fancy: entry.fancyEntry === true,
      });
    });
  }, [roomId, myUid]);

  // GIFT BROADCAST SUBSCRIPTION (2026-10-10): Show gift fly animation when ANY
  // participant sends a gift — so everyone sees all gift animations.
  const lastGiftTsRef = useRef(0);
  useEffect(() => {
    if (!roomId) return;
    return subscribeRoomGiftEvents(roomId, (event) => {
      if (!event) return;
      if (event.ts <= lastGiftTsRef.current) return;
      if (Date.now() - event.ts > 10000) return; // 10s TTL
      lastGiftTsRef.current = event.ts;
      // Don't replay our own gifts (we already played them locally)
      if (event.fromUid === myUid) return;
      // Play the fly animation for the received gift
      giftFlyRef.current?.playFly({
        fromName: event.fromName,
        fromAvatar: event.fromAvatar || undefined,
        toUid: event.toUid,
        toName: event.toName,
        toAvatar: event.toAvatar || undefined,
        giftId: event.giftId,
        emoji: event.emoji,
        coins: event.coins,
        target: null, // remote gifts use top-center fallback
      });
    });
  }, [roomId, myUid]);

  // REJOIN FIX (2026-10-09): On mount, check if user is already in the
  // room's audience/seats (e.g. rejoining after leave). Without this,
  // hasJoined stays false and the Join button shows incorrectly.
  // REAL FIX (2026-10-10): also check the persistent userRooms/{uid}/{roomId}
  // membership index. Audience/seats are cleared on leave, so a member
  // returning later was never found there — the Join banner showed again
  // every time. userRooms is never cleared on leave: if it exists, this
  // user has joined before and enters directly as audience, no Join tap.
  useEffect(() => {
    // P0 security: no join-state resolution before the PIN gate passes.
    if (!roomId || !myUid || hasJoined || pinGate !== 'passed') return;
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
  }, [roomId, myUid, hasJoined, pinGate]);

  /* ── Chat ── */
  const [messages,   setMessages]   = useState<ChatMsg[]>([]);
  const chatRef = useRef<FlatList<ChatMsg>>(null);
  /** Holds the id of the last auto-scroll setTimeout so it can be cancelled on unmount. */
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Chat history auto-clean (2026-10-11): per-user, client-side.
   * 10 minutes after THIS user joins, and every 10 minutes after that,
   * keep only the last 5 messages locally (older ones are hidden, not deleted
   * from Firebase — other users are unaffected). Each user's timer starts
   * from their own join time.
   */
  const historyCutoffTsRef = useRef<number>(0);
  const historyCleanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
      // P0 security (2026-10-12): evaluate the in-screen PIN gate once per
      // room load. Private room + not owner + not verified this session →
      // block all joins/voice until the correct PIN is entered.
      // 2026-10-12 review fix: don't evaluate until myUid is loaded — an
      // empty myUid would wrongly gate the room owner. Stash info so a
      // late myUid can re-evaluate (see effect below).
      pinInfoRef.current = { isPublic: info.isPublic, ownerId: info.ownerId, pinVersion: typeof info.pinVersion === 'number' ? info.pinVersion : 0 };
      // 2026-10-12 (Sumon): if the owner changed the PIN mid-session
      // (pinVersion bumped past our verified version), force re-entry with
      // the NEW pin — the old PIN must stop working everywhere.
      const curPinVer = typeof info.pinVersion === 'number' ? info.pinVersion : 0;
      if (
        pinGateRef.current === 'passed' &&
        info.isPublic !== true &&
        info.ownerId !== myUidRef.current &&
        !isPinVerified(myUidRef.current, roomId, curPinVer)
      ) {
        pinGateRef.current = 'open';
        setPinGate('open');
        setPinInput('');
        setPinError('');
      }
      if (pinEvaluatedForRef.current !== roomId && myUidRef.current) {
        pinEvaluatedForRef.current = roomId;
        const pinVersion = typeof info.pinVersion === 'number' ? info.pinVersion : 0;
        const needsPin =
          info.isPublic !== true &&
          info.ownerId !== myUidRef.current &&
          !isPinVerified(myUidRef.current, roomId, pinVersion);
        const nextGate = needsPin ? 'open' : 'passed';
        pinGateRef.current = nextGate;
        setPinGate(nextGate);
      }
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
        // 2026-10-12: backfill + repair the rooms/$roomId/admins registry.
        // Any member labelled 'admin' (seat or audience) must hold the powers
        // the security rules check. Runs on every info update but only
        // writes for members missing from the registry (additive only —
        // removals go through dismiss/kick/leave so a stale label can never
        // resurrect powers here).
        try {
          const adminIds = new Set<string>();
          for (const s of seatsRef.current) {
            if (s && s.role === 'admin' && s.id !== myUidRef.current) adminIds.add(s.id);
          }
          for (const m of audienceRef.current) {
            if (m.role === 'admin' && m.id !== myUidRef.current) adminIds.add(m.id);
          }
          if (adminIds.size > 0) {
            get(ref(database, `rooms/${roomId}/admins`)).then((snap) => {
              const existing = new Set<string>(snap.exists() ? Object.keys(snap.val() ?? {}) : []);
              const missing = [...adminIds].filter((id) => !existing.has(id));
              if (missing.length === 0) return;
              const updates: Record<string, true> = {};
              for (const id of missing) updates[id] = true;
              update(ref(database, `rooms/${roomId}/admins`), updates).catch(() => {
                // background: safe to swallow — repaired on next info update
              });
            }).catch(() => {});
          }
        } catch {
          // background: safe to swallow — admin registry repair is best-effort
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
      // P0 security: never start voice before the PIN gate passes.
      if (pinGateRef.current === 'passed') handleRoomInfoOk();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // 2026-10-12 (Sumon): force-leave when *I* am room-blocked mid-session.
  // The join-time check only bounces blocked users at entry; without this a
  // user blocked while inside would linger in the room. Comment-blocks do
  // NOT trigger this (chat-only restriction — the input already shows it).
  const forceLeftRef = useRef(false);
  useEffect(() => {
    if (!hasJoined || forceLeftRef.current) return;
    const myBlock = blockedRecs.find(
      (r: BlockRecord) => r.id === myUid && r.isActive && r.action === 'room-block',
    );
    if (!myBlock) return;
    forceLeftRef.current = true;
    hasLeftRef.current = true;
    try { stopPublishing(); } catch { /* non-critical */ }
    try { stopUserStream(myUid); } catch { /* non-critical */ }
    // Navigate first (Android alert-before-nav can block the pop), then inform.
    router.back();
    Alert.alert(
      t('voiceRoom.screen.removedTitle'),
      t('voiceRoom.screen.removedMsg'),
    );
  }, [blockedRecs, hasJoined, myUid, stopPublishing, stopUserStream, t]);

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
      // NOTE (2026-10-10): Entry banner now handled by the entry broadcast
      // subscription above (sendRoomEntryEvent/subscribeRoomEntryEvents).
    });
  }, [roomId]);

  // Subscribe to room chat — Fix 11: track oldest key for pagination
  // 2026-10-11: history auto-clean — hide messages older than the cutoff.
  useEffect(() => {
    return subscribeRoomChat(roomId, myUid, (fbMsgs) => {
      const cutoff = historyCutoffTsRef.current;
      const visible = cutoff > 0 ? fbMsgs.filter(m => (m.ts ?? 0) >= cutoff) : fbMsgs;
      setMessages(visible.map(fbChatToMsg));
      if (visible.length > 0) {
        setChatOldestKey(visible[0].id);
        // If we got a full page (50), there might be older messages
        setHasOlderMsgs(visible.length >= 50);
      }
      // Clear any pending scroll timer before scheduling a new one
      if (scrollTimerRef.current !== null) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        scrollTimerRef.current = null;
        chatRef.current?.scrollToEnd({ animated: false });
      }, 80);
    });
  }, [roomId, myUid]);

  // Chat history auto-clean timer (2026-10-11): starts when THIS user joins.
  // Every 10 minutes, keep only the last 5 messages (local view only).
  useEffect(() => {
    if (!hasJoined) return;
    if (historyCleanTimerRef.current !== null) return; // already running
    const TEN_MIN = 10 * 60 * 1000;
    const clean = () => {
      setMessages((prev) => {
        if (prev.length <= 5) return prev;
        const keep = prev.slice(-5);
        // Hide everything older than the oldest kept message.
        historyCutoffTsRef.current = keep[0].ts ?? 0;
        return keep;
      });
    };
    historyCleanTimerRef.current = setInterval(clean, TEN_MIN);
    return () => {
      if (historyCleanTimerRef.current !== null) {
        clearInterval(historyCleanTimerRef.current);
        historyCleanTimerRef.current = null;
      }
    };
  }, [hasJoined]);

  /* ── Entry message on room ENTER (mount) ──
   * Per Sumon 2026-10-12: everyone's entry visible, even pure audience
   * who never taps Join. The hasJoined effect above handles the join case;
   * this handles the view-only entry case. Ref prevents duplicates. */
  useEffect(() => {
    if (hasSentEntryChatMsgRef.current) return;
    if (!roomId || !myUid || !myName) return;
    hasSentEntryChatMsgRef.current = true;
    // Per Sumon 2026-10-12: owner entry shows gold 👑 badge
    const isOwner = ownerId && ownerId === myUid;
    const displayName = isOwner ? `${myName} 👑` : myName;
    sendRoomChatMsg(roomId, {
      senderId: 'system',
      senderName: 'System',
      senderColor: C.gold,
      text: t('voiceRoom.screen.joinedRoom', { name: displayName }),
      ts: Date.now(),
    }).catch(() => {/* non-critical */});
  }, [roomId, myUid, myName, ownerId, t]);

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

  // P1 ghost-seat fix (2026-10-12): heartbeat while seated. Refreshes the
  // seat's server timestamp every 60s so crashed/killed clients' seats can
  // be swept. Also sweeps stale seats once on room enter.
  // 2026-10-13: heartbeat-এ userId পাঠাও — transaction abort করে যদি সিটটা
  // আর নিজের না হয় (phantom seat তৈরি বন্ধ)।
  useEffect(() => {
    sweepStaleSeats(roomId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);
  useEffect(() => {
    if (mySeatIdx < 0) return;
    const beat = () => refreshSeatHeartbeat(roomId, mySeatIdx, myUid).catch(() => {});
    beat(); // immediate first beat on seating
    const timer = setInterval(beat, 60_000);
    return () => clearInterval(timer);
  }, [roomId, mySeatIdx, myUid]);

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
    let cancelled = false;

    (async () => {
      // ROOM LOCK (2026-10-13, Sumon): "Lock Room" এখন সত্যিকারের গেট —
      // লক থাকলে নতুন দর্শক ঢুকতে পারবে না। শুধু owner/admin আর আগের
      // মেম্বাররা (userRooms/audience/seat রেকর্ড আছে) ফিরতে পারবে।
      try {
        // ব্লকড ইউজারের ক্ষেত্রে আলাদা blocked-check effect Alert দেখায় —
        // এখানে early return, নইলে double alert হতো।
        const blockSnap = await get(
          ref(database, `roomBlocks/${roomId}/${myUid}`),
        ).catch(() => null);
        if (blockSnap?.exists()) return;
        const infoSnap = await get(ref(database, `rooms/${roomId}/info`));
        const info = infoSnap.val() as { isLocked?: boolean; ownerId?: string } | null;
        if (info && info.isLocked === true && info.ownerId !== myUid) {
          const adminSnap = await get(
            ref(database, `rooms/${roomId}/admins/${myUid}`),
          ).catch(() => null);
          if (!adminSnap?.exists() && !cancelled) {
            const [memberSnap, audSnap, seatsSnap] = await Promise.all([
              get(ref(database, `userRooms/${myUid}/${roomId}`)).catch(() => null),
              get(ref(database, `rooms/${roomId}/audience/${myUid}`)).catch(() => null),
              get(ref(database, `rooms/${roomId}/seats`)).catch(() => null),
            ]);
            let returning = !!(memberSnap?.exists() || audSnap?.exists());
            if (!returning && seatsSnap?.exists()) {
              seatsSnap.forEach((child) => {
                const s = child.val() as { userId?: string } | null;
                if (s?.userId === myUid) returning = true;
              });
            }
            if (!returning) {
              Alert.alert(
                t('voiceRoom.screen.roomLockedTitle', { defaultValue: 'Room Locked' }),
                t('voiceRoom.screen.roomLockedMsg', { defaultValue: 'This room is locked. The host is not accepting new members right now.' }),
              );
              router.back();
              return;
            }
          }
        }
      } catch {
        // লক চেক fail হলে fail-open — নেটওয়ার্ক সমস্যায় কাউকে আটকাবো না
      }
      if (cancelled) return;

      joinRoomAsAudience(roomId, {
        userId: myUid,
        userName: myName,
        initials: myInitials,
        color: myColor,
        ...(myPhotoURL ? { photoURL: myPhotoURL } : {}),
      }).catch(() => {/* background: safe to swallow — audience join lifecycle */});

      // Send join message to room chat (only if not already sent on entry)
      // Per Sumon 2026-10-12: everyone's entry visible, even audience
      if (!hasSentEntryChatMsgRef.current) {
        hasSentEntryChatMsgRef.current = true;
        sendRoomChatMsg(roomId, {
          senderId: 'system',
          senderName: 'System',
          senderColor: C.gold,
          text: t('voiceRoom.screen.joinedRoom', { name: myName }),
          ts: Date.now(),
        }).catch(() => {/* background: safe to swallow — ephemeral join chat message */});
      }
    })();

    return () => {
      cancelled = true;
      // BUG 11 fix: only run cleanup once — handleLeave marks hasLeftRef first
      if (hasLeftRef.current) return;
      hasLeftRef.current = true;
      if (mySeatIdxRef.current >= 0) {
        removeSeat(roomId, mySeatIdxRef.current).catch(() => {/* background: safe to swallow — unmount cleanup */});
        // 2026-10-12 audit fix (HIGH): clean the audience record too —
        // seated users keep it, and this path (system back/kill) bypasses
        // handleLeave. (Minimize sets hasLeftRef first, so it's excluded.)
        leaveAudience(roomId, myUid).catch(() => {/* background: safe to swallow */});
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
    if (mySeat?.role) return mySeat.role;
    // 2026-10-12: admins moved to the audience keep their powers (the
    // rooms/$roomId/admins registry), so the audience record's role must
    // count too — otherwise a moved-down admin loses the moderation UI
    // while still holding the powers.
    const myAud = audience.find((m: Participant) => m.id === myUid);
    if (myAud?.role === 'admin') return 'admin';
    // Fall back to ownerId when the user currently has no seat (e.g. the
    // host stepped down from their seat) so the owner never gets
    // misdetected as a plain member and loses host-only capabilities.
    return (ownerId && ownerId === myUid ? 'host' : 'member');
  }, [seats, audience, myUid, ownerId]);

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
    const seat = seatIdx >= 0 ? seats[seatIdx] : null;
    if (!seat || seatIdx < 0) return;
    const prevMuted = seat.muted ?? false;
    const newMuted = !prevMuted;
    if (newMuted) muteRemoteUser(memberId);
    else playUserStream(memberId);
    // Optimistic UI — reverted below if the Firebase write fails, so the
    // icon never lies about the real moderation state (2026-10-12 fix:
    // admin writes used to be silently denied by the security rules).
    setSeats((prev: Array<Participant | null>) => prev.map((s: Participant | null, i: number) =>
      (i === seatIdx && s ? { ...s, muted: newMuted } : s),
    ));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSeatMute(roomId, seatIdx, newMuted).catch((e: unknown) => {
      // Write failed (e.g. permission denied) — revert the optimistic
      // update, restore the remote stream state, and show the real cause.
      setSeats((prev: Array<Participant | null>) => prev.map((s: Participant | null, i: number) =>
        (i === seatIdx && s ? { ...s, muted: prevMuted } : s),
      ));
      if (newMuted) playUserStream(memberId);
      else muteRemoteUser(memberId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        t('voiceRoom.screen.error'),
        t('voiceRoom.screen.muteFailedWithCause', { cause: getErrorCause(e) }),
      );
    });
  }, [muteRemoteUser, playUserStream, seats, roomId, t]);

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
    // 2026-10-12: an admin moved down keeps their admin powers (title is
    // independent of stage position); surface failures instead of swallowing.
    fbLeaveSeat(roomId, seatIdx, member.id, {
      userId: member.id,
      userName: member.name,
      initials: member.initials,
      color: member.color,
      ...(member.photoURL ? { photoURL: member.photoURL } : {}),
      ...(member.role && member.role !== 'host' ? { role: member.role } : {}),
    }).then(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }).catch((e: unknown) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        t('voiceRoom.screen.error'),
        t('voiceRoom.screen.muteFailedWithCause', { cause: getErrorCause(e) }),
      );
    });
  }, [seats, myUid, roomId, stopPublishing, stopUserStream, t]);

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
      // 2026-10-13 (Sumon): Include active frame so seats show it.
      ...((myProfile as any)?.activeFrame ? { activeFrame: (myProfile as any).activeFrame } : {}),
      // 2026-10-13 (Sumon): Verified badge next to name in seats.
      ...(myVerified ? { verified: true } : {}),
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
    // 2026-10-12: surface failures — a silent catch here hid the fact that
    // room admins were denied by the security rules for weeks.
    fbLockSeat(roomId, seatIdx).then(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }).catch((e: unknown) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        t('voiceRoom.screen.error'),
        t('voiceRoom.screen.muteFailedWithCause', { cause: getErrorCause(e) }),
      );
    });
  }, [roomId, t]);

  const unlockSeat = useCallback((seatIdx: number) => {
    fbUnlockSeat(roomId, seatIdx).then(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }).catch((e: unknown) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        t('voiceRoom.screen.error'),
        t('voiceRoom.screen.muteFailedWithCause', { cause: getErrorCause(e) }),
      );
    });
  }, [roomId, t]);

  const setAdminRole = useCallback((memberId: string) => {
    const seatIdx = seats.findIndex((s: Participant | null) => s?.id === memberId);
    // Room-admin powers live in the rooms/$roomId/admins registry (checked by
    // the security rules); the seat role is only the visible label. Both are
    // written together — powers without label (or label without powers) is a
    // broken state, so a failure here is surfaced, never swallowed.
    const writes: Array<Promise<unknown>> = [];
    if (seatIdx >= 0) {
      writes.push(setSeatRole(roomId, seatIdx, 'admin'));
    }
    const inAudience = audience.find((m: Participant) => m.id === memberId);
    if (inAudience) {
      writes.push(setAudienceRole(roomId, memberId, 'admin'));
    }
    writes.push(grantRoomAdmin(roomId, memberId));
    // P1 fix (2026-10-12): RoomInfoModal orders owner → admin → members from
    // the roomMembers reverse index. Sync the role there too, or a promoted
    // admin stays listed under "members" until they rejoin.
    writes.push(
      update(ref(database), { [`roomMembers/${roomId}/${memberId}/role`]: 'admin' }).catch(() => {
        // best-effort: index sync must not fail the promotion
      }),
    );
    Promise.all(writes).then(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }).catch((e: unknown) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        t('voiceRoom.screen.error'),
        t('voiceRoom.screen.muteFailedWithCause', { cause: getErrorCause(e) }),
      );
    });
  }, [seats, audience, roomId, t]);

  const dismissAdmin = useCallback((memberId: string) => {
    const seatIdx = seats.findIndex((s: Participant | null) => s?.id === memberId);
    const writes: Array<Promise<unknown>> = [];
    if (seatIdx >= 0) {
      writes.push(setSeatRole(roomId, seatIdx, 'member'));
    }
    const inAudience = audience.find((m: Participant) => m.id === memberId);
    if (inAudience) {
      writes.push(setAudienceRole(roomId, memberId, 'member'));
    }
    writes.push(revokeRoomAdmin(roomId, memberId));
    // P1 fix (2026-10-12): keep the roomMembers reverse index in sync so
    // Room Info ordering updates immediately on demotion too.
    writes.push(
      update(ref(database), { [`roomMembers/${roomId}/${memberId}/role`]: 'member' }).catch(() => {
        // best-effort: index sync must not fail the demotion
      }),
    );
    Promise.all(writes).then(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }).catch((e: unknown) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        t('voiceRoom.screen.error'),
        t('voiceRoom.screen.muteFailedWithCause', { cause: getErrorCause(e) }),
      );
    });
  }, [seats, audience, roomId, t]);

  const blockUser = useCallback((memberId: string, action: 'room-block' | 'comment-block') => {
    const inSeat = seats.find((s: Participant | null) => s?.id === memberId);
    const inAud  = audience.find((m: Participant) => m.id === memberId);
    const member = inSeat ?? inAud;
    if (!member) return;

    // 2026-10-12: a room-blocked admin must lose their admin powers too.
    // Comment-block keeps everything else intact (chat-only restriction).
    const demoteUid = action === 'room-block' && member.role === 'admin' ? memberId : undefined;

    // 2026-10-12 FIX (Sumon): room-block FULLY removes the user from the room.
    // Previously only the seat was removed — but seated users keep their
    // audience record (joinSeat never clears it), so the "blocked" user stayed
    // in the room as audience. Now both are removed atomically where possible.
    // The victim's client is force-leaved via the roomBlocks subscription.
    const kick = (async () => {
      if (action === 'room-block') {
        const ops: Array<Promise<unknown>> = [];
        if (inSeat) {
          const seatIdx = seats.findIndex((s: Participant | null) => s?.id === memberId);
          ops.push(removeSeat(roomId, seatIdx, demoteUid));
        }
        // Always clear the audience record too — belt-and-braces, since a
        // seated user normally still holds one.
        ops.push(
          removeAudienceMember(roomId, memberId).then(() => {
            if (demoteUid) return revokeRoomAdmin(roomId, demoteUid);
          }),
        );
        await Promise.all(ops);
      } else if (inSeat) {
        const seatIdx = seats.findIndex((s: Participant | null) => s?.id === memberId);
        await removeSeat(roomId, seatIdx, demoteUid);
      } else {
        await removeAudienceMember(roomId, memberId);
      }
    })();

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

    // 2026-10-12: never claim success before the writes land — the old code
    // showed "blocked" even when every write was permission-denied.
    Promise.all([kick, blockUserInRoom(roomId, blockRecord)]).then(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        t('voiceRoom.screen.userBlockedDone'),
        action === 'room-block'
          ? t('voiceRoom.screen.userRoomBlocked', { name: member.name })
          : t('voiceRoom.screen.userCommentBlocked', { name: member.name }),
      );
    }).catch((e: unknown) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        t('voiceRoom.screen.error'),
        t('voiceRoom.screen.muteFailedWithCause', { cause: getErrorCause(e) }),
      );
    });
  }, [seats, audience, roomId, myUid, myName, t]);

  const unblockUser = useCallback((userId: string) => {
    const record = blockedRecs.find((r: BlockRecord) => r.id === userId && r.isActive);
    if (!record) return;
    // 2026-10-12: surface failures — unblock used to look successful while denied.
    unblockUserInRoom(roomId, userId).then(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }).catch((e: unknown) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        t('voiceRoom.screen.error'),
        t('voiceRoom.screen.muteFailedWithCause', { cause: getErrorCause(e) }),
      );
    });
  }, [blockedRecs, roomId, t]);

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
      // 2026-10-12: an admin leaving surrenders their admin powers atomically
      // with the seat removal (removeSeat handles both in one update).
      const demoteUid = myRole === 'admin' ? myUid : undefined;
      removeSeat(roomId, mySeatIdx, demoteUid).catch(() => {/* background: safe to swallow — leave teardown; screen navigates away */});
      // 2026-10-12 audit fix (HIGH): seated users KEEP their audience record
      // — clean it here or ghost audience records accumulate forever
      // (onDisconnect only fires if the connection drops, not on clean exit).
      leaveAudience(roomId, myUid).catch(() => {/* background: safe to swallow */});
    } else if (hasJoined) {
      leaveAudience(roomId, myUid).catch(() => {/* background: safe to swallow — leave teardown; screen navigates away */});
      // Audience admin leaving: drop powers too (best-effort; owner self-heal
      // never re-adds since the label is gone with the audience record).
      if (myRole === 'admin') {
        revokeRoomAdmin(roomId, myUid).catch(() => {});
      }
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
      role:     myRole,
      ...(roomImageUri ? { coverImageUrl: roomImageUri } : {}),
    });
    setExitModalOpen(false);
    router.back();
  }, [roomId, roomName, roomTopic, myUid, mySeatIdx, muted, myRole, roomImageUri]);

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
    // P1 anti-spam (2026-10-12): throttle to one message per 1.5s per room.
    // Module-level map so it survives re-renders; silent drop keeps the UX snappy.
    // 2026-10-12 review fix: stamp AFTER the block-check so a blocked attempt
    // doesn't consume the throttle window.
    const now = Date.now();
    const lastSent = lastChatSendAt.get(roomId) ?? 0;
    if (now - lastSent < 1500) return;
    // Instant client-side guard (the input is already disabled, but the
    // service also enforces this server-side as the source of truth).
    if (amChatBlocked) {
      Alert.alert(
        t('voiceRoom.screen.blockedTitle'),
        t('voiceRoom.screen.commentBlockedMsg'),
      );
      return;
    }
    lastChatSendAt.set(roomId, now);
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
  }, [chatInput, replyingTo, roomId, myUid, myName, myColor, t, amChatBlocked]);

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
      // Broadcast gift event so ALL participants see the animation (2026-10-10)
      sendRoomGiftEvent(roomId, {
        giftId: info.giftId,
        emoji: info.emoji,
        coins: info.coins,
        fromUid: myUid,
        fromName: info.senderName,
        fromAvatar: info.senderAvatar || null,
        toUid: r.uid,
        toName: r.name,
        toAvatar: r.photoURL || null,
      }).catch(() => {/* non-critical */});
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
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
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
                            } catch (e) {
                              // 2026-10-12: show the real cause, not a generic message.
                              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                              Alert.alert(
                                t('voiceRoom.screen.error'),
                                t('voiceRoom.screen.muteFailedWithCause', { cause: getErrorCause(e) }),
                              );
                            }
                          },
                        },
                        {
                          text: t('voiceRoom.screen.reject'),
                          style: 'destructive',
                          onPress: () => {
                            // 2026-10-12: surface failures — a silent catch hid
                            // denied writes here too.
                            rejectSeatRequest(roomId, req.id).then(() => {
                              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                            }).catch((e: unknown) => {
                              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                              Alert.alert(
                                t('voiceRoom.screen.error'),
                                t('voiceRoom.screen.muteFailedWithCause', { cause: getErrorCause(e) }),
                              );
                            });
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
            onScroll={(e: any) => {
              const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
              const isAtBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 100;
              setShowChatScrollBtn(!isAtBottom);
            }}
            scrollEventThrottle={16}
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
          {/* 2026-10-14 (Sumon): Scroll-to-bottom floating button */}
          {showChatScrollBtn && (
            <Pressable
              onPress={() => {
                chatRef.current?.scrollToEnd({ animated: true });
                setShowChatScrollBtn(false);
              }}
              style={{
                position: 'absolute',
                right: 16,
                bottom: 70,
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: accentColor,
                alignItems: 'center', justifyContent: 'center',
                shadowColor: '#000', shadowOpacity: 0.3,
                shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
                elevation: 6,
                zIndex: 100,
              }}
            >
              <Feather name="chevron-down" size={20} color="#fff" />
            </Pressable>
          )}
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

        {/* ── Chat input (2026-10-14 polish): সুন্দর spacing, keyboard-এর উপরে থাকে */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          marginTop: 10, marginBottom: 8,
          paddingHorizontal: 4, paddingVertical: 4,
        }}>
          <ScalePress onPress={() => setEmojiPanelOpen(true)} style={{ padding: 8 }}>
            <Feather name="smile" size={26} color={C.sub} />
          </ScalePress>

          {/* @ Mention shortcut — opens picker for all live members */}
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setChatInput((prev: string) => prev + '@');
              setMentionQuery('');
            }}
            hitSlop={8}
            style={{
              width: 38, height: 38, borderRadius: 19,
              backgroundColor: accentColor + '22',
              borderWidth: 1, borderColor: accentColor + '44',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ color: accentColor, fontSize: 16, fontWeight: '900' }}>@</Text>
          </Pressable>

          <TextInput
            style={{
              flex: 1, color: C.text, fontSize: 15,
              backgroundColor: amChatBlocked ? 'rgba(239,68,68,0.08)' : C.card, borderRadius: 24,
              paddingHorizontal: 18, paddingVertical: 12,
              borderWidth: 1, borderColor: amChatBlocked ? 'rgba(239,68,68,0.45)' : C.borderFaint,
              minHeight: 46,
            }}
            value={chatInput}
            onChangeText={handleChatInput}
            placeholder={amChatBlocked
              ? t('voiceRoom.screen.commentBlockedPlaceholder')
              : t('voiceRoom.screen.messagePlaceholder')}
            placeholderTextColor={amChatBlocked ? '#EF4444' : C.muted}
            onSubmitEditing={sendMessage}
            blurOnSubmit={false}
            returnKeyType="send"
            editable={!amChatBlocked}
            maxLength={500}
          />

          <Pressable
            onPress={sendMessage}
            disabled={sendingMsg || amChatBlocked}
            hitSlop={8}
            style={{
              width: 46, height: 46, borderRadius: 23,
              backgroundColor: amChatBlocked ? 'rgba(239,68,68,0.35)' : (chatInput.trim() ? accentColor : C.muted),
              alignItems: 'center', justifyContent: 'center',
              opacity: (sendingMsg || amChatBlocked) ? 0.5 : 1,
            }}
          >
            <Feather name={amChatBlocked ? 'slash' : 'send'} size={18} color="#fff" />
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

        {/* Speaker (2026-10-11: enlarged touch target) */}
        <ScalePress onPress={toggleSpeaker} style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
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
        onVisitProfile={handleViewOtherProfile}
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
        canEdit={myRole === 'host'}
        topic={roomTopic}
        setTopic={(newTopic) => {
          setRoomTopic(newTopic);
          updateRoomSettings(roomId, { topic: newTopic }).catch(() => {
            Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.screen.settingsSaveError'));
          });
        }}
        description={roomDescription}
        setDescription={(newDesc) => {
          setRoomDescription(newDesc);
          updateRoomSettings(roomId, { description: newDesc }).catch(() => {
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
        onUnblock={() => { if (seatActionMember) { unblockUser(seatActionMember.id); setSeatActionOpen(false); } }}
        isRoomBlocked={!!seatActionMember && blockedRecs.some((r: BlockRecord) => r.id === seatActionMember.id && r.isActive && r.action === 'room-block')}
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
          fancy={entryBanner.fancy}
          onDismiss={() => setEntryBanner(null)}
        />
      ) : null}
      <GiftsModal
        visible={giftsOpen}
        onClose={() => { setGiftsOpen(false); setGiftsRecipient(null); }}
        onGiftSent={handleGiftSent}
        // 2026-10-13 (Sumon-এর নিয়ম): gift সবাইকে পাঠানো যাবে — seated +
        // audience সবাই (self সহ)। আগে শুধু seated members ছিল।
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
        onUnblock={() => { if (activeMember) unblockUser(activeMember.id); setActiveMember(null); }}
        isCommentBlocked={!!activeMember && blockedRecs.some((r: BlockRecord) => r.id === activeMember.id && r.isActive && r.action === 'comment-block')}
        isRoomBlocked={!!activeMember && blockedRecs.some((r: BlockRecord) => r.id === activeMember.id && r.isActive && r.action === 'room-block')}
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
      {/* P0 security (2026-10-12): in-screen PIN gate overlay. Blocks the
          entire room UI until the correct 4-digit PIN is entered — closes
          the deep-link bypass (invite/notification/profile taps). */}
      <Modal
        visible={pinGate === 'open'}
        animationType="fade"
        transparent={false}
        onRequestClose={cancelPinGate}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }} edges={['top', 'bottom']}>
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
            <View style={{
              width: 72, height: 72, borderRadius: 36,
              backgroundColor: '#E3F2FD', alignItems: 'center', justifyContent: 'center',
              marginBottom: 20,
            }}>
              <Feather name="lock" size={30} color="#007AFF" />
            </View>
            <Text style={{ color: '#000000', fontSize: 20, fontWeight: '900', marginBottom: 6, textAlign: 'center' }} numberOfLines={1}>
              {roomName || t('voiceRoom.screen.pinGateTitle')}
            </Text>
            <Text style={{ color: '#8E8E93', fontSize: 14, marginBottom: 24, textAlign: 'center' }}>
              {t('voiceRoom.screen.pinGateMsg')}
            </Text>
            <TextInput
              style={{
                backgroundColor: '#F2F2F7', borderRadius: 14, borderWidth: 1.5,
                borderColor: pinError ? '#FF4B4B' : '#E3F2FD',
                color: '#000000', fontSize: 28, fontWeight: '800',
                textAlign: 'center', letterSpacing: 16,
                paddingVertical: 14, marginBottom: 8, width: 220,
              }}
              placeholder="••••"
              placeholderTextColor="#C7C7CC"
              value={pinInput}
              onChangeText={(txt) => {
                const digits = txt.replace(/[^0-9]/g, '').slice(0, 4);
                setPinInput(digits);
                if (pinError) setPinError('');
              }}
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              autoFocus
              editable={!pinVerifying}
              onSubmitEditing={submitPinGate}
            />
            {pinError ? (
              <Text style={{ color: '#FF4B4B', fontSize: 13, textAlign: 'center', marginBottom: 16 }}>{pinError}</Text>
            ) : (
              <Text style={{ color: '#C7C7CC', fontSize: 12, textAlign: 'center', marginBottom: 16 }}>
                {t('voiceRoom.screen.pinNumbersOnly')}
              </Text>
            )}
            <Pressable
              onPress={submitPinGate}
              disabled={pinVerifying || pinInput.length !== 4}
              style={{
                backgroundColor: '#E3F2FD', borderRadius: 14,
                paddingVertical: 14, paddingHorizontal: 48, marginBottom: 12,
                opacity: (pinVerifying || pinInput.length !== 4) ? 0.5 : 1,
              }}
            >
              <Text style={{ color: '#007AFF', fontSize: 16, fontWeight: '800' }}>
                {pinVerifying ? t('voiceRoom.screen.pinVerifying') : t('voiceRoom.screen.pinJoin')}
              </Text>
            </Pressable>
            <Pressable onPress={cancelPinGate} style={{ paddingVertical: 10 }}>
              <Text style={{ color: '#8E8E93', fontSize: 15, fontWeight: '600' }}>
                {t('voiceRoom.screen.pinCancel')}
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
    </KeyboardAvoidingView>
  );
}
