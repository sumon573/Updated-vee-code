import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, FlatList, Alert, Pressable, Animated, Platform, TextInput, Image, BackHandler, Modal, KeyboardAvoidingView, Keyboard, AppState } from 'react-native';
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
import { getRoomChatSession, setRoomChatSession, clearRoomChatSession } from '@/src/store/roomChatSession';
import { persistActiveRoom, getPersistedActiveRoom, clearPersistedActiveRoom, persistMicIntent } from '@/src/store/activeRoom';
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
import PairHandshake, { HANDSHAKE_BADGE } from '../components/PairHandshake';
import { resolveDesign, HANDSHAKE_DESIGNS, BASIC_DESIGN_KEY, type HandshakeDesign } from '../components/handshakeDesigns';
import {
  subscribeIntimacy, intimacyLevelFor, intimacyPairKey,
} from '../services/intimacyService';
import { subscribePairHandshake } from '../services/micHandshakeService';
import { useStoreRoomDecor } from '@/src/hooks/useStoreItems';
import RoomChatMessage from '../components/RoomChatMessage';
import { RoomInfoModal } from '../components/RoomInfoModal';
import { OperationHistoryModal } from '../components/OperationHistoryModal';
import { SettingsModal } from '../components/SettingsModal';
import { RoomCustomizePanel } from '../components/RoomCustomizePanel';
import { MusicFlowModal } from '../components/music/MusicFlowModal';
import { FloatingMusicIcon } from '../components/FloatingMusicIcon';
import { PkModal } from '../components/PkModal';
import { PkBanner } from '../components/PkBanner';
import { LuduLobbyStrip } from '../components/LuduLobbyStrip';
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
import {
  subscribeRoomMusic, setMusicState, type RoomMusic,
} from '../services/roomMusicService';
import {
  subscribeRoomPk, acceptPk, removePk, PK_CHALLENGE_TIMEOUT_MS, type RoomPk,
} from '../services/roomPkService';
import { VoteGameModal } from '../components/games/VoteGameModal';
import { TurntableGameModal } from '../components/games/TurntableGameModal';
import { LuckyBagGameModal } from '../components/games/LuckyBagGameModal';
import { LuduGameModal } from '../components/games/LuduGameModal';
import { DeliciousGameSheet } from '../components/games/DeliciousGameSheet';
import type { RoomGame, GameType } from '../services/roomGameService';
import { subscribeGames } from '../services/roomGameService';
import { ExitModal } from '../components/ExitModal';
import EntryBanner from '../components/EntryBanner';
import { GiftFlyAnimation, GiftReceiveBanners, type GiftFlyHandle } from '../components/GiftFlyAnimation';

import { checkVoiceBan, type VoiceBanInfo } from '../services/voiceBanService';
import {
  subscribeSeats, subscribeAudience, subscribeRoomInfo,
  subscribeLockedSeats, subscribeRoomAdmins,
  joinRoomAsAudience, leaveAudience, takeSeat, clearOtherSeats, leaveSeat as fbLeaveSeat,
  setSeatMute, setPendingSeatMute, getPendingSeatMute, clearPendingSeatMute, writeSeatMuteReliable, setSeatHostMute, setSeatRole, removeSeat, removeAudienceMember,
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
  sendRoomGiftEvent, subscribeRoomGiftEvents,
  leaveRoomCompletely } from '../services/firebaseRoomService';
import {
  subscribeRoomChat, sendRoomChatMsg, createRoomChatKey,
  type RoomChatMsg } from '../services/firebaseRoomChatService';


import { fbSeatToParticipant, fbAudToParticipant, fbChatToMsg, lastChatSendAt, addSentJoinMsgKey, sentJoinMsgKeys, LiveAudiencePill, LiveDateIcon, TwinkleSparkle, ObsidianGiftButton, ObsidianExitButton, OrbitSparkle, SapphireInviteButton, PulseRing, PulseMicButton, LiquidGoldSpeaker } from './VoiceRoomHelpers';
import { VoiceRoomBottomBar } from './VoiceRoomBottomBar';
import { VoiceRoomModals } from './VoiceRoomModals';

/**
 * 2026-10-26 (boss: every genuine entry must show its join line):
 * the 2026-10-23 30-minute persisted slot (claimJoinMsgSlot) is DELETED
 * — it suppressed the join line on every rejoin within 30 minutes, so
 * frequent joiners never saw a join line at all. The per-stay gates
 * replace it: hasSentEntryChatMsgRef (same mount) + sentJoinMsgKeys
 * (same app session, cleared on leave) + isRestore/isReturnFromMinimize
 * (returns never re-send). One line per genuine entry, never twice for
 * the same stay, never on return. The orphaned 'vee_join_msg_ts' key
 * on devices is never read again (harmless).
 */

