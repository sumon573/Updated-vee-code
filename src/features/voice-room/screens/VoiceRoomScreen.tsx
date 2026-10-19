import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, FlatList, Alert, Pressable, Animated, Platform, TextInput, Image, BackHandler, Modal, KeyboardAvoidingView, Keyboard } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ref, get, onValue, update, set, serverTimestamp, onDisconnect } from 'firebase/database';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import ScalePress from '@/components/ScalePress';
import { database } from '@/src/config/firebase';
import { setMinimizedRoom, getMinimizedRoom, setCurrentRoom, clearCurrentRoom } from '@/src/store/minimizedRoom';
import { persistActiveRoom, getPersistedActiveRoom, clearPersistedActiveRoom } from '@/src/store/activeRoom';
import { useLivekitVoiceRoom, setVoiceRoomMinimized, destroyPersistedVoiceRoomEngineAsync } from '../useLivekitVoiceRoom';
import { useAuth } from '@/src/context/AuthContext';
import { getUser, subscribeUser } from '@/src/services/userService';
import { subscribeWalletBalance } from '@/src/features/wallet/walletService';
import { submitReport } from '@/src/services/reportService';

import { getErrorCause } from '@/src/utils/errorDisplay';
import { C, ROOM_META, ROOM_THEMES } from '../constants/theme';
import { markVoiceStage } from '../utils/voiceCrashBreadcrumb';
import { Role, Participant, BlockRecord, ChatMsg, SeatReaction, GiftSentInfo, roleToLevel } from '../types/room';
import { fmtDiamonds, getWeekStart } from '../utils/format';
import { SeatCard } from '../components/SeatCard';
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
  subscribeLockedSeats,
  joinRoomAsAudience, leaveAudience, takeSeat, leaveSeat as fbLeaveSeat,
  setSeatMute, setSeatRole, removeSeat, removeAudienceMember,
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
  isPinVerifiedForSession as isPinVerified,
  setPinVerifiedForSession as setPinVerified,
  sendRoomEntryEvent, subscribeRoomEntryEvents,
  sendRoomGiftEvent, subscribeRoomGiftEvents } from '../services/firebaseRoomService';
import {
  subscribeRoomChat, sendRoomChatMsg, loadOlderMessages,
  type RoomChatMsg } from '../services/firebaseRoomChatService';


import { fbSeatToParticipant, fbAudToParticipant, fbChatToMsg, lastChatSendAt, addSentJoinMsgKey, sentJoinMsgKeys, LiveAudiencePill, LiveDateIcon, TwinkleSparkle, ObsidianGiftButton, ObsidianExitButton, OrbitSparkle, SapphireInviteButton, PulseRing, PulseMicButton, LiquidGoldSpeaker } from './VoiceRoomHelpers';
import { VoiceRoomBottomBar } from './VoiceRoomBottomBar';
import { VoiceRoomModals } from './VoiceRoomModals';

