/**
 * VoiceRoomModals — extracted from VoiceRoomScreen.tsx (IMO port Phase 1c split).
 * All room modals + PIN gate overlay. No logic changes.
 */
import React from 'react';
import { View, Text, Pressable, TextInput, Modal, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RoomInfoModal } from '../components/RoomInfoModal';
import { OperationHistoryModal } from '../components/OperationHistoryModal';
import { SettingsModal } from '../components/SettingsModal';
import { SeatActionSheet } from '../components/SeatActionSheet';
import { InviteToSeatModal } from '../components/InviteToSeatModal';
import { InviteModal } from '../components/InviteModal';
import { LeaderboardModal } from './LeaderboardModal';
import RoomMembersModal from '../components/RoomMembersModal';
import { GiftsModal } from '../components/GiftsModal';
import { MemberManageModal } from '../components/MemberManageModal';
import { ExitModal } from '../components/ExitModal';
import { TaskCenterModal } from '../components/TaskCenterModal';
import EntryBanner from '../components/EntryBanner';
import { GiftFlyAnimation, GiftReceiveBanners, type GiftFlyHandle } from '../components/GiftFlyAnimation';
import { Role, Participant, BlockRecord } from '../types/room';
import { submitReport } from '@/src/services/reportService';
import { updateRoomSettings } from '../services/firebaseRoomService';
import type { RoomAnnouncement } from '../services/roomAnnouncementService';

