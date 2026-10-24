import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, FlatList, Alert, Pressable, Animated, Platform, TextInput, Image, BackHandler, Modal, KeyboardAvoidingView, Keyboard, AppState } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ref, get, onValue, update, set, serverTimestamp } from 'firebase/database';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import ScalePress from '@/components/ScalePress';
import { database } from '@/src/config/firebase';
import { setMinimizedRoom, getMinimizedRoom, setCurrentRoom, getCurrentRoom, clearCurrentRoom } from '@/src/store/minimizedRoom';
import { persistActiveRoom, getPersistedActiveRoom, clearPersistedActiveRoom } from '@/src/store/activeRoom';
import { useLivekitVoiceRoom, setVoiceRoomMinimized, destroyPersistedVoiceRoomEngineAsync, prefetchLivekitToken } from '../useLivekitVoiceRoom';
import { fetchGiftCatalog } from '../services/giftCatalogService';
import { useAuth } from '@/src/context/AuthContext';
import { getUser, subscribeUser } from '@/src/services/userService';
import { subscribeWalletBalance } from '@/src/features/wallet/walletService';
import { submitReport } from '@/src/services/reportService';

import { getErrorCause } from '@/src/utils/errorDisplay';
import { useSafeKeepAwake } from '@/src/hooks/useSafeKeepAwake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  isBatteryExempt, requestBatteryExemption,
} from '@/src/services/voiceForegroundService';
import { C, ROOM_META, getActiveThemes } from '../constants/theme';
import { markVoiceStage } from '../utils/voiceCrashBreadcrumb';
import { Role, Participant, BlockRecord, ChatMsg, SeatReaction, GiftSentInfo, roleToLevel } from '../types/room';
import { getWeekStart } from '../utils/format';
import { truncateTo12 } from '@/src/utils/truncateName';
import { SeatCard } from '../components/SeatCard';
import PairHalo, { HALO_R } from '../components/PairHalo';
import { resolveDesign, HANDSHAKE_DESIGNS, BASIC_DESIGN_KEY } from '../components/handshakeDesigns';
import {
  subscribeIntimacy, intimacyLevelFor, intimacyPairKey,
} from '../services/intimacyService';
import { subscribePairHandshake } from '../services/micHandshakeService';
import { useStoreRoomDecor } from '@/src/hooks/useStoreItems';
import RoomChatMessage from '../components/RoomChatMessage';
import { RoomInfoModal } from '../components/RoomInfoModal';
import { OperationHistoryModal } from '../components/OperationHistoryModal';
import { SettingsModal } from '../components/SettingsModal';
import { SeatActionSheet } from '../components/SeatActionSheet';
import { InviteToSeatModal } from '../components/InviteToSeatModal';
import { InviteModal } from '../components/InviteModal';
import { LeaderboardModal } from './LeaderboardModal';
import RoomMembersModal from '../components/RoomMembersModal';
import { GiftsModal } from '../components/GiftsModal';
import { AnimatedThemeBackground } from '../components/AnimatedThemeBackground';
import { MemberManageModal } from '../components/MemberManageModal';
import { EmojiPanel } from '../components/EmojiPanel';
import { SeatQueueModal } from '../components/SeatQueueModal';
import { RoomRankModal } from '../components/RoomRankModal';
import { RoomPropsSheet } from '../components/RoomPropsSheet';
import { RoomGamesModal } from '../components/games/RoomGamesModal';
import { RoomAnnouncementModal } from '../components/RoomAnnouncementModal';
import { IntimacyModal } from '../components/IntimacyModal';
import { PropsBackpackModal } from '../components/PropsBackpackModal';
import {
  subscribeAnnouncement, type RoomAnnouncement,
} from '../services/roomAnnouncementService';
import { VoteGameModal } from '../components/games/VoteGameModal';
import { TurntableGameModal } from '../components/games/TurntableGameModal';
import { LuckyBagGameModal } from '../components/games/LuckyBagGameModal';
import type { RoomGame, GameType } from '../services/roomGameService';
import { ExitModal } from '../components/ExitModal';
import EntryBanner from '../components/EntryBanner';
import { GiftFlyAnimation, GiftReceiveBanners, type GiftFlyHandle } from '../components/GiftFlyAnimation';

import { checkVoiceBan, type VoiceBanInfo } from '../services/voiceBanService';
import {
  subscribeSeats, subscribeAudience, subscribeRoomInfo,
  subscribeLockedSeats, subscribeRoomAdmins,
  joinRoomAsAudience, leaveAudience, takeSeat, clearOtherSeats, leaveSeat as fbLeaveSeat,
  setSeatMute, setSeatHostMute, setSeatRole, removeSeat, removeAudienceMember,
  lockSeat as fbLockSeat, unlockSeat as fbUnlockSeat, setAudienceRole,
  grantRoomAdmin, revokeRoomAdmin,
  closeRoom, updateRoomSettings, getUserColor, getInitials,
  disbandRoom,
  sendSeatRequest, subscribeSeatRequests, cancelSeatRequest,
  type SeatRequest,
  blockUserInRoom, unblockUserInRoom, subscribeRoomBlocks, isUserBlockedInRoom,
  type RoomBlockRecord,
  type RoomSeat, type RoomAudienceMember,
  verifyRoomPin,
  sendSeatInvite, subscribeSeatInvites, removeSeatInvite, type SeatInvite,
  sendRoomEmojiReaction, subscribeRoomEmojiReactions,
  refreshSeatHeartbeat, sweepStaleSeats,
  refreshAudienceHeartbeat, sweepStaleAudience,
  isPinVerifiedForSession as isPinVerified,
  setPinVerifiedForSession as setPinVerified,
  sendRoomEntryEvent, subscribeRoomEntryEvents,
  sendRoomGiftEvent, subscribeRoomGiftEvents } from '../services/firebaseRoomService';
import {
  subscribeRoomChat, sendRoomChatMsg, loadOlderMessages, createRoomChatKey,
  type RoomChatMsg } from '../services/firebaseRoomChatService';


import { fbSeatToParticipant, fbAudToParticipant, fbChatToMsg, lastChatSendAt, addSentJoinMsgKey, sentJoinMsgKeys, LiveAudiencePill, LiveDateIcon, TwinkleSparkle, ObsidianGiftButton, ObsidianExitButton, OrbitSparkle, SapphireInviteButton, PulseRing, PulseMicButton, LiquidGoldSpeaker } from './VoiceRoomHelpers';
import { VoiceRoomBottomBar } from './VoiceRoomBottomBar';
import { VoiceRoomModals } from './VoiceRoomModals';

/**
 * 2026-10-23 (boss: একই "joined the room" লাইন বারবার): the single
 * gate for the room join system-message. In-memory set (this session)
 * + AsyncStorage timestamp (across restarts): at most one join line
 * per room per user per 30 minutes. Returns true when the caller may
 * send. Storage trouble never blocks a legitimate first send.
 */
async function claimJoinMsgSlot(joinKey: string): Promise<boolean> {
  if (sentJoinMsgKeys.has(joinKey)) return false;
  addSentJoinMsgKey(joinKey);
  try {
    const raw = await AsyncStorage.getItem('vee_join_msg_ts');
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    if (map[joinKey] && Date.now() - map[joinKey] < 30 * 60 * 1000) return false;
    map[joinKey] = Date.now();
    await AsyncStorage.setItem('vee_join_msg_ts', JSON.stringify(map));
  } catch { /* fall through — send */ }
  return true;
}

