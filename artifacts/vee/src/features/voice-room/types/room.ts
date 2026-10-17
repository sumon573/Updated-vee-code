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
  /** Total live (seated + audience) — for list/trending display */
  liveCount?: number;
  listenerCount?: number;
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
  /** 2026-10-13 (Sumon): active frame id for frame display */
  activeFrame?: string;
  /** 2026-10-15 (Sumon): noble rank index (0-9) — for per-rank speaking ripple */
  nobleRankIndex?: number;
  /* 2026-10-15 (Sumon): equipped collectible IDs — ripple, entry effect, nameplate */
  activeRipple?: string;
  activeEntryEffect?: string;
  activeNameplate?: string;
};

/**
 * Track 3 — payload delivered by GiftsModal.onGiftSent when a gift is sent.
 * (Defined here so the modal, the screen, and the fly-animation all share
 * one structurally-identical shape.)
 */
export type GiftSentInfo = {
  giftId: string;
  emoji: string;
  giftName?: string;
  
  coins: number;
  senderUid: string;
  senderName: string;
  senderAvatar?: string;
  recipients: Array<{ uid: string; name: string; photoURL?: string }>;
  // 2026-10-16 (Sumon): PERMANENT — server-driven gift animations (video/GIF)
  animationUrl?: string;
  animationType?: string;
  // 2026-10-17 (Sumon): Server-driven video size — adjust via Firebase without build.
  videoSize?: number;
  videoFullscreen?: boolean;
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