export interface VoiceRoomModalsProps {
  accentColor: string;
  roomId: string;
  myUid: string;
  myName: string;
  myRole: Role;
  myRoleLevel: number;
  ownerId: string;
  isOwnerOrAdmin: boolean;
  roomName: string;
  setRoomName: (v: string) => void;
  roomTopic: string;
  setRoomTopic: (v: string) => void;
  roomDescription: string;
  setRoomDescription: (v: string) => void;
  roomImageUri: string | null;
  setRoomImageUri: (v: string | null) => void;
  roomIsPublic: boolean;
  setRoomIsPublic: (v: boolean) => void;
  roomIsLocked: boolean;
  setRoomIsLocked: (v: boolean) => void;
  activeThemeId: string;
  setActiveThemeId: (v: string) => void;
  activeThemeIdRef: React.MutableRefObject<string>;
  weeklyEarned: number;
  walletBalance: number;
  /** 2026-10-23 (boss): announcement lives in Settings now. */
  announcement: RoomAnnouncement | null;
  setAnnouncementOpen: (v: boolean) => void;
  seats: Array<Participant | null>;
  audience: Participant[];
  allMembers: Participant[];
  blockedRecs: BlockRecord[];
  lockedSeats: Set<number>;
  roomInfoOpen: boolean;
  setRoomInfoOpen: (v: boolean) => void;
  setSeatQueueOpen: (v: boolean) => void;
  onJoinRoom: () => void;
  onUnjoinRoom: () => void;
  opHistOpen: boolean;
  setOpHistOpen: (v: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  seatActionOpen: boolean;
  setSeatActionOpen: (v: boolean) => void;
  seatActionIdx: number;
  seatActionMember: Participant | null;
  seatActionAnchor: { x: number; y: number; width: number; height: number } | null;
  mySeatIdx: number;
  invToSeatOpen: boolean;
  setInvToSeatOpen: (v: boolean) => void;
  invToSeatIdx: number;
  setInvToSeatIdx: (v: number) => void;
  inviteOpen: boolean;
  setInviteOpen: (v: boolean) => void;
  giftsOpen: boolean;
  setGiftsOpen: (v: boolean) => void;
  giftsRecipient: Participant | null;
  setGiftsRecipient: (m: Participant | null) => void;
  leaderboardOpen: boolean;
  setLeaderboardOpen: (v: boolean) => void;
  membersOpen: boolean;
  setMembersOpen: (v: boolean) => void;
  activeMember: Participant | null;
  setActiveMember: (m: Participant | null) => void;
  exitModalOpen: boolean;
  setExitModalOpen: (v: boolean) => void;
  /** 2026-10-24 (Sumon): Task Center (server-driven `task_events`). */
  taskCenterOpen: boolean;
  setTaskCenterOpen: (v: boolean) => void;
  pinGate: 'checking' | 'open' | 'passed';
  pinInput: string;
  setPinInput: (v: string) => void;
  pinError: string;
  setPinError: (v: string) => void;
  pinVerifying: boolean;
  submitPinGate: () => void;
  cancelPinGate: () => void;
  giftFlyRef: React.RefObject<GiftFlyHandle | null>;
  entryBanner: { name: string; photoURL?: string | null; nobleRankIndex?: number } | null;
  setEntryBanner: (b: { name: string; photoURL?: string | null; nobleRankIndex?: number } | null) => void;
  handleDisband: () => void;
  handleViewOtherProfile: (uid: string, name: string) => void;
  handleViewOwnProfile: () => void;
  handleEditOwnProfile: () => void;
  handleMention: (name: string) => void;
  handleGiftSent: (info: any) => void;
  /** 2026-10-21: instant local gift show, fired at Send-tap (pre-wallet). */
  handleGiftPlay: (info: any) => void;
  handleLeave: () => void;
  handleMinimize: () => void;
  downFromSeat: (idx: number) => void;
  joinSeat: (idx: number) => void;
  muteToggleMember: (uid: string) => void;
  setAdminRole: (uid: string) => void;
  dismissAdmin: (uid: string) => void;
  removeMember: (uid: string) => void;
  blockUser: (uid: string, action: "room-block" | "comment-block") => void;
  unblockUser: (uid: string) => void;
  /** SVIP kick-out (spends points). */
  svipKickOut: (uid: string) => void;
  /** True when the viewer holds the SVIP kick-out privilege. */
  canSvipKickOut: boolean;
  lockSeat: (idx: number) => void;
  unlockSeat: (idx: number) => void;
  inviteToSeat: (memberId: string, seatIdx: number) => void;
}

export function VoiceRoomModals(props: VoiceRoomModalsProps) {
  const { t } = useTranslation();
  const p = props;
  return (
    <>
      <RoomInfoModal
        visible={p.roomInfoOpen}
        onClose={() => p.setRoomInfoOpen(false)}
        allMembers={p.allMembers}
        description={p.roomDescription}
        roomTopic={p.roomTopic}
        roomName={p.roomName}
        onChangeRoomName={(newName) => {
          p.setRoomName(newName);
          updateRoomSettings(p.roomId, { name: newName }).catch(() => {
            Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.screen.settingsSaveError'));
          });
        }}
        roomImageUri={p.roomImageUri}
        onChangeRoomImage={(cloudUrl) => {
          p.setRoomImageUri(cloudUrl);
          updateRoomSettings(p.roomId, { coverImageUrl: cloudUrl }).catch(() => {
            Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.screen.settingsSaveError'));
          });
        }}
        roomId={p.roomId}
        isOwner={p.myRole === 'host'}
        isAdmin={p.myRole === 'admin'}
        ownerId={p.ownerId}
        onDisband={p.handleDisband}
        onVisitProfile={p.handleViewOtherProfile}
        myUid={p.myUid}
        myName={p.myName}
        onOpenSettings={() => p.setSettingsOpen(true)}
        onOpenStore={() => router.push('/store')}
        onOpenInvite={() => p.setInviteOpen(true)}
        onOpenRequests={() => p.setSeatQueueOpen(true)}
        onJoinRoom={p.onJoinRoom}
        onUnjoinRoom={p.onUnjoinRoom}
        onSetAdmin={(uid) => p.setAdminRole(uid)}
        onDismissAdmin={(uid) => p.dismissAdmin(uid)}
        onRemoveMember={(uid) => p.removeMember(uid)}
      />
      <OperationHistoryModal
        visible={p.opHistOpen}
        onClose={() => p.setOpHistOpen(false)}
        records={p.blockedRecs}
        onUnblock={p.unblockUser}
        accent={p.accentColor}
      />
      <SettingsModal
        visible={p.settingsOpen}
        onClose={() => p.setSettingsOpen(false)}
        isOwnerOrAdmin={p.isOwnerOrAdmin}
        canEdit={p.myRole === 'host'}
        topic={p.roomTopic}
        setTopic={(newTopic) => {
          p.setRoomTopic(newTopic);
          updateRoomSettings(p.roomId, { topic: newTopic }).catch(() => {
            Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.screen.settingsSaveError'));
          });
        }}
        description={p.roomDescription}
        setDescription={(newDesc) => {
          p.setRoomDescription(newDesc);
          updateRoomSettings(p.roomId, { description: newDesc }).catch(() => {
            Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.screen.settingsSaveError'));
          });
        }}
        onOpenHistory={() => { p.setSettingsOpen(false); p.setOpHistOpen(true); }}
        accent={p.accentColor}
        roomIsPublic={p.roomIsPublic}
        roomIsLocked={p.roomIsLocked}
        onSaveSettings={(newIsPublic, newIsLocked) => {
          p.setRoomIsPublic(newIsPublic);
          p.setRoomIsLocked(newIsLocked);
          updateRoomSettings(p.roomId, { isPublic: newIsPublic, isLocked: newIsLocked }).catch(() => {
            Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.screen.settingsSaveError'));
          });
        }}
        roomId={p.roomId}
      />
      <SeatActionSheet
        visible={p.seatActionOpen}
        seatIdx={p.seatActionIdx}
        member={p.seatActionMember ?? undefined}
        myRole={p.myRole}
        myRoleLevel={p.myRoleLevel}
        myId={p.myUid}
        locked={p.seatActionIdx >= 0 && p.lockedSeats.has(p.seatActionIdx)}
        audience={p.audience}
        anchor={p.seatActionAnchor}
        onClose={() => p.setSeatActionOpen(false)}
        onDown={() => { p.downFromSeat(p.seatActionIdx); p.setSeatActionOpen(false); }}
        onJoin={() => { p.joinSeat(p.seatActionIdx); p.setSeatActionOpen(false); }}
        onMute={() => { if (p.seatActionMember) p.muteToggleMember(p.seatActionMember!.id); p.setSeatActionOpen(false); }}
        onSetAdmin={() => { if (p.seatActionMember) p.setAdminRole(p.seatActionMember!.id); p.setSeatActionOpen(false); }}
        onDismissAdmin={() => { if (p.seatActionMember) p.dismissAdmin(p.seatActionMember!.id); p.setSeatActionOpen(false); }}
        onMention={() => { if (p.seatActionMember) { p.handleMention(p.seatActionMember.name); p.setSeatActionOpen(false); } }}
        onBlock={() => { if (p.seatActionMember) { p.blockUser(p.seatActionMember!.id, 'room-block'); p.setSeatActionOpen(false); } }}
        onUnblock={() => { if (p.seatActionMember) { p.unblockUser(p.seatActionMember!.id); p.setSeatActionOpen(false); } }}
        onKickOut={() => { if (p.seatActionMember) { p.svipKickOut(p.seatActionMember!.id); p.setSeatActionOpen(false); } }}
        canKickOut={p.canSvipKickOut}
        isRoomBlocked={!!p.seatActionMember && p.blockedRecs.some((r: BlockRecord) => r.id === p.seatActionMember!.id && r.isActive && r.action === 'room-block')}
        onLock={() => { p.lockSeat(p.seatActionIdx); p.setSeatActionOpen(false); }}
        onUnlock={() => { p.unlockSeat(p.seatActionIdx); p.setSeatActionOpen(false); }}
        onInvite={() => { p.setInvToSeatIdx(p.seatActionIdx); p.setSeatActionOpen(false); p.setInvToSeatOpen(true); }}
        accent={p.accentColor}
      />
      <InviteToSeatModal
        visible={p.invToSeatOpen}
        audience={p.audience}
        seatIdx={p.invToSeatIdx}
        onClose={() => p.setInvToSeatOpen(false)}
        onInvite={(memberId) => { p.inviteToSeat(memberId, p.invToSeatIdx); p.setInvToSeatOpen(false); }}
        accent={p.accentColor}
      />
      <InviteModal
        visible={p.inviteOpen}
        onClose={() => p.setInviteOpen(false)}
        roomId={p.roomId}
        roomName={p.roomName}
      />
      {/* ── Track 3: gift showpiece overlays (absolute, pointerEvents=none) ──
          Above the seat grid/chat, below the modals. */}
      <GiftFlyAnimation ref={p.giftFlyRef} />
      {p.roomId ? <GiftReceiveBanners roomId={p.roomId} /> : null}
      {/* ── Entry effect: "X is Coming" banner (2026-10-10) ── */}
      {p.entryBanner ? (
        <EntryBanner
          name={p.entryBanner.name}
          photoURL={p.entryBanner.photoURL}
          nobleRankIndex={p.entryBanner.nobleRankIndex}
          onDismiss={() => p.setEntryBanner(null)}
        />
      ) : null}
      <GiftsModal
        visible={p.giftsOpen}
        onClose={() => { p.setGiftsOpen(false); p.setGiftsRecipient(null); }}
        onGiftSent={p.handleGiftSent}
        onGiftPlay={p.handleGiftPlay}
        // 2026-10-13 (Sumon-এর নিয়ম): gift সবাইকে পাঠানো যাবে — seated +
        // p.audience সবাই (self সহ)। আগে শুধু seated members ছিল।
        members={p.allMembers}
        initialRecipient={p.giftsRecipient}
        walletBalance={p.walletBalance}
        myUid={p.myUid}
        myName={p.myName}
        roomId={p.roomId}
        senderSeated={p.mySeatIdx >= 0}
        seats={p.seats}
        mySeatIdx={p.mySeatIdx}
      />
      <LeaderboardModal
        visible={p.leaderboardOpen}
        onClose={() => p.setLeaderboardOpen(false)}
      />
      <RoomMembersModal
        visible={p.membersOpen}
        onClose={() => p.setMembersOpen(false)}
        ownerId={p.ownerId}
        seats={p.seats}
        audience={p.audience}
        onManageMember={(m) => { p.setMembersOpen(false); p.setActiveMember(m); }}
      />
      <MemberManageModal
        member={p.activeMember}
        myRole={p.myRole}
        myRoleLevel={p.myRoleLevel}
        myId={p.myUid}
        onClose={() => p.setActiveMember(null)}
        onGift={() => { p.setGiftsRecipient(p.activeMember); p.setActiveMember(null); p.setGiftsOpen(true); }}
        onMention={p.handleMention}
        onBlock={(action) => { if (p.activeMember) p.blockUser(p.activeMember!.id, action); p.setActiveMember(null); }}
        onUnblock={() => { if (p.activeMember) p.unblockUser(p.activeMember!.id); p.setActiveMember(null); }}
        isCommentBlocked={!!p.activeMember && p.blockedRecs.some((r: BlockRecord) => r.id === p.activeMember!.id && r.isActive && r.action === 'comment-block')}
        isRoomBlocked={!!p.activeMember && p.blockedRecs.some((r: BlockRecord) => r.id === p.activeMember!.id && r.isActive && r.action === 'room-block')}
        onReport={(memberId, memberName) => {
          submitReport({
            reporterUid: p.myUid,
            reporterName: p.myName,
            reportedUid: memberId,
            reportedName: memberName,
            reason: 'inappropriate',
            roomId: p.roomId }).catch(() => {
            Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.memberManage.reportError'));
          });
          p.setActiveMember(null);
        }}
        onSetAdmin={() => { if (p.activeMember) p.setAdminRole(p.activeMember!.id); p.setActiveMember(null); }}
        onDismissAdmin={() => { if (p.activeMember) p.dismissAdmin(p.activeMember!.id); p.setActiveMember(null); }}
        onViewProfile={p.handleViewOwnProfile}
        onViewOtherProfile={p.handleViewOtherProfile}
        onEditProfile={p.handleEditOwnProfile}
        // Issue 2: Down Mic / Leave Seat (self view — replaces Copy V ID)
        isSeated={p.activeMember ? p.seats.some((s) => s?.id === p.activeMember!.id) : false}
        onDown={() => { if (p.mySeatIdx >= 0) p.downFromSeat(p.mySeatIdx); p.setActiveMember(null); }}
        // Issue 4: Owner/Admin — move another member down from their seat
        onDownFromSeat={() => {
          if (p.activeMember) {
            const targetIdx = p.seats.findIndex((s) => s?.id === p.activeMember!.id);
            if (targetIdx >= 0) p.downFromSeat(targetIdx);
          }
          p.setActiveMember(null);
        }}
      />
      <ExitModal
        visible={p.exitModalOpen}
        onClose={() => p.setExitModalOpen(false)}
        onLeave={p.handleLeave}
        onMinimize={p.handleMinimize}
        roomName={p.roomName}
      />
      <TaskCenterModal
        visible={p.taskCenterOpen}
        onClose={() => p.setTaskCenterOpen(false)}
      />
      {/* P0 security (2026-10-12): in-screen PIN gate overlay. Blocks the
          entire room UI until the correct 4-digit PIN is entered — closes
          the deep-link bypass (invite/notification/profile taps). */}
      <Modal
        visible={p.pinGate === 'open'}
        animationType="fade"
        transparent={false}
        onRequestClose={p.cancelPinGate}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }} edges={['top', 'bottom']}>
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
            <View style={{
              width: 72, height: 72, borderRadius: 36,
              backgroundColor: '#E3F2FD', alignItems: 'center', justifyContent: 'center',
              marginBottom: 20 }}>
              <Feather name="lock" size={30} color="#007AFF" />
            </View>
            <Text style={{ color: '#000000', fontSize: 20, fontWeight: '900', marginBottom: 6, textAlign: 'center' }} numberOfLines={1}>
              {p.roomName || t('voiceRoom.screen.pinGateTitle')}
            </Text>
            <Text style={{ color: '#8E8E93', fontSize: 14, marginBottom: 24, textAlign: 'center' }}>
              {t('voiceRoom.screen.pinGateMsg')}
            </Text>
            <TextInput
              style={{
                backgroundColor: '#F2F2F7', borderRadius: 14, borderWidth: 1.5,
                borderColor: p.pinError ? '#FF4B4B' : '#E3F2FD',
                color: '#000000', fontSize: 28, fontWeight: '800',
                textAlign: 'center', letterSpacing: 16,
                paddingVertical: 14, marginBottom: 8, width: 220 }}
              placeholder="••••"
              placeholderTextColor="#C7C7CC"
              value={p.pinInput}
              onChangeText={(txt) => {
                const digits = txt.replace(/[^0-9]/g, '').slice(0, 4);
                p.setPinInput(digits);
                if (p.pinError) p.setPinError('');
              }}
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              autoFocus
              editable={!p.pinVerifying}
              onSubmitEditing={p.submitPinGate}
            />
            {p.pinError ? (
              <Text style={{ color: '#FF4B4B', fontSize: 13, textAlign: 'center', marginBottom: 16 }}>{p.pinError}</Text>
            ) : (
              <Text style={{ color: '#C7C7CC', fontSize: 12, textAlign: 'center', marginBottom: 16 }}>
                {t('voiceRoom.screen.pinNumbersOnly')}
              </Text>
            )}
            <Pressable
              onPress={p.submitPinGate}
              disabled={p.pinVerifying || p.pinInput.length !== 4}
              style={{
                backgroundColor: '#E3F2FD', borderRadius: 14,
                paddingVertical: 14, paddingHorizontal: 48, marginBottom: 12,
                opacity: (p.pinVerifying || p.pinInput.length !== 4) ? 0.5 : 1 }}
            >
              <Text style={{ color: '#007AFF', fontSize: 16, fontWeight: '800' }}>
                {p.pinVerifying ? t('voiceRoom.screen.pinVerifying') : t('voiceRoom.screen.pinJoin')}
              </Text>
            </Pressable>
            <Pressable onPress={p.cancelPinGate} style={{ paddingVertical: 10 }}>
              <Text style={{ color: '#8E8E93', fontSize: 15, fontWeight: '600' }}>
                {t('voiceRoom.screen.pinCancel')}
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}