export default function VoiceRoomScreen() {
  const { roomId: paramRoomId, restore } = useLocalSearchParams<{ roomId: string; restore?: string }>();
  const isRestore = restore === '1';
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { t } = useTranslation();

  const roomId = paramRoomId ?? '';
  // 2026-10-22 (boss): the display must never sleep while the user is
  // inside a voice room (reported: screen turning off mid-conversation).
  useSafeKeepAwake('voice-room');
  const { backgroundUrl: storeBgUrl, micDecorUrl } = useStoreRoomDecor(roomId || null);
  const myUid  = user?.uid ?? 'anonymous';
  const myUidRef = useRef(myUid);
  useEffect(() => { myUidRef.current = myUid; }, [myUid]);

  const [myProfile, setMyProfile] = useState<{ name: string; photoURL?: string; activeFrame?: string } | null>(null);
  const [myVerified, setMyVerified] = useState(false);
  useEffect(() => {
    if (!myUid || myUid === 'anonymous') return;
    const unsub = subscribeUser(myUid, (p) => {
      if (p) setMyProfile({ name: p.name, photoURL: p.photoURL || undefined, activeFrame: (p as any).activeFrame || undefined });
    });
    import('@/src/services/verifiedService').then(({ hasOfficialBadge }) => {
      hasOfficialBadge(myUid).then(setMyVerified).catch(() => {});
    }).catch(() => {});
    return unsub;
  }, []);

  useEffect(() => {
    const frame = (myProfile as any)?.activeFrame;
    const seatIdx = mySeatIdxRef.current;
    if (!roomId || seatIdx < 0 || !myUid) return;
    if (frame) {
      update(ref(database, `rooms/${roomId}/seats/${seatIdx}`), { activeFrame: frame })
        .then(() => console.log(`[VoiceRoom] ✅ Seat ${seatIdx} frame synced: ${frame}`))
        .catch((e) => console.log(`[VoiceRoom] ❌ Seat frame sync FAILED:`, e?.message || e));
    }
  }, [(myProfile as any)?.activeFrame]);

  // 2026-10-22 (boss, heat/lag): the 30s PERIODIC frame-sync interval that
  // used to live here is REMOVED. It rewrote seats/{idx}.activeFrame every
  // 30s even when nothing changed — and every write re-fires the seats
  // subscription on EVERY member's phone, cascading full-room re-renders
  // forever. The change-driven effect above already syncs the frame the
  // moment it actually changes, and buildSeatData includes it on claim.

  const myName = myProfile?.name || user?.displayName || t('voiceRoom.screen.defaultUserName');
  const myPhotoURL = myProfile?.photoURL || user?.photoURL || undefined;
  const myColor = getUserColor(myUid);
  const myInitials = getInitials(myName);

  const voiceUserName = useMemo(() => user?.displayName ?? myUid, []);

  
  const [voiceReady, setVoiceReady] = useState(false);
  const voiceReadyRef = useRef(false);
  useEffect(() => {
    markVoiceStage('screen_mount', roomId);
  }, []);

  // 2026-10-21 (boss: room entry slow + gift play delayed): warm the
  // LiveKit token the moment the screen mounts, in parallel with
  // everything else, so voice connect doesn't wait on the VPS round trip
  // after the PIN gate passes.
  useEffect(() => {
    if (!roomId || !myUid || myUid === 'anonymous') return;
    prefetchLivekitToken(roomId, voiceUserName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, myUid]);

  
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
      setMinimizedRoom(null);
      return;
    }
    (async () => {
      try {
        await destroyPersistedVoiceRoomEngineAsync();
      } catch {  }
      // 2026-10-22 FIX (boss): leaving a room must NEVER strip the leaver's
      // own room-admin grant. The old code demoted/revoked SELF here (and in
      // handleLeave) — reusing the KICK path for a voluntary exit — so every
      // admin who left and re-entered came back as a plain member. Admin is
      // removed only by the owner (dismissAdmin) or a kick/block of that user.
      if (prev.mySeatIdx >= 0) {
        removeSeat(prev.id, prev.mySeatIdx).catch(() => {});
        leaveAudience(prev.id, prev.myUid || myUid).catch(() => {});
      } else {
        leaveAudience(prev.id, prev.myUid || myUid).catch(() => {});
      }
      setMinimizedRoom(null);
    })();
  }, [roomId]);

  
  const handleRoomInfoOk = useCallback(() => {
    markVoiceStage('room_info_ok', roomId);
    if (voiceReadyRef.current) return;
    voiceReadyRef.current = true;
    // 2026-10-21 (boss: voice room loads slowly): a hardcoded 1,200 ms
    // setTimeout used to sit here before voice could even START
    // connecting — a flat 1.2 s tax on every single room entry. Voice now
    // starts the moment the room-info/PIN checks pass.
    setVoiceReady(true);
  }, [roomId]);

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
  const [voiceBan, setVoiceBan] = useState<VoiceBanInfo | null>(null);
  const [banCheckDone, setBanCheckDone] = useState(false);

  
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
    wasRestored } = useLivekitVoiceRoom({
    roomID: voiceReady ? roomId : '',
    userID: voiceBan ? 'anonymous' : myUid,
    userName: voiceUserName });

  // 2026-10-24 (boss: room entry must be SUPER FAST): the gift catalog
  // load also prefetches EVERY gift's animation into the image cache —
  // dozens of animated WebPs competing with the voice connect for
  // network/CPU on entry. Defer it until voice is actually joined; the
  // gift picker fetches the catalog itself on open, so nothing breaks
  // if join is slow or never happens.
  const giftCatalogWarmedRef = useRef(false);
  useEffect(() => {
    if (!voiceJoined || giftCatalogWarmedRef.current) return;
    giftCatalogWarmedRef.current = true;
    fetchGiftCatalog().catch(() => {});
  }, [voiceJoined]);

  
  const [seats,         setSeats]        = useState<Array<Participant | null>>(Array(10).fill(null));
  const [lockedSeats,   setLockedSeats]  = useState<Set<number>>(new Set<number>());
  const [audience,      setAudience]     = useState<Participant[]>([]);
  // 2026-10-22 (boss): admin registry (rooms/{id}/admins) — the SOURCE OF
  // TRUTH for role, exactly like the security rules. See myRole below.
  const [roomAdminUids, setRoomAdminUids] = useState<Set<string>>(new Set<string>());
  // Perf guards (2026-10-22): seats/audience snapshots also fire on pure
  // heartbeat writes (60s ts refresh by every member). A signature of the
  // VISIBLE fields lets the handlers skip setState — and the full-screen
  // re-render it triggers — when nothing visible actually changed.
  const seatsSigRef = useRef('');
  const audienceSigRef = useRef('');
  const [blockedRecs,   setBlockedRecs]  = useState<BlockRecord[]>([]);
  
  const amChatBlocked = useMemo(
    () => blockedRecs.some(
      (r) => r.id === myUid && r.isActive &&
        (r.action === 'comment-block' || r.action === 'room-block'),
    ),
    [blockedRecs, myUid],
  );
  const [entryBanner, setEntryBanner] = useState<{ name: string; photoURL?: string | null; nobleRankIndex?: number } | null>(null);
  const [pendingRequests, setPendingRequests] = useState<SeatRequest[]>([]);
  // 2026-10-19 (IMO waiting queue): 1-based position of my own pending seat
  // request in the time-ordered queue, or null when I'm not queued.
  const myQueuePosition = useMemo(() => {
    const ordered = [...pendingRequests].sort((a, b) => a.ts - b.ts);
    const idx = ordered.findIndex((r) => r.userId === myUid);
    return idx >= 0 ? idx + 1 : null;
  }, [pendingRequests, myUid]);
  const myQueuedRequest = useMemo(
    () => pendingRequests.find((r) => r.userId === myUid) ?? null,
    [pendingRequests, myUid],
  );
  const [ownerId,       setOwnerId]      = useState<string>('');
  const [walletBalance, setWalletBalance] = useState(0);
  const [weeklyEarned,  setWeeklyEarned] = useState(0);
  const [pendingSeatInvites, setPendingSeatInvites] = useState<SeatInvite[]>([]);
  const [chatOldestKey,    setChatOldestKey]    = useState<string | null>(null);
  const [loadingOlderMsgs, setLoadingOlderMsgs] = useState(false);
  const [hasOlderMsgs,     setHasOlderMsgs]     = useState(true);
  const [showChatScrollBtn, setShowChatScrollBtn] = useState(false);

  const speakingRef = useRef<Record<string, boolean>>({});
  useEffect(() => { speakingRef.current = speakingUsers; }, [speakingUsers]);

  const seatsRef = useRef<Array<Participant | null>>(Array(10).fill(null));
  useEffect(() => { seatsRef.current = seats; }, [seats]);
  const audienceRef = useRef<Participant[]>([]);
  useEffect(() => { audienceRef.current = audience; }, [audience]);

  
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
  }, [wasRestored, seats]);

  const lastReactionTsRef = useRef(0);
  const reactionTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // 2026-10-23 (Sumon: super-fast room sends): optimistic chat echoes —
  // my own message/sticker renders the instant I tap send, under the same
  // push key the subscription will deliver, so it never waits for the
  // network round trip and never duplicates when the snapshot lands.
  const pendingEchoesRef = useRef<ChatMsg[]>([]);
  // My own seat reaction is performed locally at tap time; this marks it
  // so the subscription copy of the same reaction is not played twice.
  const lastLocalReactionRef = useRef<{ emoji: string; at: number } | null>(null);

  const handledInviteIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!roomId) {
      Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.screen.roomNotFound'));
      router.back();
    }
  }, []);

  
  useEffect(() => {
    if (!myUid || myUid === 'anonymous') return;
    return subscribeWalletBalance(myUid, setWalletBalance);
  }, [myUid]);

  
  useEffect(() => {
    if (!myUid || myUid === 'anonymous') return;
    return onValue(
      ref(database, `wallets/${myUid}/weeklyEarned`),
      (snap) => { setWeeklyEarned(snap.exists() ? (snap.val() as number) : 0); },
      () => { setWeeklyEarned(0); },
    );
  }, [myUid]);

  
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

  
  useEffect(() => {
    pendingSeatInvites.forEach((invite) => {
      if (handledInviteIds.current.has(invite.id)) return;
      handledInviteIds.current.add(invite.id);
      Alert.alert(
        t('voiceRoom.screen.seatInviteTitle'),
        t('voiceRoom.screen.seatInviteMsg', {
          inviterName: invite.inviterName,
          number: invite.seatIdx + 1,
          roomName: invite.roomName }),
        [
          {
            text: t('voiceRoom.screen.accept'),
            onPress: async () => {
              const currentIdx = mySeatIdxRef.current;
              if (currentIdx >= 0 && currentIdx !== invite.seatIdx) {
                try {
                  await fbLeaveSeat(roomId, currentIdx, myUid);
                } catch {
                  Alert.alert(t('voiceRoom.screen.seatNoLongerAvailableTitle'), t('voiceRoom.screen.seatNoLongerAvailableMsg'));
                  return;
                }
              }
              let result: { success: boolean };
              try {
                let isVerified = false;
                try {
                  const { hasOfficialBadge } = await import('@/src/services/verifiedService');
                  isVerified = await hasOfficialBadge(myUid);
                } catch {  }
                result = await takeSeat(roomId, invite.seatIdx, {
                  userId: myUid, userName: myName,
                  initials: myInitials, color: myColor,
                  muted: false, role: 'member',
                  ...(myPhotoURL ? { photoURL: myPhotoURL } : {}),
                  ...((myProfile as any)?.activeFrame ? { activeFrame: (myProfile as any).activeFrame } : {}),
                  ...(isVerified ? { verified: true } : {}) });
              } catch {
                Alert.alert(t('voiceRoom.screen.seatNoLongerAvailableTitle'), t('voiceRoom.screen.seatNoLongerAvailableMsg'));
                return;
              }
              if (result.success) {
                removeSeatInvite(myUid, invite.id).catch(() => {});
                startPublishing();
                sendRoomChatMsg(roomId, {
                  senderId: 'system', senderName: 'System', senderColor: C.gold,
                  text: t('voiceRoom.screen.memberJoinedSeat', { name: myName, number: invite.seatIdx + 1 }),
                  ts: Date.now() }).catch(() => {});
              } else {
                Alert.alert(t('voiceRoom.screen.seatNoLongerAvailableTitle'), t('voiceRoom.screen.seatNoLongerAvailableMsg'));
              }
            } },
          {
            text: t('voiceRoom.screen.decline'),
            style: 'cancel',
            onPress: () => { removeSeatInvite(myUid, invite.id).catch(() => {}); } },
        ],
      );
    });
  }, [pendingSeatInvites]);

  
  useEffect(() => {
    if (!roomId) return;
    return subscribeRoomEmojiReactions(roomId, (reaction) => {
      if (!reaction) return;
      if (reaction.ts <= lastReactionTsRef.current) return;
      if (Date.now() - reaction.ts > 5000) return;
      // 2026-10-23: my own reaction already performed locally at tap
      // time (see sendEmojiReaction) — never replay its subscription copy.
      const local = lastLocalReactionRef.current;
      if (reaction.byUid === myUid && local && reaction.emoji === local.emoji
        && Date.now() - local.at < 4000) {
        lastReactionTsRef.current = reaction.ts;
        return;
      }
      lastReactionTsRef.current = reaction.ts;
      const senderMember = seatsRef.current.find((m) => m && m.id === reaction.byUid);
      if (!senderMember) return;
      // 2026-10-23 (Sumon): the emoji now performs inside the seat DP for
      // ~3.3s (SeatEmojiReaction owns the motion); here we only mount it
      // and schedule the unmount. A newer reaction on the same seat
      // replaces the timer and remounts via its key.
      const memberId = senderMember.id;
      const key = reaction.ts;
      setSeatReactions((prev: Record<string, SeatReaction>) => ({
        ...prev, [memberId]: { emoji: reaction.emoji, key } }));
      const old = reactionTimersRef.current[memberId];
      if (old) clearTimeout(old);
      reactionTimersRef.current[memberId] = setTimeout(() => {
        setSeatReactions((prev: Record<string, SeatReaction>) => {
          if (prev[memberId]?.key !== key) return prev;
          const n = { ...prev }; delete n[memberId]; return n;
        });
      }, 3350);
    });
  }, [roomId]);

  
  const [roomTopic,     setRoomTopic]    = useState<string>(t('voiceRoom.creation.defaultTopic'));
  const [roomName,      setRoomName]     = useState(ROOM_META.name);
  const [roomImageUri, setRoomImageUri] = useState<string | null>(null);
  const [activeThemeId, setActiveThemeId] = useState('imo-light');
  
  const activeThemeIdRef = useRef('imo-light');
  
  const [roomIsPublic,  setRoomIsPublic]  = useState(true);
  
  const [roomIsLocked,  setRoomIsLocked]  = useState(false);
  
  const [roomDescription, setRoomDescription] = useState('');
  const accentColor = useMemo(
    () => getActiveThemes().find((th: { id: string; accent: string }) => th.id === activeThemeId)?.accent ?? C.primary,
    [activeThemeId],
  );
  
  const themeBg = useMemo(
    () => getActiveThemes().find((th) => th.id === activeThemeId)?.bg ?? C.bg,
    [activeThemeId],
  );
  
  const themeSurface = useMemo(
    () => getActiveThemes().find((th) => th.id === activeThemeId)?.surface ?? C.card,
    [activeThemeId],
  );

  // 2026-10-21 (boss): text colors for elements sitting directly on the
  // themed background (room title, seat names, bottom-bar labels) — light
  // on the one black theme, dark on every light theme.
  const themeOnBg = useMemo(
    () => getActiveThemes().find((th) => th.id === activeThemeId)?.onBg ?? C.text,
    [activeThemeId],
  );

  const themeOnBgSub = useMemo(
    () => getActiveThemes().find((th) => th.id === activeThemeId)?.onBgSub ?? C.sub,
    [activeThemeId],
  );

  // 2026-10-23 (boss): scene themes — the animated scene renders inside
  // AnimatedThemeBackground (background layer only, zIndex 0); seats, DPs,
  // chat, buttons and texts all render on top and are never covered.
  const themeScene = useMemo(
    () => getActiveThemes().find((th) => th.id === activeThemeId)?.scene,
    [activeThemeId],
  );

  
  const [hasJoined, setHasJoined] = useState(false);
  const [isRoomMember, setIsRoomMember] = useState(false);

  useEffect(() => {
    if (!myProfile?.name || !roomId || !myUid || myUid === 'anonymous') return;
    let cancelled = false;
    (async () => {
      const patch: Record<string, unknown> = {
        userName: myProfile.name,
        initials: getInitials(myProfile.name),
        ...(myProfile.photoURL ? { photoURL: myProfile.photoURL } : {}) };
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
      } catch {  }
    })();
    return () => { cancelled = true; };
  }, [myProfile, roomId, hasJoined]);

  const [pinGate, setPinGate] = useState<'checking' | 'open' | 'passed'>('checking');
  const pinGateRef = useRef<'checking' | 'open' | 'passed'>('checking');
  const pinEvaluatedForRef = useRef<string | null>(null);
  const pinInfoRef = useRef<{ isPublic?: boolean; ownerId?: string; pinVersion?: number; isLocked?: boolean } | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinVerifying, setPinVerifying] = useState(false);
  const pinSubmittingRef = useRef(false); // double-tap submit guard

  useEffect(() => {
    if (!myUid || myUid === 'anonymous') { setBanCheckDone(true); return; }
    let cancelled = false;
    checkVoiceBan(myUid)
      .then((ban) => { if (!cancelled) { setVoiceBan(ban); setBanCheckDone(true); } })
      .catch(() => { if (!cancelled) setBanCheckDone(true); }); // fail-open
    return () => { cancelled = true; };
  }, [myUid]);

  useEffect(() => {
    if (!banCheckDone || !voiceBan) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      try {
        clearCurrentRoom();
        if (router.canGoBack()) router.back();
        else router.replace('/home');
      } catch {
        try { router.replace('/home'); } catch {}
      }
      return true; // handled
    });
    return () => sub.remove();
  }, [banCheckDone, voiceBan]);

  
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
        const curVer = typeof pinInfoRef.current?.pinVersion === 'number' ? pinInfoRef.current.pinVersion : 0;
        setPinVerified(myUidRef.current, roomId, curVer);
        pinGateRef.current = 'passed';
        setPinGate('passed');
        setPinInput('');
        setPinError('');
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

  
  const cancelPinGate = useCallback(() => {
    router.back();
  }, [router]);

  const hasShownSelfEntryRef = useRef(false);
  const hasSentEntryChatMsgRef = useRef(false);
  useEffect(() => {
    if (!hasShownSelfEntryRef.current && myUid && myProfile && roomId && pinGate === 'passed') {
      hasShownSelfEntryRef.current = true;
      const displayName = myName || 'User';
      (async () => {
        let myRank = myNobleRankRef.current;
        if (myRank == null) {
          try {
            const { getNobleState } = await import('@/src/services/nobleService');
            const noble = await getNobleState(myUid).catch(() => null);
            if (noble && !noble.lapsed) {
              myRank = noble.rankIndex;
              myNobleRankRef.current = myRank;
            }
          } catch {  }
        }
        setEntryBanner({
          name: displayName,
          photoURL: myPhotoURL || null,
          ...(myRank != null ? { nobleRankIndex: myRank } : {}) });
        sendRoomEntryEvent(roomId, {
          uid: myUid,
          name: displayName,
          photoURL: myPhotoURL || null,
          ...(myRank != null ? { nobleRankIndex: myRank } : {}) }).catch(() => {});
      })();
    }
  }, [myUid, myProfile, myName, myPhotoURL, roomId, pinGate]);

  const lastEntryTsRef = useRef(0);
  useEffect(() => {
    if (!roomId) return;
    return subscribeRoomEntryEvents(roomId, (entry) => {
      if (!entry) return;
      if (entry.ts <= lastEntryTsRef.current) return;
      if (Date.now() - entry.ts > 10000) return; // 10s TTL
      lastEntryTsRef.current = entry.ts;
      if (entry.uid === myUid) return;
      setEntryBanner({
        name: entry.name || 'User',
        photoURL: entry.photoURL || null,
        ...(entry.nobleRankIndex != null ? { nobleRankIndex: entry.nobleRankIndex } : {}) });
    });
  }, [roomId, myUid]);

  const lastGiftTsRef = useRef(0);
  useEffect(() => {
    if (!roomId) return;
    return subscribeRoomGiftEvents(roomId, (event) => {
      if (!event) return;
      if (event.ts <= lastGiftTsRef.current) return;
      if (Date.now() - event.ts > 10000) return; // 10s TTL
      lastGiftTsRef.current = event.ts;
      if (event.fromUid === myUid) return;
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
        animationUrl: event.animationUrl || undefined,
        animationType: event.animationType || undefined,
        thumbnailUrl: event.thumbnailUrl || undefined,
        videoSize: event.videoSize || undefined,
        videoFullscreen: event.videoFullscreen || undefined,
      });
    });
  }, [roomId, myUid]);

  useEffect(() => {
    if (!roomId || !myUid || hasJoined || pinGate !== 'passed' || !banCheckDone || voiceBan) return;
    let cancelled = false;
    (async () => {
      try {
        const { get, ref } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
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
        if (seatsSnap.exists()) {
          let onSeat = false;
          seatsSnap.forEach((child) => {
            const s = child.val() as { userId?: string } | null;
            if (s?.userId === myUid) onSeat = true;
          });
          if (onSeat) setHasJoined(true);
        }
      } catch {  }
    })();
    return () => { cancelled = true; };
  }, [roomId, myUid, hasJoined, pinGate, banCheckDone, voiceBan]);

  
  const [messages,   setMessages]   = useState<ChatMsg[]>([]);
  const chatRef = useRef<FlatList<ChatMsg>>(null);
  
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const historyCutoffTsRef = useRef<number>(0);
  const historyCleanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [chatInput,    setChatInput]    = useState('');
  const [replyingTo,   setReplyingTo]   = useState<ChatMsg | null>(null);
  // 2026-10-23 (Sumon): long-press a user TEXT message → Copy/Reply sheet.
  const [actionMsg,    setActionMsg]    = useState<ChatMsg | null>(null);
  const [copiedToast,  setCopiedToast]  = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopyMsg = useCallback(async () => {
    if (!actionMsg) return;
    const text = actionMsg.text;
    setActionMsg(null);
    try {
      await Clipboard.setStringAsync(text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopiedToast(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedToast(false), 1400);
    } catch { /* clipboard unavailable — nothing to show */ }
  }, [actionMsg]);

  const handleReplyFromAction = useCallback(() => {
    if (!actionMsg) return;
    setReplyingTo(actionMsg);
    setActionMsg(null);
  }, [actionMsg]);
  
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  
  const [seatReactions,  setSeatReactions]  = useState<Record<string, SeatReaction>>({});

  
  const giftFlyRef = useRef<GiftFlyHandle>(null);
  const seatViewRefs = useRef<Record<string, View | null>>({});

  // ── Mic Handshake pair links (2026-10-20, Sumon) ──────────────────────
  // Adjacent seated pairs who share a diamond-sending intimacy relation
  // get an animated link between their avatars. Premium designs come from
  // the Store (micHandshakes/{pairKey}); otherwise the free basic design,
  // coloured + sparkled by the pair's intimacy level.
  const [pairData, setPairData] = useState<Record<string, { value: number; designKey: string | null }>>({});
  const adjacentPairs = useMemo(() => {
    const out: { key: string; a: string; b: string }[] = [];
    for (let i = 0; i + 1 < seats.length; i++) {
      if (i % 5 === 4) continue; // 5-column grid — row edge, not adjacent
      const A = seats[i]; const B = seats[i + 1];
      if (A && B && A.id !== B.id) out.push({ key: intimacyPairKey(A.id, B.id), a: A.id, b: B.id });
    }
    return out;
  }, [seats]);
  // ── Pair Halo groups (boss pick M, 2026-10-23) ─────────────────────────
  // Chained active pairs in a row merge into ONE group halo (3–4 seats =
  // one big ring around everyone). The group's design = the strongest
  // pair in it: a premium Store design wins (richest pair if several),
  // otherwise the basic tier of the highest intimacy value in the group.
  const haloGroups = useMemo(() => {
    type PairInfo = { value: number; designKey: string | null };
    const groups: { key: string; uids: string[]; pairs: PairInfo[] }[] = [];
    for (const p of adjacentPairs) {
      const d = pairData[p.key];
      if (!d || d.value < 1) continue;
      const last = groups[groups.length - 1];
      if (last && last.uids[last.uids.length - 1] === p.a) {
        last.uids.push(p.b);
        last.pairs.push(d);
      } else {
        groups.push({ key: p.key, uids: [p.a, p.b], pairs: [d] });
      }
    }
    return groups.map((g) => {
      let bestPremium: PairInfo | null = null;
      for (const p of g.pairs) {
        if (p.designKey && p.designKey !== BASIC_DESIGN_KEY && HANDSHAKE_DESIGNS[p.designKey]) {
          if (!bestPremium || p.value > bestPremium.value) bestPremium = p;
        }
      }
      const design = bestPremium
        ? HANDSHAKE_DESIGNS[bestPremium.designKey as string]
        : resolveDesign(null, intimacyLevelFor(Math.max(...g.pairs.map((p) => p.value))).id);
      return { key: g.key, uids: g.uids, design };
    });
  }, [adjacentPairs, pairData]);
  const pairSig = adjacentPairs.map((p) => p.key).join('|');
  useEffect(() => {
    if (!adjacentPairs.length) { setPairData({}); return; }
    const unsubs: (() => void)[] = [];
    for (const p of adjacentPairs) {
      unsubs.push(subscribeIntimacy(p.a, p.b, (rec) => {
        setPairData((prev) => ({ ...prev, [p.key]: { value: rec.value, designKey: prev[p.key]?.designKey ?? null } }));
      }));
      unsubs.push(subscribePairHandshake(p.key, (hs) => {
        setPairData((prev) => ({ ...prev, [p.key]: { value: prev[p.key]?.value ?? 0, designKey: hs?.designKey ?? null } }));
      }));
    }
    return () => { unsubs.forEach((u) => { try { u(); } catch { /* noop */ } }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairSig]);

  const gridWrapRef = useRef<View | null>(null);
  const [cellGeom, setCellGeom] = useState<Record<string, { x: number; y: number; w: number }>>({});
  const measureCells = useCallback(() => {
    const grid = gridWrapRef.current as any;
    if (!grid) return;
    grid.measureInWindow((gx: number, gy: number) => {
      const next: Record<string, { x: number; y: number; w: number }> = {};
      let pending = 0;
      let finished = false;
      const done = () => { if (!finished) { finished = true; setCellGeom(next); } };
      for (const p of adjacentPairs) {
        for (const uid of [p.a, p.b]) {
          const v = seatViewRefs.current[uid] as any;
          if (!v) continue;
          pending++;
          v.measureInWindow((x: number, y: number, w: number) => {
            next[uid] = { x: x - gx, y: y - gy, w };
            if (--pending === 0) done();
          });
        }
      }
      if (pending === 0) done();
      setTimeout(done, 350); // never leave the layer unmeasured
    });
  }, [adjacentPairs]);
  useEffect(() => {
    const t1 = setTimeout(measureCells, 80);
    const t2 = setTimeout(measureCells, 450);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [measureCells, pairSig]);

  
  const [roomInfoOpen,    setRoomInfoOpen]    = useState(false);
  const [opHistOpen,      setOpHistOpen]      = useState(false);
  const [settingsOpen,    setSettingsOpen]    = useState(false);
  const [seatActionOpen,  setSeatActionOpen]  = useState(false);
  const [seatActionIdx,   setSeatActionIdx]   = useState(-1);
  const [invToSeatOpen,   setInvToSeatOpen]   = useState(false);
  const [invToSeatIdx,    setInvToSeatIdx]    = useState(-1);
  const [inviteOpen,      setInviteOpen]      = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [taskCenterOpen, setTaskCenterOpen] = useState(false);
  const [membersOpen,     setMembersOpen]     = useState(false);
  const [giftsOpen,       setGiftsOpen]       = useState(false);
  const [giftsRecipient,  setGiftsRecipient]  = useState<Participant | null>(null);
  // 2026-10-19 (IMO port): waiting queue + games + ranking + props
  const [seatQueueOpen,   setSeatQueueOpen]   = useState(false);
  const [gamesOpen,       setGamesOpen]       = useState(false);
  const [rankOpen,        setRankOpen]        = useState(false);
  const [propsOpen,       setPropsOpen]       = useState(false);
  // 2026-10-19 (IMO gap fill): announcement + intimacy + backpack
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [intimacyOpen,     setIntimacyOpen]     = useState(false);
  const [backpackOpen,     setBackpackOpen]     = useState(false);
  const [announcement,     setAnnouncement]     = useState<RoomAnnouncement | null>(null);
  const [gameNav,         setGameNav]         = useState<{ kind: GameType; gameId: string | null } | null>(null);
  const [activeMember,    setActiveMember]    = useState<Participant | null>(null);
  // 2026-10-19 (IMO gap fill): live room announcement banner.
  useEffect(() => {
    if (!roomId) {
      setAnnouncement(null);
      return;
    }
    return subscribeAnnouncement(roomId, setAnnouncement);
  }, [roomId]);
  useEffect(() => {
    if (!activeMember) return;
    const fresh =
      seats.find((s) => s?.id === activeMember.id) ??
      audience.find((a) => a.id === activeMember.id) ??
      null;
    if (!fresh) return;
    const changed =
      (fresh as any).activeFrame !== (activeMember as any).activeFrame ||
      fresh.name !== activeMember.name ||
      fresh.photoURL !== activeMember.photoURL ||
      fresh.role !== activeMember.role ||
      fresh.muted !== activeMember.muted ||
      fresh.speaking !== activeMember.speaking;
    if (changed) setActiveMember(fresh);
  }, [seats, audience, activeMember]);
  const [exitModalOpen,   setExitModalOpen]   = useState(false);
  const [emojiPanelOpen,  setEmojiPanelOpen]  = useState(false);

  
  const [myVId, setMyVId] = useState<string>('');
  useEffect(() => {
    if (!user?.uid) return;
    getUser(user.uid).then((profile) => { if (profile?.vId) setMyVId(profile.vId); }).catch(() => {});
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

  
  const [weekStart, setWeekStart] = useState<number>(() => getWeekStart());
  useEffect(() => {
    const ws = getWeekStart();
    if (ws > weekStart) { setWeekStart(ws); }
  }, [weekStart]);

  

  useEffect(() => {
    return subscribeRoomInfo(roomId, (info) => {
      if (!info || info.active === false) {
        if (!hasLeftRef.current) {
          hasLeftRef.current = true;
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
      pinInfoRef.current = { isPublic: info.isPublic, ownerId: info.ownerId, pinVersion: typeof info.pinVersion === 'number' ? info.pinVersion : 0, isLocked: info.isLocked };
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
      if (info.ownerId && info.ownerId === myUidRef.current) {
        const mySeatIdxNow = seatsRef.current.findIndex(
          (s: Participant | null) => s?.id === myUidRef.current,
        );
        const mySeatNow = mySeatIdxNow >= 0 ? seatsRef.current[mySeatIdxNow] : null;
        if (mySeatNow && mySeatNow.role !== 'host') {
          setSeatRole(roomId, mySeatIdxNow, 'host').catch(() => {});
        }
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
              });
            }).catch(() => {});
          }
        } catch {
        }
      }
      setRoomImageUri(info.coverImageUrl ?? null);
      setRoomIsPublic(info.isPublic);
      setRoomIsLocked(info.isLocked ?? false);
      setRoomDescription(info.description ?? '');
      // 2026-10-21 (boss): the room's saved theme APPLIES on entry —
      // themes are real color schemes now (exactly one black, the rest
      // light), so a chosen theme sticks. Unknown/removed ids fall back
      // to IMO Light. (Supersedes the 2026-10-20 force-light, which
      // existed only because every other theme was near-black.)
      if (info.themeId && info.themeId !== activeThemeIdRef.current) {
        const known = getActiveThemes().some((th) => th.id === info.themeId);
        const next = known ? info.themeId : 'imo-light';
        activeThemeIdRef.current = next;
        setActiveThemeId(next);
      }
      if (pinGateRef.current === 'passed') handleRoomInfoOk();
    });
  }, [roomId]);

  const forceLeftRef = useRef(false);
  useEffect(() => {
    if (!hasJoined || forceLeftRef.current) return;
    const myBlock = blockedRecs.find(
      (r: BlockRecord) => r.id === myUid && r.isActive && r.action === 'room-block',
    );
    if (!myBlock) return;
    forceLeftRef.current = true;
    hasLeftRef.current = true;
    try { stopPublishing(); } catch {  }
    try { stopUserStream(myUid); } catch {  }
    router.back();
    Alert.alert(
      t('voiceRoom.screen.removedTitle'),
      t('voiceRoom.screen.removedMsg'),
    );
  }, [blockedRecs, hasJoined, myUid, stopPublishing, stopUserStream, t]);

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
        isActive: true }));
      setBlockedRecs(records);
    });
  }, [roomId]);

  useEffect(() => {
    return subscribeSeatRequests(roomId, setPendingRequests);
  }, [roomId]);

  useEffect(() => {
    return subscribeSeats(roomId, (fbSeats) => {
      const mapped = fbSeats.map(seat =>
        seat ? fbSeatToParticipant(seat, speakingRef.current) : null,
      );
      // Perf guard (2026-10-22): heartbeat-only snapshots (60s seatTs
      // refreshes from every seated user) map to identical visible state —
      // skip the setState so the whole room screen doesn't re-render.
      const sig = mapped.map(s => (s
        ? `${s.id}|${s.role}|${s.muted ? 1 : 0}|${s.hostMuted ? 1 : 0}|${s.speaking ? 1 : 0}|${s.activeFrame ?? ''}|${s.name}|${s.photoURL ?? ''}|${s.nobleRankIndex ?? ''}`
        : '-')).join(';');
      if (sig === seatsSigRef.current) return;
      seatsSigRef.current = sig;
      setSeats(mapped);
    });
  }, [roomId]);

  useEffect(() => {
    return subscribeAudience(roomId, (fbAudience) => {
      const participants = fbAudience.map(fbAudToParticipant);
      // Perf guard (2026-10-22): same heartbeat-skip as seats above.
      const sig = participants.map(m =>
        `${m.id}|${m.role}|${m.name}|${m.photoURL ?? ''}|${m.activeFrame ?? ''}|${m.nobleRankIndex ?? ''}`,
      ).join(';');
      if (sig === audienceSigRef.current) return;
      audienceSigRef.current = sig;
      setAudience(participants);
    });
  }, [roomId]);

  useEffect(() => {
    return subscribeRoomAdmins(roomId, setRoomAdminUids);
  }, [roomId]);

  useEffect(() => {
    if (!roomId || !myUid) {
      setIsRoomMember(false);
      return;
    }
    const memberRef = ref(database, `roomMembers/${roomId}/${myUid}`);
    const unsub = onValue(memberRef, (snap) => {
      setIsRoomMember(snap.exists());
      if (snap.exists()) setHasJoined(true);
    }, () => {
      setIsRoomMember(false);
    });
    return () => unsub();
  }, [roomId, myUid]);

  useEffect(() => {
    return subscribeRoomChat(roomId, myUid, (fbMsgs) => {
      const cutoff = historyCutoffTsRef.current;
      const visible = cutoff > 0 ? fbMsgs.filter(m => (m.ts ?? 0) >= cutoff) : fbMsgs;
      const deliveredMsgs = visible.map(fbChatToMsg);
      // 2026-10-23: optimistic echoes — drop the ones this snapshot now
      // contains (same push key, so the delivered copy replaces them in
      // place) and keep the still-in-flight ones appended at the end.
      if (pendingEchoesRef.current.length > 0) {
        const deliveredIds = new Set(deliveredMsgs.map((m) => m.id));
        pendingEchoesRef.current = pendingEchoesRef.current.filter((e) => !deliveredIds.has(e.id));
      }
      const pending = pendingEchoesRef.current;
      setMessages(pending.length > 0 ? [...deliveredMsgs, ...pending] : deliveredMsgs);
      if (visible.length > 0) {
        setChatOldestKey(visible[0].id);
        setHasOlderMsgs(visible.length >= 50);
      }
      if (scrollTimerRef.current !== null) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        scrollTimerRef.current = null;
        chatRef.current?.scrollToEnd({ animated: false });
      }, 80);
    });
  }, [roomId, myUid]);

  useEffect(() => {
    if (!hasJoined) return;
    if (historyCleanTimerRef.current !== null) return; // already running
    const TEN_MIN = 10 * 60 * 1000;
    const clean = () => {
      setMessages((prev) => {
        if (prev.length <= 5) return prev;
        const keep = prev.slice(-5);
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

  
  useEffect(() => {
    if (hasSentEntryChatMsgRef.current) return;
    if (!roomId || !myUid || !myName) return;
    hasSentEntryChatMsgRef.current = true;
    const isOwner = ownerId && ownerId === myUid;
    const displayName = isOwner ? `${myName} 👑` : myName;
    // 2026-10-23 (boss: একই join লাইন বারবার): this effect used to send
    // on EVERY screen mount — the persisted 30-minute slot below is
    // now the single gate for both join-message send sites.
    void (async () => {
      if (!(await claimJoinMsgSlot(`${roomId}:${myUid}`))) return;
      sendRoomChatMsg(roomId, {
        senderId: 'system',
        senderName: 'System',
        senderColor: C.gold,
        text: t('voiceRoom.screen.joinedRoom', { name: displayName }),
        ts: Date.now() }).catch(() => {});
    })();
  }, [roomId, myUid, myName, ownerId, t]);

  
  const mySeatIdx = useMemo(
    () => seats.findIndex((s: Participant | null) => s?.id === myUid),
    [seats, myUid],
  );

  
  const mySeatIdxRef = useRef(mySeatIdx);
  useEffect(() => {
    mySeatIdxRef.current = mySeatIdx;
  }, [mySeatIdx]);

  useEffect(() => {
    sweepStaleSeats(roomId).catch(() => {});
    // 2026-10-20 (boss): ghost-audience sweep on enter (mirror of seats).
    sweepStaleAudience(roomId).catch(() => {});
  }, [roomId]);
  useEffect(() => {
    if (mySeatIdx < 0) return;
    const beat = () => refreshSeatHeartbeat(roomId, mySeatIdx, myUid).catch(() => {});
    beat(); // immediate first beat on seating
    const timer = setInterval(beat, 60_000);
    return () => clearInterval(timer);
  }, [roomId, mySeatIdx, myUid]);
  // 2026-10-20 (boss): audience heartbeat while inside the room — keeps my
  // audience entry provably live; if the app dies, the entry ages out in
  // 5 min and gets swept instead of showing a phantom member forever.
  // Transaction-guarded server-side: no entry (seated/left) = no-op.
  useEffect(() => {
    if (!myUid) return;
    const beat = () => refreshAudienceHeartbeat(roomId, myUid).catch(() => {});
    beat();
    const timer = setInterval(beat, 60_000);
    return () => clearInterval(timer);
  }, [roomId, myUid]);

  // 2026-10-22 (boss): BACKGROUND-FREEZE RECOVERY. Android (esp. Tecno/HiOS)
  // freezes the app while it sits in a voice room in the background: the JS
  // heartbeat timers stop and the LiveKit socket starves, so the server
  // drops the participant and VeeGuard sweeps the seat — the user comes back
  // to find himself thrown out of the room. On return to foreground:
  // refresh both heartbeats at once, re-register presence (restores the seat
  // when it was swept and the slot is still his/free; demotes to audience if
  // someone else took it), and auto-retry the voice connection when the
  // engine died while backgrounded — no dead Retry button left to find.
  const autoVoiceRetryAtRef = useRef(0);
  useEffect(() => {
    const recover = () => {
      if (hasLeftRef.current || !presenceReadyRef.current) return;
      if (mySeatIdxRef.current >= 0) {
        refreshSeatHeartbeat(roomId, mySeatIdxRef.current, myUid).catch(() => {});
      }
      refreshAudienceHeartbeat(roomId, myUid).catch(() => {});
      void reRegisterPresenceRef.current?.();
      if (!voiceJoinedRef.current && voiceErrorRef.current) {
        const now = Date.now();
        if (now - autoVoiceRetryAtRef.current > 15_000) {
          autoVoiceRetryAtRef.current = now;
          retryConnectionRef.current?.();
        }
      }
    };
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') recover();
    });
    return () => sub.remove();
  }, [roomId, myUid]);

  
  // 2026-10-24 (boss: mic must NEVER cycle off→on on return): when
  // returning from minimize, the minimized-room record already knows the
  // seat (and that the mic was ON). Capture it on mount — before the
  // focus effects clear the minimized record — so publishing can start
  // the moment voice joins, without waiting for the seats subscription
  // round-trip. Only when the mic was ON (muted === false); a muted
  // return keeps the normal seat-driven path so a muted mic never
  // leaks open. Safety: the seat-sync effect below stops publishing
  // the moment live seats show no seat (kicked while minimized).
  const [returningSeatIdx] = useState(() => {
    const prev = getMinimizedRoom();
    if (prev && prev.id === roomId && prev.mySeatIdx >= 0 && prev.muted === false) return prev.mySeatIdx;
    return -1;
  });

  // 2026-10-24 (boss: mic must actually open): seated + voice-connected +
  // not-publishing means publishing was skipped or died silently (seat-take
  // raced the LiveKit join, or a silent publish early-return). The old
  // one-shot ref fired a single startPublishing and never retried, leaving
  // a seat that showed unmuted with no mic track at all. Now every entry
  // into this state (re)starts publishing; the isPublishing guard stops
  // loops (a failed publish changes no dep, so this does not re-fire).
  // 2026-10-24 return fast-path: a returning seat (captured above) also
  // counts as seated, so the mic re-opens the instant voice joins.
  useEffect(() => {
    if (!voiceJoined || isPublishing) return;
    if (mySeatIdx < 0 && returningSeatIdx < 0) return;
    if (!hasJoined) setHasJoined(true);
    startPublishing();
  }, [voiceJoined, mySeatIdx, isPublishing, returningSeatIdx]);

  
  useEffect(() => {
    if (voiceBan) return;
    if (!hasJoined && ownerId && ownerId === myUid) {
      setHasJoined(true);
    }
  }, [hasJoined, ownerId, myUid, voiceBan]);

  
  const prevFbMutedRef = useRef<boolean | null>(null);
  const prevMySeatIdxRef = useRef<number>(-1);
  // 2026-10-24 (boss: host-mute must stick): host-mute enforcement.
  // myHostMuted comes from the seat's hostMuted flag (owner/admin only).
  // While it is true the member's own mic button CANNOT unmute them:
  // the engine is forced muted, and the toggle below refuses to flip it.
  // On host-unmute the engine falls back to the seat's own `muted` flag
  // (the member's self choice) — fail-closed, never a surprise unmute.
  const prevHostMutedRef = useRef<boolean | null>(null);
  const prevHostSeatIdxRef = useRef<number>(-1);
  useEffect(() => {
    if (mySeatIdx < 0) {
      prevHostMutedRef.current = null;
      prevHostSeatIdxRef.current = -1;
      return;
    }
    if (prevHostSeatIdxRef.current !== mySeatIdx) {
      prevHostMutedRef.current = null;
      prevHostSeatIdxRef.current = mySeatIdx;
    }
    const mySeat = seats[mySeatIdx];
    if (!mySeat || !isPublishing) return;
    const hostMuted = mySeat.hostMuted === true;
    if (prevHostMutedRef.current === hostMuted) return;
    prevHostMutedRef.current = hostMuted;
    setMicMuted(hostMuted ? true : (mySeat.muted ?? true));
  }, [seats, mySeatIdx, isPublishing]);
  useEffect(() => {
    if (mySeatIdx < 0) {
      prevFbMutedRef.current = null;
      prevMySeatIdxRef.current = -1;
      if (isPublishing) {
        stopPublishing();
      }
      return;
    }
    if (prevMySeatIdxRef.current !== mySeatIdx) {
      prevFbMutedRef.current = null;
      prevMySeatIdxRef.current = mySeatIdx;
    }
    const mySeat = seats[mySeatIdx];
    if (!mySeat) return;
    const fbMuted = mySeat.muted;
    if (!isPublishing) {
      prevFbMutedRef.current = null;
      return;
    }
    if (prevFbMutedRef.current === fbMuted) return; // no change
    prevFbMutedRef.current = fbMuted;
    // Host-mute wins: never let the self-mute sync unmute a host-muted mic.
    if (mySeat.hostMuted === true) return;
    setMicMuted(fbMuted);
  }, [seats, mySeatIdx, isPublishing]);

  
  useEffect(() => {
    if (!speakingUsers) return;
    setSeats((prev: Array<Participant | null>) => prev.map((s: Participant | null) => {
      if (!s || s.id === myUid) return s;
      const isSpeaking = speakingUsers[s.id] === true && !s.muted && !s.hostMuted;
      return isSpeaking !== s.speaking ? { ...s, speaking: isSpeaking } : s;
    }));
  }, [speakingUsers, myUid]);

  useEffect(() => {
    if (mySeatIdx < 0) return;
    setSeats((prev: Array<Participant | null>) => prev.map((s: Participant | null, i: number) => {
      if (i !== mySeatIdx || !s) return s;
      const effectiveSpeaking = localSpeaking && !muted;
      return s.speaking !== effectiveSpeaking ? { ...s, speaking: effectiveSpeaking } : s;
    }));
  }, [localSpeaking, mySeatIdx, muted]);

  
  useEffect(() => {
    if (!hasJoined) return;
    isUserBlockedInRoom(roomId, myUid).then((blocked) => {
      if (blocked) {
        Alert.alert(t('voiceRoom.screen.accessDenied'), t('voiceRoom.screen.accessDeniedMsg'));
        router.back();
      }
    }).catch(() => {});
  }, [hasJoined, roomId, myUid]);

  
  const hasLeftRef = useRef(false);
  const presenceReadyRef = useRef(false); // join effect finished
  const myNobleRankRef = useRef<number | undefined>(undefined);
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  // 2026-10-22 (boss): background-freeze recovery plumbing — the Firebase
  // reconnect effect publishes its presence re-register fn here so the
  // AppState foreground handler can restore presence after a freeze.
  const reRegisterPresenceRef = useRef<(() => Promise<void>) | null>(null);
  const voiceJoinedRef = useRef(false);
  useEffect(() => { voiceJoinedRef.current = voiceJoined; }, [voiceJoined]);
  const voiceErrorRef = useRef<string | null>(null);
  useEffect(() => { voiceErrorRef.current = voiceError; }, [voiceError]);
  const retryConnectionRef = useRef(retryConnection);
  useEffect(() => { retryConnectionRef.current = retryConnection; }, [retryConnection]);

  
  useEffect(() => {
    if (!roomId || !myUid || pinGate !== 'passed') return;
    hasLeftRef.current = false;
    let cancelled = false;

    (async () => {
      // 2026-10-21 (boss: voice room loads slowly): the noble-state read
      // and the block check are independent — they used to run one after
      // another (serial round trips). They now run together, and the
      // room-info re-read that followed them is gone: the room-info
      // subscription has already delivered it (pinInfoRef) before this
      // effect can run (it is gated on pinGate === 'passed').
      const [noble, blockSnap] = await Promise.all([
        (async () => {
          try {
            const { getNobleState } = await import('@/src/services/nobleService');
            return await getNobleState(myUid).catch(() => null);
          } catch { return null; }
        })(),
        get(ref(database, `roomBlocks/${roomId}/${myUid}`)).catch(() => null),
      ]);
      if (noble && !noble.lapsed) myNobleRankRef.current = noble.rankIndex;
      if (cancelled) return;
      // 2026-10-23 (boss: রুমে entry নিলে অন্যরা লেটে দেখে): publish
      // presence IMMEDIATELY — the join chain below (lock checks, seat
      // restore, previous-room cleanup) takes several round trips and
      // nobody should wait for it to become visible in the room. Only
      // when the room is known-unlocked from the already-delivered info;
      // a locked room keeps the gated path so a rejected user never
      // appears inside it.
      const earlyInfo = pinInfoRef.current;
      if (earlyInfo && earlyInfo.isLocked !== true) {
        joinRoomAsAudience(roomId, {
          userId: myUid,
          userName: myName,
          initials: myInitials,
          color: myColor,
          ...(myPhotoURL ? { photoURL: myPhotoURL } : {}),
          ...(myNobleRankRef.current != null ? { nobleRankIndex: myNobleRankRef.current } : {}),
        }).catch(() => {});
      }
      try {
        if (blockSnap?.exists()) return;
        const cachedInfo = pinInfoRef.current;
        const info = cachedInfo
          ? { isLocked: cachedInfo.isLocked, ownerId: cachedInfo.ownerId }
          : ((await get(ref(database, `rooms/${roomId}/info`))).val() as { isLocked?: boolean; ownerId?: string } | null);
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
      }
      if (cancelled) return;

      let finalSeatIdx = -1;
      if (isRestore) {
        try {
          const persisted = await getPersistedActiveRoom();
          if (persisted && persisted.roomId === roomId && persisted.myUid === myUid && persisted.mySeatIdx >= 0) {
            const seatSnap = await get(ref(database, `rooms/${roomId}/seats/${persisted.mySeatIdx}`)).catch(() => null);
            const curSeat = seatSnap?.val() as { userId?: string } | null;
            if (!curSeat || curSeat.userId === myUid) {
              const seatData = buildSeatData();
              const res = await takeSeat(roomId, persisted.mySeatIdx, seatData).catch(() => ({ success: false }));
              if (res && res.success) {
                finalSeatIdx = persisted.mySeatIdx;
                mySeatIdxRef.current = finalSeatIdx;
              }
            }
          }
        } catch {  }
      }
      if (cancelled) return;

      // 2026-10-22 FIX (boss: "একটা রুম থেকে আরেকটা রুমে গেলে আগের রুমে
      // আইডি থেকে যায়"): enforce ONE active room. Several in-app paths
      // (room-invite popup, leaderboard, profile) push this screen OVER an
      // already-open room — the covered screen stays mounted, so its
      // presence cleanup never runs and its heartbeats keep the old room's
      // seat/audience entries alive indefinitely. The minimized case is
      // handled on mount (above); this covers the still-open stacked case:
      // if the active-room tracker names a DIFFERENT room, leave it fully
      // (seat + audience) before joining this one. Both heartbeat writers
      // are transaction-guarded, so once removed here the old entries can
      // never resurrect.
      const prevActive = getCurrentRoom();
      if (prevActive && prevActive.id !== roomId) {
        if (prevActive.mySeatIdx >= 0) {
          removeSeat(prevActive.id, prevActive.mySeatIdx).catch(() => {});
        }
        leaveAudience(prevActive.id, prevActive.myUid || myUid).catch(() => {});
        clearCurrentRoom();
      }

      if (finalSeatIdx < 0) {
        joinRoomAsAudience(roomId, {
          userId: myUid,
          userName: myName,
          initials: myInitials,
          color: myColor,
          ...(myPhotoURL ? { photoURL: myPhotoURL } : {}),
          ...(myNobleRankRef.current != null ? { nobleRankIndex: myNobleRankRef.current } : {}) }).catch(() => {});
      }
      persistActiveRoom({ roomId, myUid, mySeatIdx: finalSeatIdx }).catch(() => {});
      setCurrentRoom({ id: roomId, myUid, mySeatIdx: finalSeatIdx });

      const joinKey = `${roomId}:${myUid}`;
      if (!isRestore && !hasSentEntryChatMsgRef.current && !sentJoinMsgKeys.has(joinKey)) {
        hasSentEntryChatMsgRef.current = true;
        // Single persisted gate (see claimJoinMsgSlot): one join line
        // per room per 30 minutes, across mounts AND app restarts.
        if (await claimJoinMsgSlot(joinKey)) {
          sendRoomChatMsg(roomId, {
            senderId: 'system',
            senderName: 'System',
            senderColor: C.gold,
            text: t('voiceRoom.screen.joinedRoom', { name: myName }),
            ts: Date.now() }).catch(() => {});
        }
      }
      presenceReadyRef.current = true;
    })();

    return () => {
      cancelled = true;
      if (hasLeftRef.current) return;
      hasLeftRef.current = true;
      if (mySeatIdxRef.current >= 0) {
        removeSeat(roomId, mySeatIdxRef.current).catch(() => {});
        leaveAudience(roomId, myUid).catch(() => {});
      } else {
        leaveAudience(roomId, myUid).catch(() => {});
        clearCurrentRoom();
      }
      clearPersistedActiveRoom().catch(() => {});
    };
  }, [roomId, myUid, pinGate]);

  
  useEffect(() => {
    if (!hasJoined) return;
    const connRef = ref(database, '.info/connected');
    let wasConnected = true;
    let disposed = false;
    const reRegisterPresence = async () => {
      if (disposed || hasLeftRef.current || !presenceReadyRef.current) return;
      // 2026-10-22: a superseded (stacked-under) room screen must not
      // resurrect its presence on reconnect — the user has moved on to a
      // different active room (see the one-active-room guard at join).
      const activeNow = getCurrentRoom();
      if (activeNow && activeNow.id !== roomId) return;
      try {
        const seatIdx = mySeatIdxRef.current;
        const audData = {
          userId: myUid,
          userName: myName,
          initials: myInitials,
          color: myColor,
          ...(myPhotoURL ? { photoURL: myPhotoURL } : {}),
          ...(myNobleRankRef.current != null ? { nobleRankIndex: myNobleRankRef.current } : {}) };
        if (seatIdx >= 0) {
          const seatSnap = await get(ref(database, `rooms/${roomId}/seats/${seatIdx}`)).catch(() => null);
          const cur = seatSnap?.val() as { userId?: string } | null;
          if (!cur || cur.userId === myUid) {
            const seatData = buildSeatData();
            seatData.muted = mutedRef.current;
            const seatRef = ref(database, `rooms/${roomId}/seats/${seatIdx}`);
            await set(seatRef, { ...seatData, seatTs: serverTimestamp() }).catch(() => {});
            // 2026-10-23 (boss: একটা আইডি দুই জায়গায়): this direct write
            // can resurrect a seat the user already left for another one
            // (the captured seatIdx went stale mid-reconnect) — clear any
            // OTHER seat of mine so I never appear twice.
            await clearOtherSeats(roomId, myUid, seatIdx).catch(() => {});
            // 2026-10-22 ROOT FIX: deliberately NO onDisconnect re-arm —
            // socket drops must never delete a live user's seat again
            // (see firebaseRoomService takeSeat note).
            persistActiveRoom({ roomId, myUid, mySeatIdx: seatIdx }).catch(() => {});
          } else {
            mySeatIdxRef.current = -1;
            setCurrentRoom({ id: roomId, myUid, mySeatIdx: -1 });
            persistActiveRoom({ roomId, myUid, mySeatIdx: -1 }).catch(() => {});
            await joinRoomAsAudience(roomId, audData).catch(() => {});
          }
        } else {
          await joinRoomAsAudience(roomId, audData).catch(() => {});
        }
      } catch {  }
    };
    reRegisterPresenceRef.current = reRegisterPresence;
    const unsub = onValue(connRef, (snap) => {
      const connected = snap.val() === true;
      if (!connected) { wasConnected = false; return; }
      if (!wasConnected) {
        wasConnected = true;
        void reRegisterPresence();
      }
    });
    return () => { disposed = true; unsub(); };
  }, [hasJoined, roomId]);

  
  useEffect(() => {
    return () => {
      if (scrollTimerRef.current !== null) {
        clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
    };
  }, []);

  

  const seatMembers = useMemo(() => seats.filter((s: Participant | null): s is Participant => s !== null), [seats]);
  const allMembers  = useMemo(() => {
    const map = new Map<string, Participant>();
    for (const p of [...seatMembers, ...audience]) {
      if (!map.has(p.id)) map.set(p.id, p);
    }
    return [...map.values()];
  }, [seatMembers, audience]);

  const myRole: Role = useMemo(() => {
    // 2026-10-22 (boss): role resolution order FIXED. The old code read
    // ONLY seat/audience labels — and the audience label was wiped on
    // every join (role-less set), so admins lost their powers on each
    // rejoin until the server guard healed the label. The registry
    // (rooms/{id}/admins) is what the security rules check, so it now
    // outranks every label: owner → registry admin → seat label →
    // audience label → member.
    if (ownerId && ownerId === myUid) return 'host';
    if (roomAdminUids.has(myUid)) return 'admin';
    const mySeat = seats.find((s: Participant | null) => s?.id === myUid);
    if (mySeat?.role === 'host' || mySeat?.role === 'admin') return mySeat.role;
    const myAud = audience.find((m: Participant) => m.id === myUid);
    if (myAud?.role === 'admin') return 'admin';
    if (mySeat?.role) return mySeat.role;
    return 'member';
  }, [seats, audience, myUid, ownerId, roomAdminUids]);

  const isOwnerOrAdmin = myRole === 'host' || myRole === 'admin';

  // 2026-10-22 (boss): one-time battery-exemption ask. Aggressive OEM power
  // managers kill backgrounded apps even with a foreground service — the
  // root of "app dies in background, voice/call disconnects". Ask ONCE
  // (AsyncStorage-gated) after the user actually joins a room; the system
  // dialog itself is opened by the native module.
  const batteryPromptDoneRef = useRef(false);
  useEffect(() => {
    if (!hasJoined || Platform.OS !== 'android' || batteryPromptDoneRef.current) return;
    batteryPromptDoneRef.current = true;
    (async () => {
      try {
        const asked = await AsyncStorage.getItem('vee_battery_prompt_v1');
        if (asked) return;
        if (await isBatteryExempt()) {
          await AsyncStorage.setItem('vee_battery_prompt_v1', 'exempt');
          return;
        }
        await AsyncStorage.setItem('vee_battery_prompt_v1', 'asked');
        Alert.alert(
          'Keep voice alive',
          'Allow Vee to run without battery restrictions so your voice room or call never disconnects when the screen is off or the app is in the background.',
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Allow', onPress: () => requestBatteryExemption() },
          ],
        );
      } catch { /* non-critical */ }
    })();
  }, [hasJoined]);

  const myRoleLevel: number = useMemo(() => roleToLevel(myRole), [myRole]);

  const showJoinBanner = !isRoomMember && !hasJoined && !isOwnerOrAdmin && mySeatIdx < 0;

  const seatActionMember = seatActionIdx >= 0 ? seats[seatActionIdx] ?? null : null;

  
  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return allMembers
      .filter((m: Participant) => m.id !== myUid)
      .filter((m: Participant) => !q || m.name.toLowerCase().startsWith(q));
  }, [mentionQuery, allMembers, myUid]);

  
  const handleChatInput = useCallback((text: string) => {
    setChatInput(text);
    const match = text.match(/@(\w*)$/);
    if (match) {
      setMentionQuery(match[1] ?? '');
    } else {
      setMentionQuery(null);
    }
  }, []);

  
  const handleSelectMention = useCallback((memberName: string) => {
    setChatInput((prev: string) => prev.replace(/@\w*$/, `@${memberName} `));
    setMentionQuery(null);
  }, []);

  

  const toggleMic = useCallback(() => {
    if (mySeatIdx < 0) return;
    // 2026-10-24 (boss: host-mute must stick): a host-muted member's own
    // mic button must NOT unmute them — previously this tap flipped the
    // engine AND overwrote the host's mute in RTDB (setSeatMute false),
    // which is exactly how members unmuted themselves. Refuse the tap
    // (and never write the seat) while hostMuted is set.
    if (seats[mySeatIdx]?.hostMuted === true) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert(
        t('voiceRoom.screen.micHostMutedTitle', { defaultValue: 'Muted by host' }),
        t('voiceRoom.screen.micHostMutedMsg', { defaultValue: 'The room owner or an admin muted you on this seat. Only they can unmute you.' }),
      );
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (!isPublishing) {
      // 2026-10-24 (boss order: NO dialog, big-app behaviour): a tap while
      // voice isn't connected silently retries the connection — when it
      // comes up, the auto-publish effect opens the mic on its own.
      if (!voiceJoined) {
        retryConnection();
        return;
      }
      startPublishing();
      return;
    }

    const newMuted = engineToggleMic(); // single source of truth — never `!muted`
    setSeats(prev => prev.map((s, i) =>
      i === mySeatIdx && s ? { ...s, muted: newMuted } : s,
    ));
    setSeatMute(roomId, mySeatIdx, newMuted).catch(() => {});
  }, [engineToggleMic, startPublishing, isPublishing, mySeatIdx, roomId, seats, t, voiceJoined, retryConnection]);

  const toggleSpeaker = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    engineToggleSpeaker();
  }, [engineToggleSpeaker]);

  const handleSeatPress = useCallback((seatIdx: number) => {
    const member = seatsRef.current[seatIdx];
    if (member && member.id === myUid) { setActiveMember(member); return; }
    if (!isOwnerOrAdmin) {
      if (member && member.id !== myUid) { setActiveMember(member); return; }
      if (!member) {
        // HOST SEAT (2026-10-22, Sumon): seat 1 is host/admin only —
        // members get a clear message, never a request or a seat.
        if (seatIdx === 0) {
          Alert.alert(
            t('voiceRoom.screen.hostSeatTitle'),
            t('voiceRoom.screen.hostSeatMsg'),
          );
          return;
        }
        if (lockedSeats.has(seatIdx)) {
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
                      hostId: ownerId || myUid });
                    Alert.alert(
                      t('voiceRoom.screen.requestSentTitle'),
                      t('voiceRoom.screen.requestSentMsg'),
                    );
                  } catch {
                    Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.screen.requestError'));
                  }
                } },
              { text: t('voiceRoom.screen.cancel'), style: 'cancel' },
            ],
          );
          return;
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        joinSeat(seatIdx);
      }
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSeatActionIdx(seatIdx);
    setSeatActionOpen(true);
  }, [isOwnerOrAdmin, myUid, lockedSeats, roomId, myName, myInitials, myColor, ownerId, t]);

  const seatPressHandlers = useMemo(() => {
    const map: Array<() => void> = [];
    for (let i = 0; i < 10; i += 1) map[i] = () => handleSeatPress(i);
    return map;
  }, [handleSeatPress]);

  // 2026-10-24 (boss: host-mute must stick + owner can mute admin):
  // host/admin mute now writes ONLY the hostMuted flag — never the
  // member's own `muted` — so the member's mic button can no longer
  // overwrite it. The sheet gates this action (canManage, plus the
  // explicit owner→admin carve-out, mirroring Down).
  const muteToggleMember = useCallback((memberId: string) => {
    const seatIdx = seats.findIndex((s: Participant | null) => s?.id === memberId);
    const seat = seatIdx >= 0 ? seats[seatIdx] : null;
    if (!seat || seatIdx < 0) return;
    const prevHostMuted = seat.hostMuted ?? false;
    const newHostMuted = !prevHostMuted;
    if (newHostMuted) muteRemoteUser(memberId);
    else playUserStream(memberId);
    setSeats((prev: Array<Participant | null>) => prev.map((s: Participant | null, i: number) =>
      (i === seatIdx && s ? { ...s, hostMuted: newHostMuted } : s),
    ));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSeatHostMute(roomId, seatIdx, newHostMuted).catch((e: unknown) => {
      setSeats((prev: Array<Participant | null>) => prev.map((s: Participant | null, i: number) =>
        (i === seatIdx && s ? { ...s, hostMuted: prevHostMuted } : s),
      ));
      if (newHostMuted) playUserStream(memberId);
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
    fbLeaveSeat(roomId, seatIdx, member.id, {
      userId: member.id,
      userName: member.name,
      initials: member.initials,
      color: member.color,
      ...(member.photoURL ? { photoURL: member.photoURL } : {}),
      ...(member.role && member.role !== 'host' ? { role: member.role } : {}) }).then(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }).catch((e: unknown) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        t('voiceRoom.screen.error'),
        t('voiceRoom.screen.muteFailedWithCause', { cause: getErrorCause(e) }),
      );
    });
  }, [seats, myUid, roomId, stopPublishing, stopUserStream, t]);

  const buildSeatData = useCallback((): NonNullable<RoomSeat> => {
    const seatRole: Role = (ownerId && ownerId === myUid) ? 'host' : myRole;
    // 2026-10-24 (boss concept: free speech by default): a seat take starts
    // UNMUTED — everyone speaks freely first. Only a SELF-chosen mute
    // carries across a seat switch; a HOST mute never carries, because it
    // binds to the old seat only — switching to another (unlocked) seat
    // frees the user to talk again.
    const wasHostMuted = mySeatIdx >= 0 && seats[mySeatIdx]?.hostMuted === true;
    return {
      userId: myUid,
      userName: myName,
      initials: myInitials,
      color: myColor,
      ...(myPhotoURL ? { photoURL: myPhotoURL } : {}),
      ...((myProfile as any)?.activeFrame ? { activeFrame: (myProfile as any).activeFrame } : {}),
      ...((myProfile as any)?.activeRipple ? { activeRipple: (myProfile as any).activeRipple } : {}),
      ...((myProfile as any)?.activeEntryEffect ? { activeEntryEffect: (myProfile as any).activeEntryEffect } : {}),
      ...((myProfile as any)?.activeNameplate ? { activeNameplate: (myProfile as any).activeNameplate } : {}),
      ...(myVerified ? { verified: true } : {}),
      muted: mySeatIdx >= 0 && !wasHostMuted ? muted : false,
      role: seatRole,
      ...(myNobleRankRef.current != null ? { nobleRankIndex: myNobleRankRef.current } : {}) };
  }, [myUid, myName, myInitials, myColor, myPhotoURL, myProfile, myVerified, myRole, ownerId, mySeatIdx, muted, seats]);

  const joinSeat = useCallback(async (seatIdx: number) => {
    if (mySeatIdx === seatIdx) return;
    // HOST SEAT (2026-10-22, Sumon): seat 1 is reserved for owner/admins —
    // backstop guard for every joinSeat path (mic bar, invites, restores);
    // the service layer enforces the same rule authoritatively.
    if (seatIdx === 0 && !isOwnerOrAdmin) {
      Alert.alert(
        t('voiceRoom.screen.hostSeatTitle'),
        t('voiceRoom.screen.hostSeatMsg'),
      );
      return;
    }
    const target = seats[seatIdx];
    if (target && target.id !== myUid) {
      Alert.alert(t('voiceRoom.screen.seatOccupied'), t('voiceRoom.screen.seatOccupiedFirst'));
      return;
    }

    const seatData: NonNullable<RoomSeat> = buildSeatData();

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

    const oldIdx = mySeatIdxRef.current;
    mySeatIdxRef.current = seatIdx;
    setCurrentRoom({ id: roomId, myUid, mySeatIdx: seatIdx });
    persistActiveRoom({ roomId, myUid, mySeatIdx: seatIdx }).catch(() => {});
    if (oldIdx >= 0 && oldIdx !== seatIdx) {
      removeSeat(roomId, oldIdx).catch(() => {});
    } else if (oldIdx < 0) {
      startPublishing();
      // 2026-10-24 (boss concept): audience → seat starts UNMUTED — the old
      // setMicMuted(true) here is exactly what auto-muted every seat take.
      setMicMuted(false);
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [seats, myUid, myName, myInitials, myColor, myRole, mySeatIdx, roomId, startPublishing, muted, t, buildSeatData, isOwnerOrAdmin]);

  
  const handleMicBarPress = useCallback(() => {
    if (mySeatIdx >= 0) {
      toggleMic();
      return;
    }
    const firstAvail = seats.findIndex(
      (s: Participant | null, idx: number) =>
        !s && !lockedSeats.has(idx) && (idx !== 0 || isOwnerOrAdmin),
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
  }, [mySeatIdx, toggleMic, seats, lockedSeats, joinSeat, t, isOwnerOrAdmin]);

  useEffect(() => {
    if (!roomId) return;
    const unsub = subscribeLockedSeats(roomId, setLockedSeats);
    return unsub;
  }, [roomId]);

  const lockSeat = useCallback((seatIdx: number) => {
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
    const writes: Array<Promise<unknown>> = [];
    if (seatIdx >= 0) {
      writes.push(setSeatRole(roomId, seatIdx, 'admin'));
    }
    const inAudience = audience.find((m: Participant) => m.id === memberId);
    if (inAudience) {
      writes.push(setAudienceRole(roomId, memberId, 'admin'));
    }
    writes.push(grantRoomAdmin(roomId, memberId));
    writes.push(
      update(ref(database), { [`roomMembers/${roomId}/${memberId}/role`]: 'admin' }).catch(() => {
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
    writes.push(
      update(ref(database), { [`roomMembers/${roomId}/${memberId}/role`]: 'member' }).catch(() => {
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

  /** SVIP kick-out privilege state (checked once per room session). */
  const [canSvipKickOut, setCanSvipKickOut] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getActiveSvipTier } = await import('@/src/features/svip/svipKickService');
        const tier = await getActiveSvipTier(myUid);
        if (!cancelled) setCanSvipKickOut(tier >= 3);
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [myUid, roomId]);

  /** SVIP kick-out: spends points, enforces hierarchy + anti-kick. */
  const svipKickOut = useCallback((memberId: string) => {
    const inSeat = seats.find((s: Participant | null) => s?.id === memberId);
    const seatIdx = inSeat ? seats.findIndex((s: Participant | null) => s?.id === memberId) : -1;
    (async () => {
      try {
        const { svipKickUser } = await import('@/src/features/svip/svipKickService');
        const res = await svipKickUser(roomId, myUid, memberId, seatIdx);
        if (res.ok) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert('Kicked', 'User removed from the room.');
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          Alert.alert(t('voiceRoom.screen.error'), res.message);
        }
      } catch (e) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert(t('voiceRoom.screen.error'), getErrorCause(e));
      }
    })();
  }, [seats, roomId, myUid, t]);

  const blockUser = useCallback((memberId: string, action: 'room-block' | 'comment-block') => {
    const inSeat = seats.find((s: Participant | null) => s?.id === memberId);
    const inAud  = audience.find((m: Participant) => m.id === memberId);
    const member = inSeat ?? inAud;
    if (!member) return;

    const doBlockUser = () => {
    const demoteUid = action === 'room-block' && member.role === 'admin' ? memberId : undefined;

    const kick = (async () => {
      if (action === 'room-block') {
        const ops: Array<Promise<unknown>> = [];
        if (inSeat) {
          const seatIdx = seats.findIndex((s: Participant | null) => s?.id === memberId);
          ops.push(removeSeat(roomId, seatIdx, demoteUid));
        }
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
      action };

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
    };

    // SVIP anti-kick (IMO: "Cannot block the user due to SVIP anti-kick privilege").
    // Checked async before any removal; higher-tier blockers overrule.
    (async () => {
      try {
        const { isAntiKickProtected } = await import('@/src/features/svip/svipKickService');
        if (await isAntiKickProtected(myUid, memberId)) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          Alert.alert(
            t('voiceRoom.screen.error'),
            'Cannot block this user due to SVIP anti-kick privilege.',
          );
          return;
        }
      } catch { /* non-critical — proceed with block attempt */ }
      doBlockUser();
    })();
  }, [seats, audience, roomId, myUid, myName, t]);

  const unblockUser = useCallback((userId: string) => {
    const record = blockedRecs.find((r: BlockRecord) => r.id === userId && r.isActive);
    if (!record) return;
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
            sendSeatInvite(member.id, {
              roomId, roomName, seatIdx,
              inviterUid: myUid, inviterName: myName,
              ts: Date.now() }).then(() => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }).catch(() => {
              Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.screen.inviteSendError'));
            });
          } },
        { text: t('voiceRoom.screen.cancel'), style: 'cancel' },
      ],
    );
  }, [audience, seats, roomId, roomName, myUid, myName, t]);

  const handleLeave = useCallback(() => {
    hasLeftRef.current = true;
    try {
      clearPersistedActiveRoom().catch(() => {});
      sentJoinMsgKeys.delete(`${roomId}:${myUid}`);

      // 2026-10-22 FIX (boss): voluntary exit removes PRESENCE ONLY — never
      // the admin grant (see the minimized-room cleanup above). Demotion is
      // reserved for owner dismiss / kick / block of that user.
      if (mySeatIdx >= 0) {
        try { stopPublishing(); } catch {  }
        removeSeat(roomId, mySeatIdx).catch(() => {});
        leaveAudience(roomId, myUid).catch(() => {});
      } else if (hasJoined) {
        leaveAudience(roomId, myUid).catch(() => {});
      }
    } finally {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      setExitModalOpen(false);
      if (router.canGoBack()) router.back();
      else router.replace('/home');
    }
  }, [mySeatIdx, hasJoined, myUid, myRole, seats, audience, roomId, stopPublishing]);

  const handleMinimize = useCallback(() => {
    hasLeftRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setVoiceRoomMinimized(true);
    setMinimizedRoom({
      id:       roomId,
      name:     roomName,
      topic:    roomTopic,
      myUid,
      mySeatIdx,
      muted,
      role:     myRole,
      ...(roomImageUri ? { coverImageUrl: roomImageUri } : {}) });
    setExitModalOpen(false);
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, [roomId, roomName, roomTopic, myUid, mySeatIdx, muted, myRole, roomImageUri]);

  useEffect(() => {
    const onBackPress = () => {
      handleMinimize();
      return true; // prevent default back behavior
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [handleMinimize]);

  const sendingMsgRef = useRef(false);

  // 2026-10-23 (Sumon: room sends must be SUPER FAST): optimistic send.
  // The old handler awaited TWO network round trips (block-check read,
  // then the write) before the sender saw their own message, and a 1.5 s
  // per-room lock silently swallowed quick follow-up messages. Now the
  // message renders instantly as an echo under its final push key, the
  // input clears immediately, the write happens in the background, and
  // only a 300 ms anti-double-tap window remains.
  const sendMessage = useCallback(() => {
    const text = chatInput.trim();
    if (!text || sendingMsgRef.current) return;
    const now = Date.now();
    const lastSent = lastChatSendAt.get(roomId) ?? 0;
    if (now - lastSent < 300) return;
    if (amChatBlocked) {
      Alert.alert(
        t('voiceRoom.screen.blockedTitle'),
        t('voiceRoom.screen.commentBlockedMsg'),
      );
      return;
    }
    lastChatSendAt.set(roomId, now);
    sendingMsgRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const id = createRoomChatKey(roomId);
    const payload: Omit<RoomChatMsg, 'id' | 'isMe'> = {
      senderId: myUid,
      senderName: myName,
      senderColor: myColor,
      text,
      ts: now,
      ...(replyingTo ? { replyTo: { sender: replyingTo.sender, text: replyingTo.text, color: replyingTo.color } } : {}),
    };
    const echo = fbChatToMsg({ ...payload, id, isMe: true });
    pendingEchoesRef.current = [...pendingEchoesRef.current, echo];
    setMessages((prev: ChatMsg[]) => [...prev, echo]);
    setChatInput('');
    setReplyingTo(null);
    setMentionQuery(null);
    if (scrollTimerRef.current !== null) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      scrollTimerRef.current = null;
      chatRef.current?.scrollToEnd({ animated: true });
    }, 80);
    sendRoomChatMsg(roomId, payload, id).catch((err) => {
      // Write failed — pull the echo back; restore the typed text if the
      // box is still empty so nothing the user wrote is lost.
      pendingEchoesRef.current = pendingEchoesRef.current.filter((e) => e.id !== id);
      setMessages((prev: ChatMsg[]) => prev.filter((m) => m.id !== id));
      if (err instanceof Error && err.message === 'blocked') {
        Alert.alert(
          t('voiceRoom.screen.blockedTitle'),
          t('voiceRoom.screen.commentBlockedMsg'),
        );
      } else {
        setChatInput((cur: string) => (cur ? cur : text));
      }
    });
    sendingMsgRef.current = false;
  }, [chatInput, replyingTo, roomId, myUid, myName, myColor, t, amChatBlocked]);

  const handleMention  = useCallback((name: string) => { setChatInput((prev: string) => `@${name} ${prev}`); }, []);

  const handleJoinRoom = useCallback(() => {
    setHasJoined(true);
    setIsRoomMember(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (roomId && myUid) {
      // 2026-10-20 FIX (boss): re-joining must not downgrade an existing
      // owner/admin role or reset the original joinedAt — read the current
      // record first and merge (same rule as recordUserRoomVisit).
      const memberRef = ref(database, `roomMembers/${roomId}/${myUid}`);
      get(memberRef)
        .then((snap) => {
          const existing = (snap.val() ?? null) as { role?: string; joinedAt?: number } | null;
          const keepRole = existing?.role === 'owner' || existing?.role === 'admin';
          const joinedAt = typeof existing?.joinedAt === 'number' && existing.joinedAt > 0 ? existing.joinedAt : Date.now();
          const role = keepRole ? (existing!.role as string) : 'member';
          set(memberRef, {
            role,
            joinedAt,
            name: myName,
          }).catch(() => {});
          const userRoomRef = ref(database, `userRooms/${myUid}/${roomId}`);
          set(userRoomRef, {
            joinedAt,
            role,
          }).catch(() => {});
        })
        .catch(() => {});
      joinRoomAsAudience(roomId, {
        userId: myUid,
        userName: myName,
        initials: myInitials,
        color: myColor,
        ...(myPhotoURL ? { photoURL: myPhotoURL } : {}),
        ...(myNobleRankRef.current != null ? { nobleRankIndex: myNobleRankRef.current } : {}),
      }).catch(() => {});
    }
  }, [roomId, myUid, myName, myInitials, myColor, myPhotoURL]);

  
  const handleDisband = useCallback(async () => {
    hasLeftRef.current = true;
    stopPublishing();
    try {
      await disbandRoom(roomId);
    } catch {
      Alert.alert('Disband failed', 'Could not delete the room. Please try again.');
      hasLeftRef.current = false;
      return;
    }
    router.back();
  }, [roomId, stopPublishing]);

  // 2026-10-21 (boss: "ক্লিক করার সাথে সাথেই গিফট টা প্লে হতে থাকে"): the
  // local fullscreen show ONLY — GiftsModal fires this the moment Send is
  // tapped (balance pre-check passed), while the wallet sends run in
  // parallel. The room-visible records live in handleGiftSent below and
  // still wait for the sends to succeed.
  const handleGiftPlay = useCallback((info: GiftSentInfo) => {
    const fly = (toUid: string, toName: string, toAvatar: string | undefined, target: { x: number; y: number } | null) => {
      giftFlyRef.current?.playFly({
        fromName: info.senderName,
        fromAvatar: info.senderAvatar,
        toUid, toName, toAvatar,
        giftId: info.giftId,
        emoji: info.emoji,
        coins: info.coins,
        target,
      animationUrl: info.animationUrl,
      animationType: info.animationType,
      thumbnailUrl: info.thumbnailUrl,
      videoSize: info.videoSize,
      videoFullscreen: info.videoFullscreen});
    };
    for (const r of info.recipients) {
      try {
        const v = seatViewRefs.current[r.uid];
        if (v) {
          v.measureInWindow((x, y, w, h) => fly(r.uid, r.name, r.photoURL, { x: x + w / 2, y: y + h / 2 }));
        } else {
          fly(r.uid, r.name, r.photoURL, null); // recipient not on a seat → top-center fallback
        }
      } catch {
        fly(r.uid, r.name, r.photoURL, null);
      }
    }
  }, []);

  const handleGiftSent = useCallback((info: GiftSentInfo) => {
    // 2026-10-23 (Sumon picked Option A): structured gift message — the chat
    // renders a highlight gift card (sender DP → gift thumb → receiver DP +
    // diamonds) from `gift`. `text` stays as the plain fallback for older
    // clients and satisfies the chat rules (text + ts are required).
    const quantity = info.quantity && info.quantity > 0 ? info.quantity : 1;
    const totalCoins = info.coins * quantity * Math.max(1, info.recipients.length);
    const thumb = info.thumbnailUrl || (info.emoji && info.emoji.startsWith('http') ? info.emoji : null);
    sendRoomChatMsg(roomId, {
      senderId: myUid,
      senderName: myName,
      senderColor: myColor,
      text: t('voiceRoom.screen.sentGift', { emoji: info.giftName || info.emoji, names: info.recipients.map((r) => r.name).join(', '), coins: totalCoins }),
      kind: 'gift',
      gift: {
        giftId: info.giftId,
        giftName: info.giftName || info.giftId,
        thumbnailUrl: thumb,
        coins: info.coins,
        quantity,
        totalCoins,
        senderAvatar: info.senderAvatar || null,
        recipients: info.recipients.map((r) => ({ uid: r.uid, name: r.name, photoURL: r.photoURL || null })),
      },
      ts: Date.now() }).catch(() => {});

    for (const r of info.recipients) {
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
      animationUrl: info.animationUrl || null,
      animationType: info.animationType || null,
      thumbnailUrl: thumb || null,
      videoSize: info.videoSize || null,
      videoFullscreen: info.videoFullscreen || null }).catch(() => {});
    }
  }, [roomId, myUid, myName, myColor, t]);

  const sendEmojiReaction = useCallback((emoji: string) => {
    setEmojiPanelOpen(false);
    const now = Date.now();
    // 2026-10-23 (Sumon: super-fast): perform MY OWN seat reaction
    // locally, instantly — it used to wait for the RTDB round trip. The
    // subscription copy is recognised and skipped (see the reaction
    // subscription). Only when I'm actually seated, like the remote path.
    if (seatsRef.current.some((m) => m && m.id === myUid)) {
      lastLocalReactionRef.current = { emoji, at: now };
      lastReactionTsRef.current = now;
      setSeatReactions((prev: Record<string, SeatReaction>) => ({
        ...prev, [myUid]: { emoji, key: now } }));
      const old = reactionTimersRef.current[myUid];
      if (old) clearTimeout(old);
      reactionTimersRef.current[myUid] = setTimeout(() => {
        setSeatReactions((prev: Record<string, SeatReaction>) => {
          if (prev[myUid]?.key !== now) return prev;
          const n = { ...prev }; delete n[myUid]; return n;
        });
      }, 3350);
    }
    sendRoomEmojiReaction(roomId, { emoji, byUid: myUid, byName: myName }).catch(() => {});
    // Chat bubble/sticker: same optimistic echo as text messages.
    const id = createRoomChatKey(roomId);
    const payload: Omit<RoomChatMsg, 'id' | 'isMe'> = {
      senderId: myUid,
      senderName: myName,
      senderColor: myColor,
      text: emoji,
      ts: now,
    };
    const echo = fbChatToMsg({ ...payload, id, isMe: true });
    pendingEchoesRef.current = [...pendingEchoesRef.current, echo];
    setMessages((prev: ChatMsg[]) => [...prev, echo]);
    sendRoomChatMsg(roomId, payload, id).catch(() => {
      pendingEchoesRef.current = pendingEchoesRef.current.filter((e) => e.id !== id);
      setMessages((prev: ChatMsg[]) => prev.filter((m) => m.id !== id));
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [roomId, myUid, myName, myColor]);

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
    } catch {  }
    setLoadingOlderMsgs(false);
  }, [chatOldestKey, loadingOlderMsgs, hasOlderMsgs, roomId, myUid]);

  const handleViewOtherProfile = useCallback((uid: string, name: string) => {
    router.push({ pathname: '/user-profile', params: { uid, name } } as Parameters<typeof router.push>[0]);
  }, []);

  const renderChatMessage = useCallback(
    ({ item }: { item: ChatMsg }) => (
      <RoomChatMessage item={item} accentColor={accentColor} onReply={setReplyingTo} onAction={setActionMsg} />
    ),
    [accentColor],
  );

  
  const bottomPad  = Math.max(insets.bottom, Platform.OS === 'web' ? 20 : 8) + 14;
  // 2026-10-22 (Sumon): bottom-bar labels removed → bar content is now
  // 50dp (was 68 with the label row); the freed ~18dp goes to chat/seats.
  const BOTTOM_BAR_H = bottomPad + 4 + 50;

  
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const onShow = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardOpen(true);
      setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 120);
    });
    const onHide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => { onShow.remove(); onHide.remove(); };
  }, []);

  
  if (banCheckDone && voiceBan) {
    const handleBanBack = () => {
      try {
        clearCurrentRoom();
        if (router.canGoBack()) router.back();
        else router.replace('/home');
      } catch {
        try { router.replace('/home'); } catch {}
      }
    };
    const untilText = voiceBan.bannedUntil
      ? new Date(voiceBan.bannedUntil).toLocaleDateString()
      : t('voiceRoom.ban.permanent', { defaultValue: 'Permanent' });
    return (
      <View style={{ flex: 1, backgroundColor: themeBg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
        <View style={{
          width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center',
          backgroundColor: 'rgba(239,68,68,0.12)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', marginBottom: 20,
        }}>
          <Feather name="slash" size={40} color="#EF4444" />
        </View>
        <Text style={{ color: themeOnBg, fontSize: 20, fontWeight: '900', textAlign: 'center', marginBottom: 8 }}>
          {t('voiceRoom.ban.title', { defaultValue: 'Voice rooms unavailable' })}
        </Text>
        <Text style={{ color: themeOnBgSub, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 16 }}>
          {t('voiceRoom.ban.message', { defaultValue: 'Your access to voice rooms has been restricted.' })}
        </Text>
        <View style={{
          backgroundColor: C.card, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12,
          borderWidth: 1, borderColor: C.borderFaint, marginBottom: 8, minWidth: 240,
        }}>
          <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>
            {t('voiceRoom.ban.reason', { defaultValue: 'Reason' })}
          </Text>
          <Text style={{ color: C.text, fontSize: 14, fontWeight: '700', marginBottom: 10 }}>
            {voiceBan.reason}
          </Text>
          <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>
            {t('voiceRoom.ban.until', { defaultValue: 'Restricted until' })}
          </Text>
          <Text style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>
            {untilText}
          </Text>
        </View>
        <Text style={{ color: themeOnBgSub, fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 8, marginBottom: 24 }}>
          {t('voiceRoom.ban.note', { defaultValue: 'You can still use the rest of the app. Contact support if you believe this is a mistake.' })}
        </Text>
        <Pressable
          onPress={handleBanBack}
          style={{ backgroundColor: '#E3F2FD', borderRadius: 14, paddingHorizontal: 32, paddingVertical: 12 }}
        >
          <Text style={{ color: '#007AFF', fontSize: 15, fontWeight: '800' }}>
            {t('voiceRoom.ban.back', { defaultValue: 'Go Back' })}
          </Text>
        </Pressable>
      </View>
    );
  }
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: themeBg }}
      behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
      // 2026-10-23 (Sumon bug): after a theme change (Settings modal +
      // keyboard cycles over the room), Android KAV kept a phantom
      // paddingBottom — the whole room lifted and a white strip showed
      // under the bottom bar (the navigator's white content background).
      // On Android the window is adjustPan, so the OS itself keeps the
      // focused input visible; KAV is only allowed to pad while OUR OWN
      // keyboardDidShow/Hide ground truth says the keyboard is open.
      // Keyboard closed ⇒ KAV can never pad ⇒ the room always reaches
      // the very bottom, buttons never float above a gap. The themeBg
      // on the KAV itself paints any transient frame in theme color.
      enabled={Platform.OS !== 'android' || keyboardOpen}
    >
    <View style={{ flex: 1, backgroundColor: themeBg }}>
      {}
      {storeBgUrl && (
        <Image
          source={{ uri: storeBgUrl }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          resizeMode="cover"
        />
      )}
      {}
      <AnimatedThemeBackground accentColor={accentColor} scene={themeScene} />
      <SafeAreaView edges={['top']}>
        {}
        <View style={{ paddingHorizontal: 14, paddingTop: Platform.OS === 'web' ? 68 : 6, paddingBottom: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {}
            <Pressable onPress={() => setRoomInfoOpen(true)}>
              <View style={{
                width: 36, height: 36, borderRadius: 18,
                overflow: 'hidden',
                borderWidth: 1.5, borderColor: accentColor + '66',
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: accentColor + '22' }}>
                {roomImageUri ? (
                  <Image source={{ uri: roomImageUri }} style={{ width: 36, height: 36 }} />
                ) : (
                  <Text style={{ color: accentColor, fontSize: 14, fontWeight: '900' }}>
                    {roomName.charAt(0).toUpperCase()}
                  </Text>
                )}
              </View>
            </Pressable>

            {}
            <Pressable onPress={() => setRoomInfoOpen(true)} style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: themeOnBg, fontSize: 16, fontWeight: '900' }}>
                {roomName}
              </Text>
            </Pressable>

            {}
            {showJoinBanner && (
              <ScalePress onPress={handleJoinRoom}>
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 5,
                  backgroundColor: accentColor, borderRadius: 20,
                  paddingHorizontal: 14, paddingVertical: 7,
                  shadowColor: accentColor, shadowOpacity: 0.5, shadowRadius: 8,
                  shadowOffset: { width: 0, height: 2 } }}>
                  <Feather name="user-plus" size={14} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>
                    {t('voiceRoom.screen.joinRoom')}
                  </Text>
                </View>
              </ScalePress>
            )}

            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              {/* 2026-10-22 (Sumon): diamond balance pill REMOVED from the room
                  header on his order — balance shows in the gift box when
                  sending a gift, which he says is enough. walletBalance state
                  still feeds GiftsModal. */}
              {}
              {isOwnerOrAdmin && pendingRequests.length > 0 && (
                <ScalePress
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    setSeatQueueOpen(true);
                  }}
                >
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', gap: 4,
                    backgroundColor: accentColor + '22', borderRadius: 999,
                    paddingHorizontal: 10, paddingVertical: 5,
                    borderWidth: 1, borderColor: accentColor + '55' }}>
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
          {}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: 8 }}>
            {}
            <ScalePress onPress={() => setLeaderboardOpen(true)}>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 5,
                backgroundColor: C.card,
                borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Text style={{ fontSize: 13 }}>🏆</Text>
                <Text style={{ color: C.text, fontSize: 12, fontWeight: '700' }}>
                  Hourly Rank
                </Text>
              </View>
            </ScalePress>
            {/* 2026-10-20 (Sumon): Live Audience pill sits next to Hourly Rank; the Room Games header pill is removed. */}
            <LiveAudiencePill
              count={allMembers.length}
              onPress={() => setMembersOpen(true)}
              person={allMembers[0]}
            />
            {/* 2026-10-23 (boss): announcement entry REMOVED from the header.
                Posting/editing now lives inside Settings; a posted
                announcement shows as a slim highlighted strip pinned at
                the top of the chat box (see chat panel below). */}
            {/* 2026-10-22 (Sumon): Intimacy pill REMOVED from the header on
                his order. IntimacyModal/state stay wired (harmless); the
                header entry point is gone. */}
            <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setBackpackOpen(true); }}>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 5,
                backgroundColor: C.card,
                borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Text style={{ fontSize: 13 }}>🎒</Text>
                <Text style={{ color: C.text, fontSize: 12, fontWeight: '700' }}>
                  {t('voiceRoom.backpack.title')}
                </Text>
              </View>
            </ScalePress>
            {/* 2026-10-19 (IMO waiting queue): waiter sees position, taps to manage */}
            {myQueuePosition !== null && (
              <ScalePress onPress={() => setSeatQueueOpen(true)}>
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 5,
                  backgroundColor: '#E3F2FD',
                  borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 }}>
                  <Feather name="clock" size={13} color="#007AFF" />
                  <Text style={{ color: '#007AFF', fontSize: 12, fontWeight: '800' }}>
                    {t('voiceRoom.queue.youAreNext', { n: myQueuePosition })}
                  </Text>
                </View>
              </ScalePress>
            )}
          </View>
        </View>
      </SafeAreaView>

      {}
      <View style={{ flex: 1, paddingHorizontal: 14, paddingBottom: BOTTOM_BAR_H }}>

        {}
        {showJoinBanner && (
          <ScalePress onPress={handleJoinRoom}>
            <View style={{
              marginVertical: 6, borderRadius: 16, padding: 14,
              backgroundColor: accentColor,
              flexDirection: 'row', alignItems: 'center', gap: 10,
              shadowColor: accentColor, shadowOpacity: 0.5,
              shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}>
              <Feather name="log-in" size={20} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '900', flex: 1 }}>
                {t('voiceRoom.screen.joinBanner')}
              </Text>
            </View>
          </ScalePress>
        )}

        {}
        {(hasJoined || mySeatIdx >= 0) && (
          <View style={{
            alignSelf: 'flex-start', marginBottom: 4, flexDirection: 'row', alignItems: 'center',
            backgroundColor: myRole === 'host'  ? C.gold + '22'
                           : myRole === 'admin' ? accentColor + '22'
                           : C.card,
            borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2,
            borderWidth: 1,
            borderColor: myRole === 'host'  ? C.gold + '66'
                       : myRole === 'admin' ? accentColor + '66'
                       : C.borderFaint }}>
            <Text style={{
              color: myRole === 'host'  ? C.gold
                   : myRole === 'admin' ? accentColor
                   : C.sub,
              fontSize: 11, fontWeight: '800' }}>
              {myRole === 'host'
                ? t('voiceRoom.screen.roleOwner')
                : myRole === 'admin'
                  ? t('voiceRoom.screen.roleAdmin')
                  : t('voiceRoom.screen.roleMember')}
            </Text>
          </View>
        )}

        {}
        {voiceError && (
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 10,
            backgroundColor: 'rgba(239,68,68,0.12)',
            borderWidth: 1, borderColor: 'rgba(239,68,68,0.45)',
            borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10,
            marginBottom: 6 }}>
            <Feather name="alert-triangle" size={18} color={C.red} />
            <Text style={{ flex: 1, color: themeOnBg, fontSize: 12, fontWeight: '600' }}>
              {voiceError}
            </Text>
            <ScalePress onPress={retryConnection}>
              <View style={{
                backgroundColor: C.red, borderRadius: 999,
                paddingHorizontal: 14, paddingVertical: 7 }}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>
                  {t('voiceRoom.screen.retry')}
                </Text>
              </View>
            </ScalePress>
          </View>
        )}

        {}
        <View ref={gridWrapRef} style={{ position: 'relative', marginBottom: 4, marginHorizontal: -6 }}>
        {/* Pair Halo layer — rendered BEHIND the seats (zIndex 1 < 2) so
            Nobel/store frames and seat names are never covered. Avatar
            centre sits below the cell's top by cell pad 6 + pressable
            pad 4 + avatar margin 6 + half of the 53dp avatar, plus the
            long-standing empirical calibration (+47 total). One halo per
            connected group: a 2-seat pair, or one big ring when 3–4
            adjacent seats chain together (boss pick M, 2026-10-23). */}
        {haloGroups.map((g) => {
          const gf = cellGeom[g.uids[0]];
          const gl = cellGeom[g.uids[g.uids.length - 1]];
          if (!gf || !gl) return null;
          const cx1 = gf.x + gf.w / 2;
          const cx2 = gl.x + gl.w / 2;
          const cy = gf.y + 47;
          return (
            <View
              key={g.key}
              pointerEvents="none"
              style={{ position: 'absolute', left: cx1 - HALO_R, top: cy - HALO_R, zIndex: 1 }}
            >
              <PairHalo width={(cx2 - cx1) + HALO_R * 2} design={g.design} />
            </View>
          );
        })}
        {/* ── Seat grid — clean 5-column professional layout ── */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', zIndex: 2, position: 'relative' }}>
          {seats.map((member: Participant | null, idx: number) => (
            
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
                nameColor={themeOnBg}
                labelColor={themeOnBgSub}
                myId={myUid}
                micDecorUrl={micDecorUrl}
                onPress={seatPressHandlers[idx]}
                reaction={member ? seatReactions[member.id] : undefined}
              />
            </View>
          ))}
        </View>
        </View>

        {}
        <View style={{
          flex: 1, borderRadius: 16,
          backgroundColor: themeSurface + '55',
          borderWidth: 1, borderColor: accentColor + '22',
          overflow: 'hidden' }}>
          {/* 2026-10-23 (boss): the room announcement pins as a slim,
              lightly highlighted strip at the TOP of the comment box —
              fixed above the message list (never scrolls away, never
              covers messages; content is capped at 100 chars so it can
              never fill the box). Tap opens the announcement panel. */}
          {announcement && (
            <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAnnouncementOpen(true); }}>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                backgroundColor: 'rgba(255,193,7,0.16)',
                borderBottomWidth: 1, borderBottomColor: 'rgba(255,193,7,0.45)',
                paddingHorizontal: 10, paddingVertical: 6,
              }}>
                <Text style={{ fontSize: 13 }}>📢</Text>
                <Text numberOfLines={2} style={{ color: C.text, fontSize: 12.5, fontWeight: '700', flex: 1, lineHeight: 17 }}>
                  {announcement.content}
                </Text>
                {!!announcement.createdByName && (
                  <Text numberOfLines={1} style={{ color: C.sub, fontSize: 10.5, fontWeight: '600', maxWidth: 90 }}>
                    {announcement.createdByName}
                  </Text>
                )}
              </View>
            </ScalePress>
          )}
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
                  ? <PremiumLoader size="small" />
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
          {}
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
                zIndex: 100 }}
            >
              <Feather name="chevron-down" size={20} color="#fff" />
            </Pressable>
          )}
        </View>

        {}
        {mentionQuery !== null && mentionCandidates.length > 0 && (
          <View style={{
            maxHeight: 180,
            backgroundColor: '#FFFFFF',
            borderRadius: 14,
            borderWidth: 1, borderColor: accentColor + '55',
            marginTop: 6, overflow: 'hidden',
            shadowColor: accentColor, shadowOpacity: 0.25,
            shadowRadius: 12, shadowOffset: { width: 0, height: -2 },
            elevation: 8 }}>
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
                  borderBottomWidth: 1, borderBottomColor: accentColor + '1A' }}
              >
                <View style={{
                  width: 32, height: 32, borderRadius: 16,
                  backgroundColor: m.color + '33',
                  borderWidth: 1.5, borderColor: m.color + '66',
                  alignItems: 'center', justifyContent: 'center' }}>
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

        {}
        {replyingTo && (
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: C.card,
            borderRadius: 10, padding: 8, marginTop: 6,
            borderLeftWidth: 3, borderLeftColor: accentColor }}>
            <Text numberOfLines={1} style={{ flex: 1, color: C.sub, fontSize: 12 }}>
              ↩ {replyingTo.sender}: {replyingTo.text}
            </Text>
            <Pressable onPress={() => setReplyingTo(null)}>
              <Feather name="x" size={14} color={C.muted} />
            </Pressable>
          </View>
        )}

        {}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          marginTop: 0, marginBottom: 0,
          paddingHorizontal: 4, paddingVertical: 8,
          backgroundColor: 'transparent' }}>
          <ScalePress onPress={() => { Keyboard.dismiss(); setEmojiPanelOpen(true); }} style={{ padding: 8 }}>
            <Feather name="smile" size={26} color={C.sub} />
          </ScalePress>

          {}
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
              alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: accentColor, fontSize: 16, fontWeight: '900' }}>@</Text>
          </Pressable>

          <TextInput
            style={{
              flex: 1, color: C.text, fontSize: 15,
              backgroundColor: amChatBlocked ? 'rgba(239,68,68,0.08)' : C.card, borderRadius: 24,
              paddingHorizontal: 18, paddingVertical: 12,
              borderWidth: 1, borderColor: amChatBlocked ? 'rgba(239,68,68,0.45)' : C.borderFaint,
              minHeight: 46 }}
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
            disabled={amChatBlocked}
            hitSlop={8}
            style={{
              width: 46, height: 46, borderRadius: 23,
              backgroundColor: amChatBlocked ? 'rgba(239,68,68,0.35)' : (chatInput.trim() ? accentColor : C.muted),
              alignItems: 'center', justifyContent: 'center',
              opacity: amChatBlocked ? 0.5 : 1 }}
          >
            <Feather name={amChatBlocked ? 'slash' : 'send'} size={18} color="#fff" />
          </Pressable>
        </View>
      </View>

      {}
      <EmojiPanel
        visible={emojiPanelOpen}
        onSelect={sendEmojiReaction}
        onClose={() => setEmojiPanelOpen(false)}
        bottomOffset={BOTTOM_BAR_H + 8}
      />
      <VoiceRoomBottomBar
        keyboardOpen={keyboardOpen}
        bottomPad={bottomPad}
        handleMicBarPress={handleMicBarPress}
        mySeatIdx={mySeatIdx}
        muted={muted}
        accentColor={accentColor}
        onBg={themeOnBg}
        onBgSub={themeOnBgSub}
        toggleSpeaker={toggleSpeaker}
        speakerOn={speakerOn}
        setTaskCenterOpen={setTaskCenterOpen}
        setGiftsOpen={setGiftsOpen}
        setInviteOpen={setInviteOpen}
        setExitModalOpen={setExitModalOpen}
      />
      {/* 2026-10-23 (Sumon): message action sheet — long-press a user TEXT
          message → Copy Text / Reply. Gift cards and system messages never
          open this (RoomChatMessage routes only plain text here). */}
      <Modal
        visible={!!actionMsg}
        transparent
        animationType="fade"
        onRequestClose={() => setActionMsg(null)}
      >
        <Pressable
          onPress={() => setActionMsg(null)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
        >
          <Pressable onPress={() => {}} style={{
            backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20,
            paddingHorizontal: 20, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 16),
          }}>
            {actionMsg && (
              <View style={{ marginBottom: 8 }}>
                <Text style={{ color: actionMsg.color, fontSize: 12, fontWeight: '800' }} numberOfLines={1}>
                  {truncateTo12(actionMsg.sender)}
                </Text>
                <Text style={{ color: C.sub, fontSize: 13, marginTop: 2 }} numberOfLines={2}>
                  {actionMsg.text}
                </Text>
              </View>
            )}
            <Pressable onPress={handleCopyMsg} style={{
              flexDirection: 'row', alignItems: 'center', gap: 12,
              paddingVertical: 13, borderTopWidth: 1, borderTopColor: '#EEF1F5' }}>
              <Feather name="copy" size={19} color={C.text} />
              <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>
                {t('voiceRoom.chat.copyText')}
              </Text>
            </Pressable>
            <Pressable onPress={handleReplyFromAction} style={{
              flexDirection: 'row', alignItems: 'center', gap: 12,
              paddingVertical: 13, borderTopWidth: 1, borderTopColor: '#EEF1F5' }}>
              <Feather name="corner-up-left" size={19} color={C.text} />
              <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>
                {t('voiceRoom.chat.replyText')}
              </Text>
            </Pressable>
            <Pressable onPress={() => setActionMsg(null)} style={{
              alignItems: 'center', paddingVertical: 13,
              borderTopWidth: 1, borderTopColor: '#EEF1F5' }}>
              <Text style={{ color: C.muted, fontSize: 15, fontWeight: '700' }}>
                {t('common.cancel', 'Cancel')}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Copied confirmation toast */}
      {copiedToast && (
        <View pointerEvents="none" style={{
          position: 'absolute', left: 0, right: 0, bottom: BOTTOM_BAR_H + 76,
          alignItems: 'center', zIndex: 60 }}>
          <View style={{
            backgroundColor: 'rgba(15,23,42,0.92)', borderRadius: 999,
            paddingHorizontal: 16, paddingVertical: 8 }}>
            <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '700' }}>
              {t('voiceRoom.chat.copiedToast')}
            </Text>
          </View>
        </View>
      )}

      <VoiceRoomModals
        accentColor={accentColor}
        roomId={roomId}
        myUid={myUid}
        myName={myName}
        myRole={myRole}
        myRoleLevel={myRoleLevel}
        ownerId={ownerId}
        isOwnerOrAdmin={isOwnerOrAdmin}
        roomName={roomName}
        setRoomName={setRoomName}
        roomTopic={roomTopic}
        setRoomTopic={setRoomTopic}
        roomDescription={roomDescription}
        setRoomDescription={setRoomDescription}
        roomImageUri={roomImageUri}
        setRoomImageUri={setRoomImageUri}
        roomIsPublic={roomIsPublic}
        setRoomIsPublic={setRoomIsPublic}
        roomIsLocked={roomIsLocked}
        setRoomIsLocked={setRoomIsLocked}
        activeThemeId={activeThemeId}
        setActiveThemeId={setActiveThemeId}
        activeThemeIdRef={activeThemeIdRef}
        weeklyEarned={weeklyEarned}
        walletBalance={walletBalance}
        announcement={announcement}
        setAnnouncementOpen={setAnnouncementOpen}
        seats={seats}
        audience={audience}
        allMembers={allMembers}
        blockedRecs={blockedRecs}
        lockedSeats={lockedSeats}
        roomInfoOpen={roomInfoOpen}
        setRoomInfoOpen={setRoomInfoOpen}
        opHistOpen={opHistOpen}
        setOpHistOpen={setOpHistOpen}
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        seatActionOpen={seatActionOpen}
        setSeatActionOpen={setSeatActionOpen}
        seatActionIdx={seatActionIdx}
        seatActionMember={seatActionMember}
        mySeatIdx={mySeatIdx}
        invToSeatOpen={invToSeatOpen}
        setInvToSeatOpen={setInvToSeatOpen}
        invToSeatIdx={invToSeatIdx}
        setInvToSeatIdx={setInvToSeatIdx}
        inviteOpen={inviteOpen}
        setInviteOpen={setInviteOpen}
        giftsOpen={giftsOpen}
        setGiftsOpen={setGiftsOpen}
        giftsRecipient={giftsRecipient}
        setGiftsRecipient={setGiftsRecipient}
        leaderboardOpen={leaderboardOpen}
        setLeaderboardOpen={setLeaderboardOpen}
        membersOpen={membersOpen}
        setMembersOpen={setMembersOpen}
        activeMember={activeMember}
        setActiveMember={setActiveMember}
        exitModalOpen={exitModalOpen}
        setExitModalOpen={setExitModalOpen}
        taskCenterOpen={taskCenterOpen}
        setTaskCenterOpen={setTaskCenterOpen}
        pinGate={pinGate}
        pinInput={pinInput}
        setPinInput={setPinInput}
        pinError={pinError}
        setPinError={setPinError}
        pinVerifying={pinVerifying}
        submitPinGate={submitPinGate}
        cancelPinGate={cancelPinGate}
        giftFlyRef={giftFlyRef}
        entryBanner={entryBanner}
        setEntryBanner={setEntryBanner}
        handleDisband={handleDisband}
        handleViewOtherProfile={handleViewOtherProfile}
        handleViewOwnProfile={handleViewOwnProfile}
        handleEditOwnProfile={handleEditOwnProfile}
        handleMention={handleMention}
        handleGiftSent={handleGiftSent}
        handleGiftPlay={handleGiftPlay}
        handleLeave={handleLeave}
        handleMinimize={handleMinimize}
        downFromSeat={downFromSeat}
        joinSeat={joinSeat}
        muteToggleMember={muteToggleMember}
        setAdminRole={setAdminRole}
        dismissAdmin={dismissAdmin}
        blockUser={blockUser}
        unblockUser={unblockUser}
        svipKickOut={svipKickOut}
        canSvipKickOut={canSvipKickOut}
        lockSeat={lockSeat}
        unlockSeat={unlockSeat}
        inviteToSeat={inviteToSeat}
      />

      {/* ── 2026-10-19 (IMO port): waiting queue + games + ranking + props ── */}
      <SeatQueueModal
        visible={seatQueueOpen}
        roomId={roomId}
        requests={pendingRequests}
        myUid={myUid}
        isHost={isOwnerOrAdmin}
        myPosition={myQueuePosition}
        onClose={() => setSeatQueueOpen(false)}
        onCancelMine={() => {
          if (myQueuedRequest) {
            cancelSeatRequest(roomId, myQueuedRequest.id)
              .then(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success))
              .catch((e: unknown) => Alert.alert(t('voiceRoom.screen.error'), getErrorCause(e)));
          }
        }}
      />
      <RoomGamesModal
        visible={gamesOpen}
        roomId={roomId}
        isHost={isOwnerOrAdmin}
        onClose={() => setGamesOpen(false)}
        onOpenGame={(g: RoomGame) => { setGamesOpen(false); setGameNav({ kind: g.type, gameId: g.id }); }}
        onCreateGame={(kind: GameType) => { setGamesOpen(false); setGameNav({ kind, gameId: null }); }}
        onOpenRank={() => { setGamesOpen(false); setRankOpen(true); }}
        onOpenProps={() => { setGamesOpen(false); setPropsOpen(true); }}
      />
      <RoomRankModal
        visible={rankOpen}
        roomId={roomId}
        members={allMembers.map((m) => ({ uid: m.id, name: m.name || '', photoURL: m.photoURL ?? null, color: m.color, initials: m.initials }))}
        myUid={myUid}
        onClose={() => setRankOpen(false)}
      />
      <RoomPropsSheet
        visible={propsOpen}
        roomId={roomId}
        isOwner={myRole === 'host'}
        onClose={() => setPropsOpen(false)}
        onOpenStore={() => { setPropsOpen(false); router.push('/store'); }}
      />
      {/* ── 2026-10-19 (IMO gap fill): announcement + intimacy + backpack ── */}
      <RoomAnnouncementModal
        visible={announcementOpen}
        roomId={roomId}
        announcement={announcement}
        isOwnerOrAdmin={isOwnerOrAdmin}
        myUid={myUid}
        myName={myName}
        onClose={() => setAnnouncementOpen(false)}
      />
      <IntimacyModal
        visible={intimacyOpen}
        myUid={myUid}
        onClose={() => setIntimacyOpen(false)}
      />
      <PropsBackpackModal
        visible={backpackOpen}
        myUid={myUid}
        onClose={() => setBackpackOpen(false)}
        onOpenStore={() => router.push('/store')}
      />
      {gameNav?.kind === 'vote' && (
        <VoteGameModal
          visible
          roomId={roomId}
          hostUid={ownerId || myUid}
          hostName={myName}
          seats={seats.filter((s): s is Participant => !!s).map((s) => ({ uid: s.id, name: s.name || '', photoURL: s.photoURL ?? null, color: s.color, initials: s.initials }))}
          gameId={gameNav.gameId}
          isHost={isOwnerOrAdmin}
          onClose={() => setGameNav(null)}
          onOpenGifts={() => { setGameNav(null); setGiftsOpen(true); }}
        />
      )}
      {gameNav?.kind === 'turntable' && (
        <TurntableGameModal
          visible
          roomId={roomId}
          hostUid={ownerId || myUid}
          hostName={myName}
          myUid={myUid}
          myName={myName}
          isHost={isOwnerOrAdmin}
          onClose={() => setGameNav(null)}
        />
      )}
      {gameNav?.kind === 'luckybag' && (
        <LuckyBagGameModal
          visible
          roomId={roomId}
          hostUid={ownerId || myUid}
          hostName={myName}
          myUid={myUid}
          myName={myName}
          myPhotoURL={myPhotoURL ?? null}
          isHost={isOwnerOrAdmin}
          onClose={() => setGameNav(null)}
        />
      )}
    </View>
    </KeyboardAvoidingView>
  );
}
