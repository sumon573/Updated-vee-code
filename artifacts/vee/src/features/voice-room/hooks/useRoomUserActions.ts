import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { ref, onValue, update } from 'firebase/database';
import { database } from '@/src/config/firebase';
import {
  subscribeRoomBlocks,
  blockUserInRoom,
  unblockUserInRoom,
  sendSeatInvite,
  removeMemberFromRoom,
  setSeatRole,
  setAudienceRole,
  grantRoomAdmin,
  revokeRoomAdmin,
  type RoomBlockRecord,
} from '@/src/features/voice-room/services/firebaseRoomService';
import { canShowRoomActionBar } from '@/src/features/voice-room/components/RoomUserActionBar';
import type { Role } from '@/src/features/voice-room/types/room';

/* ── 2026-11-11 (boss, imo mirror): room context for the FULL profile ────
   When the profile is opened FROM a room (roomId param), the 5-icon bar
   needs live room state: viewer/target roles, comment-block state, and the
   moderation actions. This hook subscribes to the room's owner/admins/
   seats/audience/blocks (push-based, no polling) and resolves roles with
   the SAME order as the room screen (owner → registry admin → seat label
   → audience label → member). Actions use the DIRECT RTDB services — the
   production path (pass2 is staging-only, flags off in production, and the
   room screen itself runs the direct path there). When roomId is absent
   the hook is inert (null roles, no subscriptions, no-op actions). */