export default function VoiceRoomScreen() {
  const { roomId: paramRoomId, restore } = useLocalSearchParams<{ roomId: string; restore?: string }>();
  const isRestore = restore === '1';
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { t } = useTranslation();

  const roomId = paramRoomId ?? '';
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

  useEffect(() => {
    if (!roomId || !myUid || myUid === 'anonymous') return;
    const syncFrame = () => {
      const frame = (myProfile as any)?.activeFrame;
      const seatIdx = mySeatIdxRef.current;
      if (!frame || seatIdx < 0) return;
      update(ref(database, `rooms/${roomId}/seats/${seatIdx}`), { activeFrame: frame })
        .then(() => console.log(`[VoiceRoom] ✅ Periodic seat ${seatIdx} frame sync: ${frame}`))
        .catch((e) => console.log(`[VoiceRoom] ❌ Periodic seat frame sync FAILED:`, e?.message || e));
    };
    const initial = setTimeout(syncFrame, 5000);
    const interval = setInterval(syncFrame, 30000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [roomId, myUid]);

  const myName = myProfile?.name || user?.displayName || t('voiceRoom.screen.defaultUserName');
  const myPhotoURL = myProfile?.photoURL || user?.photoURL || undefined;
  const myColor = getUserColor(myUid);
  const myInitials = getInitials(myName);

  const voiceUserName = useMemo(() => user?.displayName ?? myUid, []);

  
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
  }, []);

  
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
      if (prev.mySeatIdx >= 0) {
        const demoteUid = prev.role === 'admin' ? (prev.myUid || myUid) : undefined;
        removeSeat(prev.id, prev.mySeatIdx, demoteUid).catch(() => {});
        leaveAudience(prev.id, prev.myUid || myUid).catch(() => {});
      } else {
        leaveAudience(prev.id, prev.myUid || myUid).catch(() => {});
        if (prev.role === 'admin') {
          revokeRoomAdmin(prev.id, prev.myUid || myUid).catch(() => {});
        }
      }
      setMinimizedRoom(null);
    })();
  }, [roomId]);

  
  const handleRoomInfoOk = useCallback(() => {
    markVoiceStage('room_info_ok', roomId);
    if (voiceReadyRef.current) return;
    voiceReadyRef.current = true;
    voiceReadyTimerRef.current = setTimeout(() => {
      voiceReadyTimerRef.current = null;
      setVoiceReady(true);
    }, 1200);
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

  
  const [seats,         setSeats]        = useState<Array<Participant | null>>(Array(10).fill(null));
  const [lockedSeats,   setLockedSeats]  = useState<Set<number>>(new Set<number>());
  const [audience,      setAudience]     = useState<Participant[]>([]);
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
                  muted: true, role: 'member',
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
      lastReactionTsRef.current = reaction.ts;
      const senderMember = seatsRef.current.find((m) => m && m.id === reaction.byUid);
      if (!senderMember) return;
      const translateY = new Animated.Value(0);
      const opacity = new Animated.Value(1);
      const newReactions: Record<string, SeatReaction> = {
        [senderMember.id]: { emoji: reaction.emoji, translateY, opacity } };
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

  
  const [roomTopic,     setRoomTopic]    = useState<string>(t('voiceRoom.creation.defaultTopic'));
  const [roomName,      setRoomName]     = useState(ROOM_META.name);
  const [roomImageUri, setRoomImageUri] = useState<string | null>(null);
  const [activeThemeId, setActiveThemeId] = useState('cosmic');
  
  const activeThemeIdRef = useRef('cosmic');
  
  const [roomIsPublic,  setRoomIsPublic]  = useState(true);
  
  const [roomIsLocked,  setRoomIsLocked]  = useState(false);
  
  const [roomDescription, setRoomDescription] = useState('');
  const accentColor = useMemo(
    () => ROOM_THEMES.find((th: { id: string; accent: string }) => th.id === activeThemeId)?.accent ?? C.primary,
    [activeThemeId],
  );
  
  const themeBg = useMemo(
    () => ROOM_THEMES.find((th) => th.id === activeThemeId)?.bg ?? C.bg,
    [activeThemeId],
  );
  
  const themeSurface = useMemo(
    () => ROOM_THEMES.find((th) => th.id === activeThemeId)?.surface ?? 'rgba(255,255,255,0.055)',
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
  const pinInfoRef = useRef<{ isPublic?: boolean; ownerId?: string; pinVersion?: number } | null>(null);
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
  
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [sendingMsg,   setSendingMsg]   = useState(false);

  
  const [seatReactions,  setSeatReactions]  = useState<Record<string, SeatReaction>>({});

  
  const giftFlyRef = useRef<GiftFlyHandle>(null);
  const seatViewRefs = useRef<Record<string, View | null>>({});

  
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
      pinInfoRef.current = { isPublic: info.isPublic, ownerId: info.ownerId, pinVersion: typeof info.pinVersion === 'number' ? info.pinVersion : 0 };
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
      if (info.themeId && info.themeId !== activeThemeIdRef.current) {
        activeThemeIdRef.current = info.themeId;
        setActiveThemeId(info.themeId);
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
      setSeats(fbSeats.map(seat =>
        seat ? fbSeatToParticipant(seat, speakingRef.current) : null,
      ));
    });
  }, [roomId]);

  useEffect(() => {
    return subscribeAudience(roomId, (fbAudience) => {
      const participants = fbAudience.map(fbAudToParticipant);
      setAudience(participants);
    });
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
      setMessages(visible.map(fbChatToMsg));
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
    sendRoomChatMsg(roomId, {
      senderId: 'system',
      senderName: 'System',
      senderColor: C.gold,
      text: t('voiceRoom.screen.joinedRoom', { name: displayName }),
      ts: Date.now() }).catch(() => {});
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
  }, [roomId]);
  useEffect(() => {
    if (mySeatIdx < 0) return;
    const beat = () => refreshSeatHeartbeat(roomId, mySeatIdx, myUid).catch(() => {});
    beat(); // immediate first beat on seating
    const timer = setInterval(beat, 60_000);
    return () => clearInterval(timer);
  }, [roomId, mySeatIdx, myUid]);

  
  const hasAutoPublishedRef = useRef(false);
  useEffect(() => {
    if (hasAutoPublishedRef.current) return;
    if (!voiceJoined || mySeatIdx < 0) return;
    hasAutoPublishedRef.current = true;
    if (!hasJoined) setHasJoined(true);
    startPublishing();
  }, [voiceJoined, mySeatIdx]);

  
  useEffect(() => {
    if (voiceBan) return;
    if (!hasJoined && ownerId && ownerId === myUid) {
      setHasJoined(true);
    }
  }, [hasJoined, ownerId, myUid, voiceBan]);

  
  const prevFbMutedRef = useRef<boolean | null>(null);
  const prevMySeatIdxRef = useRef<number>(-1);
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
    setMicMuted(fbMuted);
  }, [seats, mySeatIdx, isPublishing]);

  
  useEffect(() => {
    if (!speakingUsers) return;
    setSeats((prev: Array<Participant | null>) => prev.map((s: Participant | null) => {
      if (!s || s.id === myUid) return s;
      const isSpeaking = speakingUsers[s.id] === true && !s.muted;
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

  
  useEffect(() => {
    if (!roomId || !myUid || pinGate !== 'passed') return;
    hasLeftRef.current = false;
    let cancelled = false;

    (async () => {
      try {
        const { getNobleState } = await import('@/src/services/nobleService');
        const noble = await getNobleState(myUid).catch(() => null);
        if (noble && !noble.lapsed) myNobleRankRef.current = noble.rankIndex;
      } catch {  }
      if (cancelled) return;
      try {
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
        addSentJoinMsgKey(joinKey);
        sendRoomChatMsg(roomId, {
          senderId: 'system',
          senderName: 'System',
          senderColor: C.gold,
          text: t('voiceRoom.screen.joinedRoom', { name: myName }),
          ts: Date.now() }).catch(() => {});
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
            onDisconnect(seatRef).remove().catch(() => {});
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
    const mySeat = seats.find((s: Participant | null) => s?.id === myUid);
    if (mySeat?.role) return mySeat.role;
    const myAud = audience.find((m: Participant) => m.id === myUid);
    if (myAud?.role === 'admin') return 'admin';
    return (ownerId && ownerId === myUid ? 'host' : 'member');
  }, [seats, audience, myUid, ownerId]);

  const isOwnerOrAdmin = myRole === 'host' || myRole === 'admin';

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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (!isPublishing) {
      startPublishing();
      return;
    }

    const newMuted = engineToggleMic(); // single source of truth — never `!muted`
    setSeats(prev => prev.map((s, i) =>
      i === mySeatIdx && s ? { ...s, muted: newMuted } : s,
    ));
    setSeatMute(roomId, mySeatIdx, newMuted).catch(() => {});
  }, [engineToggleMic, startPublishing, isPublishing, mySeatIdx, roomId]);

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

  const muteToggleMember = useCallback((memberId: string) => {
    const seatIdx = seats.findIndex((s: Participant | null) => s?.id === memberId);
    const seat = seatIdx >= 0 ? seats[seatIdx] : null;
    if (!seat || seatIdx < 0) return;
    const prevMuted = seat.muted ?? false;
    const newMuted = !prevMuted;
    if (newMuted) muteRemoteUser(memberId);
    else playUserStream(memberId);
    setSeats((prev: Array<Participant | null>) => prev.map((s: Participant | null, i: number) =>
      (i === seatIdx && s ? { ...s, muted: newMuted } : s),
    ));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSeatMute(roomId, seatIdx, newMuted).catch((e: unknown) => {
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
      muted: mySeatIdx >= 0 ? muted : true,
      role: seatRole,
      ...(myNobleRankRef.current != null ? { nobleRankIndex: myNobleRankRef.current } : {}) };
  }, [myUid, myName, myInitials, myColor, myPhotoURL, myProfile, myVerified, myRole, ownerId, mySeatIdx, muted]);

  const joinSeat = useCallback(async (seatIdx: number) => {
    if (mySeatIdx === seatIdx) return;
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
      setMicMuted(true);
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [seats, myUid, myName, myInitials, myColor, myRole, mySeatIdx, roomId, startPublishing, muted, t, buildSeatData]);

  
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

  const blockUser = useCallback((memberId: string, action: 'room-block' | 'comment-block') => {
    const inSeat = seats.find((s: Participant | null) => s?.id === memberId);
    const inAud  = audience.find((m: Participant) => m.id === memberId);
    const member = inSeat ?? inAud;
    if (!member) return;

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

      if (mySeatIdx >= 0) {
        try { stopPublishing(); } catch {  }
        const demoteUid = myRole === 'admin' ? myUid : undefined;
        removeSeat(roomId, mySeatIdx, demoteUid).catch(() => {});
        leaveAudience(roomId, myUid).catch(() => {});
      } else if (hasJoined) {
        leaveAudience(roomId, myUid).catch(() => {});
        if (myRole === 'admin') {
          revokeRoomAdmin(roomId, myUid).catch(() => {});
        }
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

  const sendMessage = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || sendingMsgRef.current) return;
    const now = Date.now();
    const lastSent = lastChatSendAt.get(roomId) ?? 0;
    if (now - lastSent < 1500) return;
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
        ...(replyingTo ? { replyTo: { sender: replyingTo.sender, text: replyingTo.text, color: replyingTo.color } } : {}) });
      setChatInput('');
      setReplyingTo(null);
      setMentionQuery(null);
      if (scrollTimerRef.current !== null) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        scrollTimerRef.current = null;
        chatRef.current?.scrollToEnd({ animated: true });
      }, 80);
    } catch (err) {
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
    setIsRoomMember(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (roomId && myUid) {
      const memberRef = ref(database, `roomMembers/${roomId}/${myUid}`);
      set(memberRef, {
        role: 'member',
        joinedAt: Date.now(),
        name: myName,
      }).catch(() => {});
      const userRoomRef = ref(database, `userRooms/${myUid}/${roomId}`);
      set(userRoomRef, {
        joinedAt: Date.now(),
        role: 'member',
      }).catch(() => {});
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

  const handleGiftSent = useCallback((info: GiftSentInfo) => {
    sendRoomChatMsg(roomId, {
      senderId: myUid,
      senderName: myName,
      senderColor: myColor,
      text: t('voiceRoom.screen.sentGift', { emoji: info.giftName || info.emoji, names: info.recipients.map((r) => r.name).join(', '), coins: info.coins }),
      ts: Date.now() }).catch(() => {});

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
      videoSize: info.videoSize,
      videoFullscreen: info.videoFullscreen});
    };
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
      videoSize: info.videoSize || null,
      videoFullscreen: info.videoFullscreen || null }).catch(() => {});
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
  }, [roomId, myUid, myName, myColor, t]);

  const sendEmojiReaction = useCallback((emoji: string) => {
    setEmojiPanelOpen(false);
    sendRoomEmojiReaction(roomId, { emoji, byUid: myUid, byName: myName }).catch(() => {});
    sendRoomChatMsg(roomId, {
      senderId: myUid,
      senderName: myName,
      senderColor: myColor,
      text: emoji,
      ts: Date.now() }).catch(() => {});
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
      <RoomChatMessage item={item} accentColor={accentColor} onReply={setReplyingTo} />
    ),
    [accentColor],
  );

  
  const bottomPad  = Math.max(insets.bottom, Platform.OS === 'web' ? 20 : 8) + 14;
  const BOTTOM_BAR_H = bottomPad + 10 + 74;

  
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
        <Text style={{ color: C.text, fontSize: 20, fontWeight: '900', textAlign: 'center', marginBottom: 8 }}>
          {t('voiceRoom.ban.title', { defaultValue: 'Voice rooms unavailable' })}
        </Text>
        <Text style={{ color: C.muted, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 16 }}>
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
        <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 8, marginBottom: 24 }}>
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
      style={{ flex: 1 }}
      
      behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
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
      <AnimatedThemeBackground accentColor={accentColor} />
      <SafeAreaView edges={['top']}>
        {}
        <View style={{ paddingHorizontal: 14, paddingTop: Platform.OS === 'web' ? 68 : 10, paddingBottom: 8 }}>
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
              <Text numberOfLines={1} style={{ color: C.text, fontSize: 16, fontWeight: '900' }}>
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
              {}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4,
                backgroundColor: 'rgba(245,158,11,0.14)', borderRadius: 999,
                paddingHorizontal: 10, paddingVertical: 5,
                borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)' }}>
                <Text style={{ color: C.gold, fontSize: 13 }}>💎</Text>
                <Text style={{ color: C.gold, fontSize: 13, fontWeight: '800' }}>
                  {fmtDiamonds(walletBalance)}
                </Text>
              </View>

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
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 }}>
            {}
            <ScalePress onPress={() => setLeaderboardOpen(true)}>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                backgroundColor: 'rgba(255,255,255,0.1)',
                borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}>
                <Text style={{ fontSize: 16 }}>🏆</Text>
                <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '700' }}>
                  Hourly Rank
                </Text>
              </View>
            </ScalePress>
            {/* 2026-10-19 (IMO port): Room Games lobby */}
            <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setGamesOpen(true); }}>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                backgroundColor: 'rgba(255,255,255,0.1)',
                borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}>
                <Text style={{ fontSize: 16 }}>🎮</Text>
                <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '700' }}>
                  {t('voiceRoom.games.title')}
                </Text>
              </View>
            </ScalePress>
            {/* 2026-10-19 (IMO gap fill): announcement / intimacy / backpack */}
            {announcement && (
              <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAnnouncementOpen(true); }}>
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  backgroundColor: 'rgba(255,193,7,0.18)',
                  borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
                  maxWidth: 180,
                }}>
                  <Text style={{ fontSize: 16 }}>📢</Text>
                  <Text numberOfLines={1} style={{ color: '#FFF', fontSize: 13, fontWeight: '700', flexShrink: 1 }}>
                    {announcement.content}
                  </Text>
                </View>
              </ScalePress>
            )}
            {!announcement && isOwnerOrAdmin && (
              <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAnnouncementOpen(true); }}>
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}>
                  <Text style={{ fontSize: 16 }}>📢</Text>
                  <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '700' }}>
                    {t('voiceRoom.announcement.post')}
                  </Text>
                </View>
              </ScalePress>
            )}
            <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setIntimacyOpen(true); }}>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                backgroundColor: 'rgba(255,255,255,0.1)',
                borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}>
                <Text style={{ fontSize: 16 }}>💕</Text>
                <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '700' }}>
                  {t('voiceRoom.intimacy.title')}
                </Text>
              </View>
            </ScalePress>
            <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setBackpackOpen(true); }}>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                backgroundColor: 'rgba(255,255,255,0.1)',
                borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}>
                <Text style={{ fontSize: 16 }}>🎒</Text>
                <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '700' }}>
                  {t('voiceRoom.backpack.title')}
                </Text>
              </View>
            </ScalePress>
            {/* 2026-10-19 (IMO waiting queue): waiter sees position, taps to manage */}
            {myQueuePosition !== null && (
              <ScalePress onPress={() => setSeatQueueOpen(true)}>
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  backgroundColor: '#E3F2FD',
                  borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}>
                  <Feather name="clock" size={14} color="#007AFF" />
                  <Text style={{ color: '#007AFF', fontSize: 13, fontWeight: '800' }}>
                    {t('voiceRoom.queue.youAreNext', { n: myQueuePosition })}
                  </Text>
                </View>
              </ScalePress>
            )}
            {}
            <LiveAudiencePill
              count={allMembers.length}
              onPress={() => setMembersOpen(true)}
              person={allMembers[0]}
            />
          </View>
        </View>
      </SafeAreaView>

      {}
      <View style={{ flex: 1, paddingHorizontal: 14, paddingBottom: BOTTOM_BAR_H }}>

        {}
        {showJoinBanner && (
          <ScalePress onPress={handleJoinRoom}>
            <View style={{
              marginVertical: 10, borderRadius: 16, padding: 14,
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
            alignSelf: 'flex-start', marginBottom: 8, flexDirection: 'row', alignItems: 'center',
            backgroundColor: myRole === 'host'  ? C.gold + '22'
                           : myRole === 'admin' ? accentColor + '22'
                           : 'rgba(255,255,255,0.07)',
            borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5,
            borderWidth: 1,
            borderColor: myRole === 'host'  ? C.gold + '66'
                       : myRole === 'admin' ? accentColor + '66'
                       : C.borderFaint }}>
            <Text style={{
              color: myRole === 'host'  ? C.gold
                   : myRole === 'admin' ? accentColor
                   : C.sub,
              fontSize: 12, fontWeight: '800' }}>
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
            marginBottom: 10 }}>
            <Feather name="alert-triangle" size={18} color={C.red} />
            <Text style={{ flex: 1, color: C.text, fontSize: 12, fontWeight: '600' }}>
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
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
          {seats.map((member: Participant | null, idx: number) => (
            
            <View
              key={idx}
              collapsable={false}
              style={{ width: '25%', alignItems: 'center', paddingVertical: 6 }}
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
                micDecorUrl={micDecorUrl}
                onPress={seatPressHandlers[idx]}
                reaction={member ? seatReactions[member.id] : undefined}
              />
            </View>
          ))}
        </View>

        {}
        <View style={{
          flex: 1, borderRadius: 16,
          backgroundColor: themeSurface + '55',
          borderWidth: 1, borderColor: accentColor + '22',
          overflow: 'hidden' }}>
          {}
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
            backgroundColor: '#0F0A1E',
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
            backgroundColor: 'rgba(255,255,255,0.07)',
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
          backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.borderFaint }}>
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
            disabled={sendingMsg || amChatBlocked}
            hitSlop={8}
            style={{
              width: 46, height: 46, borderRadius: 23,
              backgroundColor: amChatBlocked ? 'rgba(239,68,68,0.35)' : (chatInput.trim() ? accentColor : C.muted),
              alignItems: 'center', justifyContent: 'center',
              opacity: (sendingMsg || amChatBlocked) ? 0.5 : 1 }}
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
        toggleSpeaker={toggleSpeaker}
        speakerOn={speakerOn}
        setTaskCenterOpen={setTaskCenterOpen}
        setGiftsOpen={setGiftsOpen}
        setInviteOpen={setInviteOpen}
        setExitModalOpen={setExitModalOpen}
      />
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
        handleLeave={handleLeave}
        handleMinimize={handleMinimize}
        downFromSeat={downFromSeat}
        joinSeat={joinSeat}
        muteToggleMember={muteToggleMember}
        setAdminRole={setAdminRole}
        dismissAdmin={dismissAdmin}
        blockUser={blockUser}
        unblockUser={unblockUser}
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
