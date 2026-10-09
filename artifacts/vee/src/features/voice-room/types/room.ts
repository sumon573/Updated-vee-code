export type RoomCategory = 'trending' | 'nearby' | 'ludo' | 'game' | 'music' | 'adda' | 'discussion' | 'talk' | 'study' | 'new';

export type MemberPreview = {
  initials: string;
  color: string;
  /** Real profile photo URL — shown as the DP; falls back to initials. */
  photoURL?: string;
};

export type VoiceRoom = {
  id: string;
  name: string;
  topic: string;
  themeColor: string;
  memberCount: number;
  maxMembers: number;
  isLive: boolean;
  isTrending?: boolean;
  category: RoomCategory;
  tags: string[];
  ownerId: string;
  ownerName: string;
  allowGifts: boolean;
  createdAt: number;
  memberPreviews?: MemberPreview[];
  coverImageUrl?: string;
  isPublic?: boolean;
};

/* ─── Types added from VoiceRoomScreen ─── */

export type Role = 'host' | 'admin' | 'member';

export type Participant = {
  id: string;
  name: string;
  initials: string;
  color: string;
  photoURL?: string;   // profile picture URL (optional, falls back to initials)
  speaking: boolean; // true ONLY when the voice engine signals real audio — no fake pulse
  muted: boolean;
  role: Role;
};

/**
 * Track 3 — payload delivered by GiftsModal.onGiftSent when a gift is sent.
 * (Defined here so the modal, the screen, and the fly-animation all share
 * one structurally-identical shape.)
 */
export type GiftSentInfo = {
  giftId: string;
  emoji: string;
  coins: number;
  senderUid: string;
  senderName: string;
  senderAvatar?: string;
  recipients: Array<{ uid: string; name: string; photoURL?: string }>;
};

export type BlockRecord = {
  id: string;
  name: string;
  initials: string;
  color: string;
  action: 'room-block' | 'comment-block';
  actionBy: string;
  timestamp: number;
  isActive: boolean;
};

export type ChatMsg = {
  id: string;
  sender: string;
  color: string;
  text: string;
  isMe: boolean;
  ts: number;
  replyTo?: { sender: string; text: string; color: string };
};

import { Animated } from 'react-native';

export type SeatReaction = {
  emoji: string;
  translateY: Animated.Value;
  opacity: Animated.Value;
};