// ── 2026-10-26 (weak network outbox) ───────────────────────────────────────
// Room text sends survive a kill mid-outage: pending sends persist to
// AsyncStorage keyed by room, and re-sending reuses the SAME push key,
// so a retry can never duplicate (it overwrites the same node).
const OUTBOX_KEY = 'vee_room_chat_outbox';
type OutboxEntry = { id: string; payload: Omit<RoomChatMsg, 'id' | 'isMe'> };
async function loadOutboxEntries(roomId: string): Promise<OutboxEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, OutboxEntry[]>) : {};
    return map[roomId] ?? [];
  } catch { return []; }
}
async function persistOutboxEntry(roomId: string, entry: OutboxEntry): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, OutboxEntry[]>) : {};
    map[roomId] = [...(map[roomId] ?? []).filter((e) => e.id !== entry.id), entry];
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(map));
  } catch { /* outbox is best-effort; the live send still runs */ }
}
async function removeOutboxEntry(roomId: string, id: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    if (!raw) return;
    const map = JSON.parse(raw) as Record<string, OutboxEntry[]>;
    map[roomId] = (map[roomId] ?? []).filter((e) => e.id !== id);
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
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

  // 2026-10-26 (boss: one name only): room display names resolve from the
  // RTDB profile (nickname) ONLY — never Firebase Auth displayName (the
  // Google name that showed up next to nicknames). myProfile is already
  // sanitize-resolved, so it is never empty once loaded; before it loads
  // the default shows briefly instead of a Google name. Photo fallback
  // stays (a photo is not a name, and dropping it would blank avatars).
  const myName = myProfile?.name || t('voiceRoom.screen.defaultUserName');
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
    connection: voiceConnection,
    muted,
    mutedRef: engineMutedRef,
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
    setMusicVolume,
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
  const [showChatScrollBtn, setShowChatScrollBtn] = useState(false);

  const speakingRef = useRef<Record<string, boolean>>({});
  useEffect(() => { speakingRef.current = speakingUsers; }, [speakingUsers]);

  const seatsRef = useRef<Array<Participant | null>>(Array(10).fill(null));
  // 2026-10-26 (boss: visibly-empty seat said "Seat Occupied"): joinSeat is
  // declared BELOW handleSeatPress, so it cannot be a dep (TS2448) — mirror
  // it in a ref instead, or taps keep calling a stale joinSeat whose seats
  // snapshot still holds the departed member.
  const joinSeatRef = useRef<((seatIdx: number) => Promise<void>) | null>(null);
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
                // 2026-10-26 (boss: invite-accept mic + room-leave laws):
                // a seat take via invite IS a seat take — it must update
                // the active-room tracker (else a later room-invite guard
                // leaves the STALE seat behind in the old room) and start
                // UNMUTED (startPublishing alone keeps the previous muted
                // flag, so an invited seat could open muted).
                mySeatIdxRef.current = invite.seatIdx;
                setCurrentRoom({ id: roomId, myUid, mySeatIdx: invite.seatIdx });
                persistActiveRoom({ roomId, myUid, mySeatIdx: invite.seatIdx }).catch(() => {});
                startPublishing();
                setMicMuted(false);
                persistMicIntent(roomId, false).catch(() => {});
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
  // 2026-10-25 (boss: entry effect ONLY on first entry / fresh entry
  // after exit — never on minimize/background return): captured at
  // mount, before the focus effects clear the minimized record, so a
  // return is recognized even though the record is gone by the time
  // pinGate passes (same pattern as returningSeatIdx). isRestore covers
  // the cold-start auto-return (no minimized record survives a restart).
  const [isReturnFromMinimize] = useState(() => {
    const prev = getMinimizedRoom();
    return !!prev && prev.id === roomId;
  });
  useEffect(() => {
    if (!hasShownSelfEntryRef.current && !isReturnFromMinimize && !isRestore && myUid && myProfile && roomId && pinGate === 'passed') {
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
  }, [myUid, myProfile, myName, myPhotoURL, roomId, pinGate, isReturnFromMinimize, isRestore]);

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
  // 2026-10-26 (typing-jitter fix): at-bottom tracking + scroll-button
  // ref-guard (same pattern as the inbox) — auto-scroll only when the
  // user is already at the bottom; never yank a history reader.
  const chatAtBottomRef = useRef(true);
  const showChatScrollBtnRef = useRef(false);
  
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // 2026-10-26 (boss: room chat = session + last 30): the join timestamp of
  // the CURRENT stay. Set by the session effect below (reused across
  // minimize-return, fresh on every real entry).
  const chatSessionJoinTsRef = useRef<number>(0);
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
  // 2026-10-27 imo popup: window refs of the seat-grid cells, by seat index
  // (seatViewRefs above is keyed by member id and skips empty seats).
  const seatCellRefs = useRef<(View | null)[]>([]);

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
  // ── Pair Handshake badges (boss pick, 2026-10-26: the ring is GONE)
  // One small handshake badge per ACTIVE adjacent pair, sitting in the
  // gap between the two avatars. The badge's colours + sparkle come from
  // that pair's own design (premium Store design, else the basic tier of
  // its intimacy value) — so the more the relationship grows, the more
  // colourful and sparkly the badge, with a gentle pulse. Chains are NOT
  // merged: A-B-C shows two badges (A↔B, B↔C), one per pair.
  const pairBadges = useMemo(() => {
    const out: { key: string; a: string; b: string; design: HandshakeDesign }[] = [];
    for (const p of adjacentPairs) {
      const d = pairData[p.key];
      if (!d || d.value < 1) continue;
      const design = (d.designKey && d.designKey !== BASIC_DESIGN_KEY && HANDSHAKE_DESIGNS[d.designKey])
        ? HANDSHAKE_DESIGNS[d.designKey]
        : resolveDesign(null, intimacyLevelFor(d.value).id);
      out.push({ key: p.key, a: p.a, b: p.b, design });
    }
    return out;
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
  const [seatActionAnchor, setSeatActionAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
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
  const [deliciousOpen,   setDeliciousOpen]   = useState(false);
  const [rankOpen,        setRankOpen]        = useState(false);
  const [propsOpen,       setPropsOpen]       = useState(false);
  // 2026-10-19 (IMO gap fill): announcement + intimacy + backpack
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [intimacyOpen,     setIntimacyOpen]     = useState(false);
  const [backpackOpen,     setBackpackOpen]     = useState(false);
  const [announcement,     setAnnouncement]     = useState<RoomAnnouncement | null>(null);
  const [gameNav,         setGameNav]         = useState<{ kind: GameType; gameId: string | null } | null>(null);
  const [activeMember,    setActiveMember]    = useState<Participant | null>(null);
  // 2026-10-25 (boss): three-dot customize panel + room music state.
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [musicOpen,     setMusicOpen]     = useState(false);
  const [music,         setMusic]         = useState<RoomMusic | null>(null);
  useEffect(() => {
    if (!roomId) {
      setMusic(null);
      return;
    }
    return subscribeRoomMusic(roomId, setMusic);
  }, [roomId]);
  // 2026-10-25 (boss): 1v1 PK — challenge prompt for the opponent.
  const [pkOpen, setPkOpen] = useState(false);
  const [pk, setPk] = useState<RoomPk | null>(null);
  const pkAlertShownRef = useRef('');
  useEffect(() => {
    if (!roomId) {
      setPk(null);
      return;
    }
    return subscribeRoomPk(roomId, setPk);
  }, [roomId]);
  // 2026-10-25 (boss, full Ludu concept): a live Ludu lobby is visible
  // to EVERY room occupant — the strip below renders from this live
  // subscription, so the lobby appears the moment the host creates it
  // and disappears the moment it starts or ends.
  const [luduLobby, setLuduLobby] = useState<RoomGame | null>(null);
  useEffect(() => {
    if (!roomId) {
      setLuduLobby(null);
      return;
    }
    return subscribeGames(roomId, (games) => {
      const lobby = games.find((g) => g.type === 'ludu' && g.status === 'lobby');
      setLuduLobby(lobby ?? null);
    });
  }, [roomId]);
  useEffect(() => {
    if (!pk || pk.status !== 'challenge' || pk.opponent.uid !== myUid || pkOpen) return;
    const key = String(pk.challengedAt);
    if (pkAlertShownRef.current === key) return;
    if (Date.now() > pk.challengedAt + PK_CHALLENGE_TIMEOUT_MS) return;
    pkAlertShownRef.current = key;
    Alert.alert(
      'PK Challenge',
      `${pk.challenger.name} challenged you to a ${Math.round(((pk.durationMs > 0 ? pk.durationMs : 300000) / 60000))}-minute 1vs1 PK battle!`,
      [
        { text: 'Decline', style: 'cancel', onPress: () => removePk(roomId).catch(() => {}) },
        { text: 'Accept', onPress: () => { setPkOpen(true); acceptPk(roomId).catch(() => {}); } },
      ],
    );
  }, [pk, myUid, pkOpen, roomId]);
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
      if (typeof info.name === 'string' && info.name) setRoomName(info.name);
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

  // 2026-10-25 (boss: mic drops + re-enables on minimize→return): the
  // seat-sync stop below must NOT fire on a merely not-yet-loaded seats
  // snapshot. Set false when the subscription (re)starts, true on the
  // first snapshot of any kind (even a sig-identical one).
  const seatsLoadedRef = useRef(false);
  useEffect(() => {
    seatsLoadedRef.current = false;
    return subscribeSeats(roomId, (fbSeats) => {
      seatsLoadedRef.current = true;
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

  // 2026-10-26 (boss: room chat = session + last 30): the chat view starts
  // fresh on every entry. A stored session survives minimize-return (the
  // screen remounts but the user never left); any other mount starts a
  // new session. The cleanup clears the session unless the user minimized
  // (the minimized record proves they never left) — so explicit leave,
  // kick/disband navigation and invite-to-another-room all end the
  // session, and the next entry shows nothing from before.
  // 2026-10-26 (weak network outbox): update an echo's send state in
  // both the pending list (so subscription fires keep it) and the
  // rendered list. Never removes from pending on ack — the
  // subscription's delivered-filter cleans it up when the snapshot
  // arrives, and echoes the snapshot never delivers (old-ts restores)
  // stay visible instead of vanishing.
  const markEchoSendState = useCallback((echoId: string, state: 'sending' | 'failed' | undefined) => {
    pendingEchoesRef.current = pendingEchoesRef.current.map((e) => (e.id === echoId ? { ...e, sendState: state } : e));
    setMessages((prev: ChatMsg[]) => prev.map((m) => (m.id === echoId ? { ...m, sendState: state } : m)));
  }, []);

  // Tap-to-retry for a failed own echo. Re-sends the ORIGINAL payload
  // verbatim (echo's sender/color/text/ts/replyTo + own uid) under the
  // SAME key — idempotent overwrite, never a duplicate. 'blocked' stays
  // final: drop the echo + alert, exactly like a first-send block.
  const retryChatEcho = useCallback((msg: ChatMsg) => {
    if (!roomId || !myUid || msg.sendState !== 'failed') return;
    const payload: Omit<RoomChatMsg, 'id' | 'isMe'> = {
      senderId: myUid,
      senderName: msg.sender,
      senderColor: msg.color,
      text: msg.text,
      ts: msg.ts,
      ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
    };
    markEchoSendState(msg.id, 'sending');
    sendRoomChatMsg(roomId, payload, msg.id).then(() => {
      markEchoSendState(msg.id, undefined);
      void removeOutboxEntry(roomId, msg.id);
    }).catch((err) => {
      if (err instanceof Error && err.message === 'blocked') {
        pendingEchoesRef.current = pendingEchoesRef.current.filter((e) => e.id !== msg.id);
        setMessages((prev: ChatMsg[]) => prev.filter((m) => m.id !== msg.id));
        void removeOutboxEntry(roomId, msg.id);
        Alert.alert(
          t('voiceRoom.screen.blockedTitle'),
          t('voiceRoom.screen.commentBlockedMsg'),
        );
        return;
      }
      markEchoSendState(msg.id, 'failed');
    });
  }, [roomId, myUid, t]);

  useEffect(() => {
    const existing = getRoomChatSession(roomId);
    const joinTs = existing ?? Date.now();
    chatSessionJoinTsRef.current = joinTs;
    if (!existing) setRoomChatSession(roomId, joinTs);
    return () => {
      if (getMinimizedRoom()?.id !== roomId) clearRoomChatSession(roomId);
    };
  }, [roomId]);

  // 2026-10-26 (weak network outbox): resume sends that were in flight
  // when the app was killed mid-outage. Declared after the session
  // effect so the subscription (declared next) picks the restored
  // echoes up in its first fire via pendingEchoesRef.
  const outboxRestoredRoomRef = useRef<string | null>(null);
  useEffect(() => {
    if (!roomId || !myUid || outboxRestoredRoomRef.current === roomId) return;
    outboxRestoredRoomRef.current = roomId;
    void (async () => {
      const entries = await loadOutboxEntries(roomId);
      for (const entry of entries) {
        if (pendingEchoesRef.current.some((e) => e.id === entry.id)) continue;
        const echo: ChatMsg = { ...fbChatToMsg({ ...entry.payload, id: entry.id, isMe: true }), sendState: 'sending' };
        pendingEchoesRef.current = [...pendingEchoesRef.current, echo];
        setMessages((prev: ChatMsg[]) => [...prev, echo]);
        // Fire-and-forget re-send of the ORIGINAL payload under the same
        // key; ack clears it, failure marks it for tap-to-retry.
        sendRoomChatMsg(roomId, entry.payload, entry.id).then(() => {
          markEchoSendState(entry.id, undefined);
          void removeOutboxEntry(roomId, entry.id);
        }).catch((err) => {
          if (err instanceof Error && err.message === 'blocked') {
            pendingEchoesRef.current = pendingEchoesRef.current.filter((e) => e.id !== entry.id);
            setMessages((prev: ChatMsg[]) => prev.filter((m) => m.id !== entry.id));
            void removeOutboxEntry(roomId, entry.id);
            return;
          }
          markEchoSendState(entry.id, 'failed');
        });
      }
    })();
  }, [roomId, myUid, markEchoSendState]);

  useEffect(() => {
    return subscribeRoomChat(roomId, myUid, (fbMsgs) => {
      // 2026-10-26 (boss: session + last 30): only this stay's messages,
      // capped at the last 30 — pre-join messages and anything older than
      // the window never render. There is no Load earlier anymore: the
      // window IS the history.
      const joinTs = chatSessionJoinTsRef.current;
      const visible = (joinTs > 0 ? fbMsgs.filter(m => (m.ts ?? 0) >= joinTs) : fbMsgs).slice(-30);
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
      // 2026-10-26 (typing-jitter fix): auto-scroll ONLY when already at
      // the bottom — a scrolled-up reader must never be yanked by a new
      // message; the scroll button brings them back on tap.
      if (!chatAtBottomRef.current) return;
      if (scrollTimerRef.current !== null) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        scrollTimerRef.current = null;
        chatRef.current?.scrollToEnd({ animated: false });
      }, 80);
    });
  }, [roomId, myUid]);

  useEffect(() => {
    // 2026-10-26 (boss: every genuine entry must show its join line):
    // one line per genuine entry — fresh mount, not a restore, not a
    // minimize return. The ref blocks same-mount duplicates (the
    // original 2026-10-23 repeat-line complaint) and the shared key
    // blocks site 2's double. No time-based suppression anymore.
    if (hasSentEntryChatMsgRef.current || isRestore || isReturnFromMinimize) return;
    // 2026-10-26 (boss: join lines showed 'Vee User' for EVERYONE): the old
    // guard only required myName, which is never falsy (fallback 'Vee User')
    // — so the line fired before async myProfile loaded, and the sent-ref
    // then blocked the correction. Wait for the profile OBJECT like the
    // entry-banner effect does: named -> real nickname, nameless -> true
    // fallback. The ref stays unset while waiting, so the re-run on profile
    // load still sends exactly one line.
    if (!roomId || !myUid || !myProfile) return;
    hasSentEntryChatMsgRef.current = true;
    const isOwner = ownerId && ownerId === myUid;
    const displayName = isOwner ? `${myName} 👑` : myName;
    addSentJoinMsgKey(`${roomId}:${myUid}`);
    sendRoomChatMsg(roomId, {
      senderId: 'system',
      senderName: 'System',
      senderColor: C.gold,
      text: t('voiceRoom.screen.joinedRoom', { name: displayName }),
      ts: Date.now() }).catch(() => {});
  }, [roomId, myUid, myName, myProfile, ownerId, t, isRestore, isReturnFromMinimize]);

  
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
    const beat = () => refreshSeatHeartbeat(roomId, mySeatIdx, myUid, myName).catch(() => {});
    beat(); // immediate first beat on seating
    const timer = setInterval(beat, 60_000);
    return () => clearInterval(timer);
  }, [roomId, mySeatIdx, myUid]);

  // 2026-10-27 (boss: host-seat leave stops music completely, new host
  // sees NO music and must play anew). The TRIGGER is mySeatIdx === 0
  // specifically — NOT isHostSeat (which is also true for the room
  // owner in any seat; repeating that trap would leave the owner
  // controlling music from seat 3). On a CONFIRMED transition away
  // from seat 0 (to another seat, or to unseated/audience) while music
  // plays/pauses, write state 'stopped' at once. The mount-transient
  // -1 never fires: the first render carries the -2 sentinel (prev is
  // never 0), and seatsLoadedRef (the same confirmed-snapshot guard
  // the mic sync uses) must be true. The bot's seat-0 watcher finishes
  // the clear (current + queue removed, state idle) so nothing of the
  // old track renders for the next host; it also covers the cases
  // this effect cannot see (app closed, process death). This effect
  // writes ONLY the music state — it never touches the mic.
  const prevHostSeatRef = useRef(-2); // -2 = unknown (first render)
  const musicState = music?.state;
  useEffect(() => {
    const prev = prevHostSeatRef.current;
    prevHostSeatRef.current = mySeatIdx;
    if (prev !== 0) return;
    if (mySeatIdx === 0) return;
    if (!seatsLoadedRef.current) return;
    if (musicState !== 'playing' && musicState !== 'paused') return;
    setMusicState(roomId, 'stopped').catch(() => {});
  }, [mySeatIdx, musicState, roomId]);
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
        refreshSeatHeartbeat(roomId, mySeatIdxRef.current, myUid, myName).catch(() => {});
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
  const [returningSeatIdx, setReturningSeatIdx] = useState(() => {
    const prev = getMinimizedRoom();
    if (prev && prev.id === roomId && prev.mySeatIdx >= 0 && prev.muted === false) return prev.mySeatIdx;
    return -1;
  });

  // 2026-10-26 (mic durability): the bar used to clear minimizedRoom
  // BEFORE router.push, so these initializers (render-time) read null
  // and the return fast-path was dead. The record is now cleared HERE,
  // after render has captured it into the initializers above.
  useEffect(() => {
    if (isReturnFromMinimize || returningSeatIdx >= 0) setMinimizedRoom(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // 2026-10-26 (stale-seat heal): first sight of this seat — a muted
    // value disagreeing with live intent is STALE (a failed seat-mute
    // write), never force it onto the mic; the FB sync effect below
    // rewrites the seat instead. Later fires keep normal sync.
    const firstForSeat = prevHostSeatIdxRef.current !== mySeatIdx;
    if (firstForSeat) {
      prevHostMutedRef.current = null;
      prevHostSeatIdxRef.current = mySeatIdx;
    }
    const mySeat = seats[mySeatIdx];
    if (!mySeat || !isPublishing) return;
    const hostMuted = mySeat.hostMuted === true;
    if (prevHostMutedRef.current === hostMuted) return;
    prevHostMutedRef.current = hostMuted;
    // 2026-10-26 (boss: return from background/minimize auto-mutes): a seat row
    // without an explicit `muted` field carries NO mic intent — never mute on it.
    // Only explicit true/false moves the mic; undefined holds current state.
    // Host-mute still always wins on explicit true.
    if (hostMuted) setMicMuted(true);
    else if (mySeat.muted !== undefined) {
      if (firstForSeat && mySeat.muted !== mutedRef.current) return;
      setMicMuted(mySeat.muted);
    }
  }, [seats, mySeatIdx, isPublishing]);
  useEffect(() => {
    if (mySeatIdx < 0) {
      prevFbMutedRef.current = null;
      prevMySeatIdxRef.current = -1;
      // 2026-10-26 (mic durability): the mount-transient -1 (seats not
      // loaded yet) must NOT wipe a bar-toggle intent recorded while
      // minimized — only clear when seatlessness is CONFIRMED (same
      // rule as the stopPublishing() gate in this branch).
      if (seatsLoadedRef.current) clearPendingSeatMute();
      // 2026-10-25 (boss: mic drops + re-enables on minimize→return):
      // on return the voice restore sets isPublishing=true SYNCHRONOUSLY
      // at mount, before the seats snapshot arrives — so mySeatIdx is
      // transiently -1 and this branch used to stopPublishing(), then the
      // publish effect re-started it once seats loaded: the exact drop +
      // re-enable he felt, on EVERY return. Only stop when seatlessness
      // is CONFIRMED (a seats snapshot has arrived and he still has no
      // seat — e.g. kicked while minimized). A merely not-yet-loaded
      // snapshot must never touch the mic.
      if (seatsLoadedRef.current && isPublishing) {
        stopPublishing();
      }
      return;
    }
    if (prevMySeatIdxRef.current !== mySeatIdx) {
      prevFbMutedRef.current = null;
      prevMySeatIdxRef.current = mySeatIdx;
      clearPendingSeatMute();
    }
    const mySeat = seats[mySeatIdx];
    if (!mySeat) return;
    const fbMuted = mySeat.muted;
    if (!isPublishing) {
      prevFbMutedRef.current = null;
      return;
    }
    if (prevFbMutedRef.current === fbMuted) return; // no change
    // 2026-10-26 (boss: return auto-mutes): undefined carries no intent — hold
    // the mic and keep prev at the last explicit value, so a later explicit
    // value still fires. Never let an undefined snapshot mute or unmute.
    if (fbMuted === undefined) return;
    // 2026-10-26 (stale-seat heal): first sight of this seat (prev null)
    // with a value disagreeing with live intent = STALE seat (a seat-mute
    // write that failed while offline/backgrounded, or a bar toggle whose
    // seat write never landed). Rewrite the seat instead of forcing the
    // stale value onto the mic (that was the return auto-on/off).
    // Success marks prev = intent so the corrected snapshot is a no-op;
    // failure leaves prev null so the next seats change retries the heal.
    // Host-mute never heals (hostMuted wins separately, below). Later
    // fires (prev set) keep normal cross-device sync.
    if (prevFbMutedRef.current === null && fbMuted !== engineMutedRef.current && mySeat.hostMuted !== true) {
      const intent = engineMutedRef.current;
      setSeatMute(roomId, mySeatIdx, intent)
        .then(() => { prevFbMutedRef.current = intent; })
        .catch(() => {});
      return;
    }
    // 2026-10-26 (boss: icon muted + voice live / muted auto-unmute): a
    // local tap's seat write can fail silently mid-stay. While its intent
    // is pending and the engine still holds it, retry the write (throttled)
    // and NEVER let the stale snapshot force the mic (that was the
    // auto-unmute: the stale snapshot enforced itself onto the engine).
    // Clear when the snapshot confirms, or when intent moved (remote/host
    // took over — normal sync then owns it). Host-mute always wins.
    const pend = getPendingSeatMute();
    if (pend && pend.roomId === roomId && pend.seatIdx === mySeatIdx && mySeat.hostMuted !== true) {
      if (engineMutedRef.current !== pend.value) {
        clearPendingSeatMute();
      } else if (fbMuted !== pend.value) {
        if (Date.now() - pend.lastTry >= 3000) {
          pend.lastTry = Date.now();
          setSeatMute(roomId, mySeatIdx, pend.value).catch(() => {});
        }
        return;
      } else {
        clearPendingSeatMute();
      }
    }
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
      // 2026-10-25 (boss: no entry indicators on return): same gate as
      // the self entry banner — a minimized return never re-sends the
      // join line either (the 30-min slot gate below stays as backstop).
      if (!isRestore && !isReturnFromMinimize && !hasSentEntryChatMsgRef.current && !sentJoinMsgKeys.has(joinKey) && myProfile) {
        hasSentEntryChatMsgRef.current = true;
        // 2026-10-26: per-stay gate only (the 30-minute persisted slot is
        // gone — it hid every rejoin line). Site 1 above sends first on
        // a fresh mount, so this is only a backstop for mounts where
        // site 1 never ran; the ref + key here block any double.
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
      // 2026-10-22: a superseded (stacked-under) room screen must not
      // resurrect its presence on reconnect — the user has moved on to a
      // different active room (see the one-active-room guard at join).
      const activeNow = getCurrentRoom();
      if (activeNow && activeNow.id !== roomId) return;
      try {
        // 2026-10-26 (boss: seated user invisible while talking — many
        // users): mySeatIdx is DERIVED from the live seats subscription,
        // so after the guard sweeps a seat (frozen app: heartbeats stopped
        // + LiveKit dead) the derived index is -1 even though the user
        // never left — and the old code then re-registered them as
        // AUDIENCE while the returning-seat mic fast path kept publishing:
        // talking + hearing with NO seat record = invisible on the grid
        // for everyone, including themselves, until they manually re-tap
        // a seat. Fall back to the persisted seat (minimized room, then
        // active room) — the record of a seat held without an explicit
        // leave — and restore it with the same empty-or-mine check below.
        // Kick safety: owner kicks always write roomBlocks (checked live
        // below), global bans are checked live too, and a seat taken by
        // someone else still demotes to audience. Live kicks are never
        // undone by this: the restore runs only on reconnect/foreground/
        // mount, never on a live subscription update.
        let seatIdx = mySeatIdxRef.current;
        const fromPersisted = seatIdx < 0;
        if (fromPersisted) {
          const minRoom = getMinimizedRoom();
          const curRoom = getCurrentRoom();
          const persisted = (minRoom && minRoom.id === roomId) ? minRoom
            : (curRoom && curRoom.id === roomId) ? curRoom : null;
          if (persisted && persisted.mySeatIdx >= 0) seatIdx = persisted.mySeatIdx;
        }
        const audData = {
          userId: myUid,
          userName: myName,
          initials: myInitials,
          color: myColor,
          ...(myPhotoURL ? { photoURL: myPhotoURL } : {}),
          ...(myNobleRankRef.current != null ? { nobleRankIndex: myNobleRankRef.current } : {}) };
        // Live kick/ban guards for a persisted-fallback restore only. A
        // seat derived from live seats needs no check (a kicked user's
        // seat is gone, so they never arrive here with seatIdx >= 0 from
        // derivation). Reads are fail-open: a failed read restores,
        // exactly today's behaviour — only a PROVEN block/ban refuses.
        if (seatIdx >= 0 && fromPersisted) {
          const blockedSnap = await get(ref(database, `roomBlocks/${roomId}/${myUid}`)).catch(() => null);
          if (blockedSnap?.exists()) { setReturningSeatIdx(-1); return; }
          const ban = await checkVoiceBan(myUid).catch(() => null);
          if (ban) { setReturningSeatIdx(-1); return; }
          if (seatIdx === 0) {
            // Host seat is owner/admin-only (mirrors takeSeatInner).
            // Proven non-privilege demotes to audience; read failure
            // restores (fail open — never demote an owner on a blip).
            try {
              const [infoSnap, adminSnap] = await Promise.all([
                get(ref(database, `rooms/${roomId}/info`)),
                get(ref(database, `rooms/${roomId}/admins/${myUid}`)),
              ]);
              const info = infoSnap?.val() as { ownerId?: string } | null;
              const privileged = info?.ownerId === myUid || adminSnap?.exists();
              if (!privileged) seatIdx = -1;
            } catch { /* fail open — restore */ }
          }
        }
        if (seatIdx >= 0) {
          const seatSnap = await get(ref(database, `rooms/${roomId}/seats/${seatIdx}`)).catch(() => null);
          const cur = seatSnap?.val() as { userId?: string } | null;
          if (!cur || cur.userId === myUid) {
            const seatData = buildSeatData();
            // 2026-10-26 (boss: return from background/minimize auto-mutes):
            // presence re-register must never overwrite mic intent with a
            // transient value — on foreground reconnect mutedRef can still hold
            // the fresh-join default (true) while the seat row already knows the
            // user was unmuted, and the sync effects would then enforce that
            // false mute. A row that is mine keeps its own explicit muted; only
            // an empty seat falls back to mutedRef.
            const curMuted = (cur as { muted?: boolean } | null)?.muted;
            seatData.muted = curMuted !== undefined ? curMuted : mutedRef.current;
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
            // Seat taken by someone else while away: demote to audience
            // AND disarm the returning-seat mic fast path — otherwise the
            // publish effect keeps the demoted user talking from the
            // audience with no seat (the invisible-talker state).
            setReturningSeatIdx(-1);
            setCurrentRoom({ id: roomId, myUid, mySeatIdx: -1 });
            persistActiveRoom({ roomId, myUid, mySeatIdx: -1 }).catch(() => {});
            await joinRoomAsAudience(roomId, audData).catch(() => {});
          }
        } else {
          // Audience outcome: never publish via the returning-seat fast
          // path (audience listens; only a seat grants the mic).
          setReturningSeatIdx(-1);
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
  // 2026-10-27 (boss, correction): the floating music icon is visible to
  // EVERYONE in the room while music plays/pauses. Only the sheet's
  // maintain actions are host-seat gated — STRICT seat 0 (mySeatIdx
  // === 0, used at the MusicFlowModal below), NOT isHostSeat: isHostSeat
  // is also true for the room owner in any seat, and an owner in the
  // audience must get the member view. isHostSeat stays for the
  // customize panel (a separate feature, untouched).
  const isHostSeat = myRole === 'host' || mySeatIdx === 0;
  // 2026-10-25 (boss): the three-dot button itself is host-seat-only —
  // only an admin/owner SEATED in the host seat (seat 1) sees it.
  const isHostSeatedOwnerOrAdmin = isOwnerOrAdmin && mySeatIdx === 0;

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
    // 2026-10-26 (mic durability): this tap path is already host-guarded
    // above — record the user's own intent durably for cold-start seed.
    persistMicIntent(roomId, newMuted).catch(() => {});
    setSeats(prev => prev.map((s, i) =>
      i === mySeatIdx && s ? { ...s, muted: newMuted } : s,
    ));
    writeSeatMuteReliable(roomId, mySeatIdx, newMuted).catch(() => {});
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
        joinSeatRef.current?.(seatIdx);
      }
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSeatActionIdx(seatIdx);
    // 2026-10-27 imo popup: measure the tapped cell in window coordinates
    // first, so the menu anchors under that seat (clamped/flipped in the
    // sheet). Without a measure, the sheet falls back to a centered popup.
    const cell = seatCellRefs.current[seatIdx];
    if (cell) {
      cell.measureInWindow((x, y, w, h) => {
        setSeatActionAnchor({ x, y, width: w, height: h });
        setSeatActionOpen(true);
      });
    } else {
      setSeatActionAnchor(null);
      setSeatActionOpen(true);
    }
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
      persistMicIntent(roomId, false).catch(() => {});
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [seats, myUid, myName, myInitials, myColor, myRole, mySeatIdx, roomId, startPublishing, muted, t, buildSeatData, isOwnerOrAdmin]);

  // Mirror the latest joinSeat for handleSeatPress (declared above).
  useEffect(() => { joinSeatRef.current = joinSeat; }, [joinSeat]);

  
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

  // 2026-10-27 (boss: Room Info Unjoin = full Room Leave): Unjoin removes
  // membership (leaveRoomCompletely: roomMembers + userRooms + audience)
  // AND exits the session via the existing handleLeave path. The owner
  // never gets this path (the panel hides Unjoin for owners).
  const handleUnjoinRoom = useCallback(async () => {
    try { await leaveRoomCompletely(roomId, myUid); } catch { /* best-effort */ }
    setIsRoomMember(false);
    setHasJoined(false);
    handleLeave();
  }, [roomId, myUid, handleLeave]);

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
    const echo: ChatMsg = { ...fbChatToMsg({ ...payload, id, isMe: true }), sendState: 'sending' };
    pendingEchoesRef.current = [...pendingEchoesRef.current, echo];
    setMessages((prev: ChatMsg[]) => [...prev, echo]);
    // 2026-10-26 (weak network outbox): persist so kill-and-reopen resumes.
    void persistOutboxEntry(roomId, { id, payload });
    setChatInput('');
    setReplyingTo(null);
    setMentionQuery(null);
    chatAtBottomRef.current = true;
    if (scrollTimerRef.current !== null) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      scrollTimerRef.current = null;
      chatRef.current?.scrollToEnd({ animated: true });
    }, 80);
    sendRoomChatMsg(roomId, payload, id).then(() => {
      // Server acked — the echo becomes a normal message (kept in
      // pending until the snapshot delivers it; see markEchoSendState).
      markEchoSendState(id, undefined);
      void removeOutboxEntry(roomId, id);
    }).catch((err) => {
      if (err instanceof Error && err.message === 'blocked') {
        // Blocked is final — drop the echo, keep the alert, clear outbox.
        pendingEchoesRef.current = pendingEchoesRef.current.filter((e) => e.id !== id);
        setMessages((prev: ChatMsg[]) => prev.filter((m) => m.id !== id));
        void removeOutboxEntry(roomId, id);
        Alert.alert(
          t('voiceRoom.screen.blockedTitle'),
          t('voiceRoom.screen.commentBlockedMsg'),
        );
        return;
      }
      // NOT lost: the bubble stays with a tap-to-retry state instead of
      // vanishing. (The old input-restore is gone — the text lives in
      // the bubble; long-press Copy still recovers it for editing.)
      markEchoSendState(id, 'failed');
    });
    sendingMsgRef.current = false;
  }, [chatInput, replyingTo, roomId, myUid, myName, myColor, t, amChatBlocked, markEchoSendState]);

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
    const echo: ChatMsg = { ...fbChatToMsg({ ...payload, id, isMe: true }), sendState: 'sending' };
    pendingEchoesRef.current = [...pendingEchoesRef.current, echo];
    setMessages((prev: ChatMsg[]) => [...prev, echo]);
    // 2026-10-26 (weak network outbox): persist so kill-and-reopen resumes.
    void persistOutboxEntry(roomId, { id, payload });
    sendRoomChatMsg(roomId, payload, id).then(() => {
      markEchoSendState(id, undefined);
      void removeOutboxEntry(roomId, id);
    }).catch(() => {
      // Same outbox rule as text: keep the bubble, mark failed for
      // tap-to-retry (retry drops it with the blocked alert if blocked).
      markEchoSendState(id, 'failed');
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [roomId, myUid, myName, myColor]);

  const handleViewOtherProfile = useCallback((uid: string, name: string) => {
    router.push({ pathname: '/user-profile', params: { uid, name } } as Parameters<typeof router.push>[0]);
  }, []);

  const renderChatMessage = useCallback(
    ({ item }: { item: ChatMsg }) => (
      <RoomChatMessage item={item} accentColor={accentColor} onReply={setReplyingTo} onAction={setActionMsg} onRetry={retryChatEcho} />
    ),
    [accentColor],
  );

  
  const bottomPad  = Math.max(insets.bottom, Platform.OS === 'web' ? 20 : 8) + 14;
  // 2026-10-22 (Sumon): bottom-bar labels removed → bar content is now
  // 50dp (was 68 with the label row); the freed ~18dp goes to chat/seats.
  const BOTTOM_BAR_H = bottomPad + 4 + 50;

  
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    // 2026-10-26 (typing-jitter fix): no scroll-on-keyboard-open — the
    // 120ms timer raced the keyboard + pan animations and jumped on
    // every open, even with no new message.
    const onShow = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardOpen(true);
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
      // 2026-10-26 (typing-jitter fix): the keyboardOpen gate traded the
      // phantom pad for a per-cycle jump (KAV padding mounted/unmounted on
      // every keyboard show/hide, on top of OS pan). On Android the window
      // is adjustPan, so the OS itself keeps the focused input visible —
      // KAV stays OFF on Android entirely (no phantom pad possible, no
      // per-cycle jump). iOS keeps KAV as before.
      // on the KAV itself paints any transient frame in theme color.
      enabled={Platform.OS !== 'android'}
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
                    {(roomName || '?').charAt(0).toUpperCase()}
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
            {/* 2026-10-27 (boss): green + button by the room name,
                audience ONLY (showJoinBanner: non-member, non-owner/admin,
                unseated). Tap = handleJoinRoom (writes the member record). */}
            {showJoinBanner && (
              <ScalePress onPress={handleJoinRoom}>
                <View style={{
                  width: 36, height: 36, borderRadius: 18,
                  backgroundColor: '#22C55E',
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: '#22C55E', shadowOpacity: 0.5, shadowRadius: 8,
                  shadowOffset: { width: 0, height: 2 } }}>
                  <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900', lineHeight: 26 }}>+</Text>
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
              {/* 2026-10-27 (boss): settings gear moved into the Room Info
                  panel — no longer duplicated in the room header. */}
              {/* 2026-10-25 (boss): three-dot customize panel — ONLY an
                  admin/owner seated in the host seat sees it. */}
              {isHostSeatedOwnerOrAdmin && (
                <ScalePress onPress={() => setCustomizeOpen(true)}>
                  <Feather name="more-vertical" size={26} color={C.sub} />
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
        {/* 2026-10-27 (boss): big join banner card REMOVED — the green
            + button by the room name is the only join CTA. */}

        {}
        {/* 2026-10-26 (boss): viewer's role pill REMOVED — nothing sits
            between the header and the seat grid now, so the grid moves up.
            Role POWERS are untouched (myRole checks elsewhere). */}

        {}
        {}
        {!voiceError && (voiceConnection === 'reconnecting' || voiceConnection === 'failed') && (
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            backgroundColor: 'rgba(245,158,11,0.12)',
            borderWidth: 1, borderColor: 'rgba(245,158,11,0.45)',
            borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9,
            marginBottom: 6 }}>
            <Feather name="wifi-off" size={16} color="#F59E0B" />
            <Text style={{ flex: 1, color: themeOnBg, fontSize: 12, fontWeight: '600' }}>
              {t('voiceRoom.screen.reconnecting', { defaultValue: 'Reconnecting… voice will resume automatically' })}
            </Text>
          </View>
        )}

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
        {/* 2026-10-25 (boss, imo-style): the PK banner sits at the TOP of the
            room, above the seats — never buried under the seats/announcement
            inside the comment box. Tap opens the PK modal. Shown for active
            battles AND pending challenges. */}
        {pk && (pk.status === 'active' || pk.status === 'challenge') && (
          <View style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 6 }}>
            <PkBanner
              pk={pk}
              onPress={() => setPkOpen(true)}
              challengerPhotoURL={seats.find((s) => s?.id === pk.challenger.uid)?.photoURL}
              opponentPhotoURL={seats.find((s) => s?.id === pk.opponent.uid)?.photoURL}
            />
          </View>
        )}
        <View ref={gridWrapRef} style={{ position: 'relative', marginBottom: 4, marginHorizontal: -6 }}>
        {/* Pair Handshake layer — badges sit ON TOP of the seat grid
            (zIndex 3) in the gap between each active pair, pointerEvents
            none so seat taps pass through. Avatar centre = cell top +
            44.5 (was 47 at SEAT_SIZE 53; centres moved up 2.5 when seats
            shrank to 48). One badge per pair;
            no ring anywhere (boss pick, 2026-10-26). */}
        {pairBadges.map((b) => {
          const gf = cellGeom[b.a];
          const gl = cellGeom[b.b];
          if (!gf || !gl) return null;
          const cx = (gf.x + gf.w / 2 + gl.x + gl.w / 2) / 2;
          const cy = gf.y + 44.5; // 2026-10-26: SEAT_SIZE 53 -> 48, centres up 2.5
          return (
            <View
              key={b.key}
              pointerEvents="none"
              style={{ position: 'absolute', left: cx - HANDSHAKE_BADGE / 2, top: cy - HANDSHAKE_BADGE / 2, zIndex: 3 }}
            >
              <PairHandshake design={b.design} />
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
                seatCellRefs.current[idx] = v;
                const id = member?.id;
                if (!id) return;
                if (v) seatViewRefs.current[id] = v;
                else delete seatViewRefs.current[id];
              }}
            >
              <SeatCard
                seatIndex={idx}
                member={member}
                selfMuted={muted}
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
          {/* 2026-10-25 (boss, full Ludu concept): the live lobby strip —
              every room occupant sees an open lobby right here, no
              panel/modal hunt. Tap opens the lobby page (join from "+"
              inside for seated users). */}
          {luduLobby && (
            <LuduLobbyStrip
              game={luduLobby}
              onPress={() => setGameNav({ kind: 'ludu', gameId: luduLobby.id })}
            />
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
              chatAtBottomRef.current = isAtBottom;
              // 2026-10-26 (typing-jitter fix): ref-guard — throttle 16
              // fires ~60/s; setState only when the boolean flips.
              if (showChatScrollBtnRef.current !== !isAtBottom) {
                showChatScrollBtnRef.current = !isAtBottom;
                setShowChatScrollBtn(!isAtBottom);
              }
            }}
            scrollEventThrottle={16}
            initialNumToRender={20}
            maxToRenderPerBatch={10}
          />
          {}
          {showChatScrollBtn && (
            <Pressable
              onPress={() => {
                chatRef.current?.scrollToEnd({ animated: true });
                chatAtBottomRef.current = true;
                showChatScrollBtnRef.current = false;
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
            // 2026-10-26 (typing-jitter fix): absolute overlay above the
            // input bar — inserting/removing this box in flow shrank/grew
            // the chat list by up to 180dp on every @ keystroke. Bottom
            // clears the input bar (62) and, while replying, the reply bar.
            position: 'absolute', left: 8, right: 8, zIndex: 50,
            bottom: replyingTo ? 112 : 70,
            maxHeight: 180,
            backgroundColor: '#FFFFFF',
            borderRadius: 14,
            borderWidth: 1, borderColor: accentColor + '55',
            overflow: 'hidden',
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
        setGamesOpen={setGamesOpen}
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
        seatActionAnchor={seatActionAnchor}
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
        onJoinRoom={handleJoinRoom}
        onUnjoinRoom={handleUnjoinRoom}
        setSeatQueueOpen={setSeatQueueOpen}
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
        onOpenDelicious={() => { setGamesOpen(false); setDeliciousOpen(true); }}
      />
      {/* 2026-10-25: global Delicious game sheet over the room (real
          diamonds, bot-settled). NOT a roomGameService game — no GameType. */}
      <DeliciousGameSheet
        visible={deliciousOpen}
        myUid={myUid}
        onClose={() => setDeliciousOpen(false)}
      />
      {/* 2026-10-25 (boss): imo-style customize panel + room music modal. */}
      <RoomCustomizePanel
        visible={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        isOwnerOrAdmin={isOwnerOrAdmin}
        isHostSeat={isHostSeat}
        nowPlayingTitle={music?.current && typeof music.current.title === 'string' ? music.current.title.replace(/\.[^.]+$/, '') : null}
        onOpenMusic={() => { setCustomizeOpen(false); setMusicOpen(true); }}
        onOpenGames={() => { setCustomizeOpen(false); setGamesOpen(true); }}
        onOpenLudu={() => { setCustomizeOpen(false); setGameNav({ kind: 'ludu', gameId: null }); }}
        onOpenAnnouncement={() => { setCustomizeOpen(false); setAnnouncementOpen(true); }}
        onOpenPk={() => { setCustomizeOpen(false); setPkOpen(true); }}
        activeThemeId={activeThemeId}
        onThemeChange={(newThemeId) => {
          // Optimistic local update + Firebase sync so ALL users see the change.
          activeThemeIdRef.current = newThemeId;
          setActiveThemeId(newThemeId);
          updateRoomSettings(roomId, { themeId: newThemeId }).catch(() => {
            Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.screen.settingsSaveError'));
          });
        }}
      />
      {/* 2026-10-27 (boss, correction): music maintain is HOST-SEAT ONLY.
          canControl = STRICT seat 0 (mySeatIdx === 0, NOT isHostSeat —
          isHostSeat is also true for the room owner in any seat). An
          owner/admin NOT in the host seat opens the same sheet but gets
          the member view: song + real player name + own volume only,
          no maintain. */}
      <MusicFlowModal
        visible={musicOpen}
        onClose={() => setMusicOpen(false)}
        roomId={roomId}
        canControl={mySeatIdx === 0}
        myName={myName}
        onVolumeChange={setMusicVolume}
        activeThemeId={activeThemeId}
      />
      {/* 2026-10-27 (boss): floating music icon — the ONLY music presence
          on the room display while music plays/pauses. Visible to EVERYONE
          (no isHostSeat / owner / admin gate here); tap opens the same
          music sheet the bar tap used to open. Draggable, position
          persisted per device inside FloatingMusicIcon (never RTDB). */}
      {music?.current && (music.state === 'playing' || music.state === 'paused') && (
        <FloatingMusicIcon
          paused={music.state === 'paused'}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMusicOpen(true); }}
        />
      )}
      <PkModal
        visible={pkOpen}
        onClose={() => setPkOpen(false)}
        roomId={roomId}
        myUid={myUid}
        myName={myName}
        mySeatIdx={mySeatIdx}
        seats={seats}
        isOwnerOrAdmin={isOwnerOrAdmin}
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
      {gameNav?.kind === 'ludu' && (
        <LuduGameModal
          visible
          roomId={roomId}
          hostUid={myUid}
          hostName={myName}
          myUid={myUid}
          myName={myName}
          myPhotoURL={myPhotoURL ?? null}
          isHost={isOwnerOrAdmin}
          mySeatIdx={mySeatIdx}
          gameId={gameNav.gameId}
          micMuted={mySeatIdx >= 0 ? (seats[mySeatIdx]?.muted ?? muted) : true}
          onToggleMic={toggleMic}
          onClose={() => setGameNav(null)}
        />
      )}
    </View>
    </KeyboardAvoidingView>
  );
}