type SeatRec = { userId?: string; role?: string; locked?: boolean; color?: string; initials?: string; name?: string } | null;
type AudRec = { role?: string; color?: string; initials?: string; name?: string };

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function useRoomUserActions(roomId: string | undefined, myUid: string | undefined, targetUid: string | undefined, targetName: string, myName: string) {
  const { t } = useTranslation();
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [roomName, setRoomName] = useState('');
  const [adminUids, setAdminUids] = useState<Set<string>>(new Set());
  const [seatRecs, setSeatRecs] = useState<SeatRec[]>([]);
  const [audienceRecs, setAudienceRecs] = useState<Record<string, AudRec>>({});
  const [blocks, setBlocks] = useState<Map<string, RoomBlockRecord>>(new Map());

  useEffect(() => {
    if (!roomId) return;
    const unsubs: Array<() => void> = [];
    unsubs.push(onValue(ref(database, `rooms/${roomId}/info`), (snap) => {
      const v = snap.val() as { ownerId?: string; name?: string } | null;
      setOwnerId(v?.ownerId ?? null);
      setRoomName(v?.name ?? '');
    }));
    unsubs.push(onValue(ref(database, `rooms/${roomId}/admins`), (snap) => {
      const s = new Set<string>();
      if (snap.exists()) snap.forEach((c) => { if (c.key) s.add(c.key); });
      setAdminUids(s);
    }));
    unsubs.push(onValue(ref(database, `rooms/${roomId}/seats`), (snap) => {
      const v = (snap.val() ?? {}) as Record<string, SeatRec>;
      const arr: SeatRec[] = [];
      for (let i = 0; i < 10; i += 1) arr.push(v[String(i)] ?? null);
      setSeatRecs(arr);
    }));
    unsubs.push(onValue(ref(database, `rooms/${roomId}/audience`), (snap) => {
      setAudienceRecs((snap.val() ?? {}) as Record<string, AudRec>);
    }));
    unsubs.push(subscribeRoomBlocks(roomId, setBlocks));
    return () => { unsubs.forEach((u) => u()); };
  }, [roomId]);

  const resolveRole = useCallback((uid: string | undefined): Role | null => {
    if (!uid || !roomId) return null;
    if (ownerId && ownerId === uid) return 'host';
    if (adminUids.has(uid)) return 'admin';
    const seat = seatRecs.find((s) => s?.userId === uid);
    if (seat?.role === 'host' || seat?.role === 'admin') return seat.role;
    const aud = audienceRecs[uid];
    if (aud?.role === 'admin') return 'admin';
    if (seat?.role) return seat.role as Role;
    return 'member';
  }, [roomId, ownerId, adminUids, seatRecs, audienceRecs]);

  const viewerRole = useMemo(() => resolveRole(myUid), [resolveRole, myUid]);
  const targetRole = useMemo(() => resolveRole(targetUid), [resolveRole, targetUid]);
  const canShowBar = viewerRole !== null && targetRole !== null && canShowRoomActionBar(viewerRole, targetRole);
  const isCommentBlocked = !!targetUid && blocks.get(targetUid)?.action === 'comment-block';
  const targetSeatIdx = useMemo(
    () => (targetUid ? seatRecs.findIndex((s) => s?.userId === targetUid) : -1),
    [seatRecs, targetUid],
  );
  const targetIsSeated = targetSeatIdx >= 0;
  const targetIsInAudience = !!targetUid && !!audienceRecs[targetUid];

  /** Display fields for the block record: prefer the live seat/audience
   * record, else derive initials from the name. */
  const blockDisplay = useMemo(() => {
    const seat = targetSeatIdx >= 0 ? seatRecs[targetSeatIdx] : null;
    const aud = targetUid ? audienceRecs[targetUid] : undefined;
    return {
      initials: seat?.initials || aud?.initials || initialsFor(targetName),
      color: seat?.color || aud?.color || '#8B5CF6',
    };
  }, [seatRecs, audienceRecs, targetSeatIdx, targetUid, targetName]);

  const toggleCommentBlock = useCallback(async () => {
    if (!roomId || !myUid || !targetUid) return;
    try {
      if (isCommentBlocked) {
        await unblockUserInRoom(roomId, targetUid);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      }
      // SVIP anti-kick (same check as the room screen's blockUser): a
      // higher-tier SVIP cannot be blocked.
      try {
        const { isAntiKickProtected } = await import('@/src/features/svip/svipKickService');
        if (await isAntiKickProtected(myUid, targetUid)) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          Alert.alert(
            t('voiceRoom.screen.error', 'Error'),
            'Cannot block this user due to SVIP anti-kick privilege.',
          );
          return;
        }
      } catch { /* non-critical — proceed with block attempt */ }
      const record: RoomBlockRecord = {
        userId: targetUid,
        userName: targetName,
        initials: blockDisplay.initials,
        color: blockDisplay.color,
        blockedAt: Date.now(),
        blockedBy: myUid,
        byName: myName,
        action: 'comment-block',
      };
      await blockUserInRoom(roomId, record);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        t('voiceRoom.screen.userBlockedDone', 'User Blocked'),
        t('voiceRoom.screen.userCommentBlocked', { name: targetName, defaultValue: `${targetName}'s comments blocked` }),
      );
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t('voiceRoom.screen.error', 'Error'), String(e));
    }
  }, [roomId, myUid, targetUid, targetName, myName, isCommentBlocked, blockDisplay, t]);

  /** Direct seat invite for the first empty unlocked seat (no confirmation
   * Alert — the caller shows the "Success to invite" toast). */
  const inviteDirect = useCallback(async (): Promise<'ok' | 'no-seat' | 'already-seated' | 'error'> => {
    if (!roomId || !myUid || !targetUid) return 'error';
    if (targetIsSeated) return 'already-seated';
    let targetIdx = -1;
    for (let i = 0; i < seatRecs.length; i += 1) {
      const rec = seatRecs[i];
      // Empty (no occupant) AND unlocked — a null record is an empty seat.
      if (!rec?.userId && !rec?.locked) { targetIdx = i; break; }
    }
    if (targetIdx < 0) return 'no-seat';
    try {
      await sendSeatInvite(targetUid, {
        roomId, roomName, seatIdx: targetIdx,
        inviterUid: myUid, inviterName: myName,
        ts: Date.now() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return 'ok';
    } catch {
      return 'error';
    }
  }, [roomId, myUid, targetUid, targetIsSeated, seatRecs, roomName, myName]);

  /** Membership removal (kick out / Remove from Member). The room rules
   * grant room-admins this delete, so it works for Owner AND Admin. */
  const kickOut = useCallback(async () => {
    if (!roomId || !targetUid) return;
    try {
      await removeMemberFromRoom(roomId, targetUid);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t('voiceRoom.info.removeSuccess', { defaultValue: 'Member removed from the room.' }));
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t('voiceRoom.screen.error', 'Error'), String(e));
    }
  }, [roomId, targetUid, t]);

  const setAdmin = useCallback(async () => {
    if (!roomId || !targetUid) return;
    try {
      const writes: Array<Promise<unknown>> = [];
      if (targetSeatIdx >= 0) writes.push(setSeatRole(roomId, targetSeatIdx, 'admin'));
      if (targetIsInAudience) writes.push(setAudienceRole(roomId, targetUid, 'admin'));
      writes.push(grantRoomAdmin(roomId, targetUid));
      writes.push(
        update(ref(database), { [`roomMembers/${roomId}/${targetUid}/role`]: 'admin' }).catch(() => {}),
      );
      await Promise.all(writes);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t('voiceRoom.screen.error', 'Error'), String(e));
    }
  }, [roomId, targetUid, targetSeatIdx, targetIsInAudience, t]);

  const dismissAdmin = useCallback(async () => {
    if (!roomId || !targetUid) return;
    try {
      const writes: Array<Promise<unknown>> = [];
      if (targetSeatIdx >= 0) writes.push(setSeatRole(roomId, targetSeatIdx, 'member'));
      if (targetIsInAudience) writes.push(setAudienceRole(roomId, targetUid, 'member'));
      writes.push(revokeRoomAdmin(roomId, targetUid));
      writes.push(
        update(ref(database), { [`roomMembers/${roomId}/${targetUid}/role`]: 'member' }).catch(() => {}),
      );
      await Promise.all(writes);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t('voiceRoom.screen.error', 'Error'), String(e));
    }
  }, [roomId, targetUid, targetSeatIdx, targetIsInAudience, t]);

  return {
    viewerRole,
    targetRole,
    canShowBar,
    isCommentBlocked,
    targetIsSeated,
    toggleCommentBlock,
    inviteDirect,
    kickOut,
    setAdmin,
    dismissAdmin,
  };
}
