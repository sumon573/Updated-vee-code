/** A single direct message in an inbox thread */
export type DmReaction = {
  emoji: string;
  userId: string; // 'me' | participantId
};

export type DmReplyPreview = {
  messageId: string;
  senderName: string;
  preview: string; // first 60 chars of the message content
  type: 'text' | 'image' | 'video' | 'voice' | 'call' | 'sticker' | 'story_share' | 'pk_result';
};

/** PK result card payload (message type 'pk_result' only).
 * 2026-11-11 (boss 23:49): a PK result shared to the inbox must render
 * as a professional CARD, never plain text. The payload carries the whole
 * result — battlers (with the photos resolved at send time via
 * usePkBattlerPhotos), scores, winner/draw, margin, top donor, room and
 * battle length — so the card renders from data, never from parsing text.
 * The message `content` still carries the plain-text fallback (old
 * clients render text; chat-list preview + push use it). */
export type PkResultPerson = {
  uid: string;
  name: string;
  photoURL?: string | null;
};

export type PkResultPayload = {
  challenger: PkResultPerson;
  opponent: PkResultPerson;
  challengerScore: number;
  opponentScore: number;
  /** null = draw */
  winnerUid: string | null;
  draw: boolean;
  /** |challenger − opponent| in diamonds (0 on a draw) */
  margin: number;
  /** Top donor across both sides (bot donors map is flat), or null. */
  topDonor?: (PkResultPerson & { total: number }) | null;
  roomName?: string;
  /** e.g. "5 min" */
  durationLabel: string;
  /** send time (ms) */
  endedAt: number;
};

export type DmMessageStatus = 'sending' | 'sent' | 'delivered' | 'seen';

export type DmMessage = {
  id: string;
  chatId: string;
  /** 'me' = current user, anything else = the other participant */
  senderId: string;
  type: 'text' | 'image' | 'video' | 'voice' | 'call' | 'sticker' | 'story_share' | 'pk_result';
  /** text content, or local URI / cloudinary URL for media */
  content: string;
  /** cloudinary public_id — set after upload */
  cloudinaryId?: string;
  /** Caption text for image messages — system notices carry text+image as ONE message (batch57). */
  caption?: string;
  createdAt: number;
  status: DmMessageStatus;
  /** reactions keyed by userId */
  reactions: Record<string, string>;
  replyTo?: DmReplyPreview;
  /** soft-delete flags */
  deletedForMe?: boolean;
  deletedForEveryone?: boolean;
  /** Call log metadata (type='call' only) */
  callInfo?: {
    /** incoming = they called me, outgoing = I called them */
    direction: 'incoming' | 'outgoing';
    /** missed, rejected, completed, cancelled */
    result: 'missed' | 'rejected' | 'completed' | 'cancelled';
    /** call duration in seconds (0 for missed/rejected) */
    durationSec: number;
  };
  /** Voice message duration in seconds (type='voice' only) */
  durationSec?: number;
  /** PK result card payload (type='pk_result' only) — see PkResultPayload. */
  pkResult?: PkResultPayload;
  /** DM text outbox (weak-network Phase 2): own optimistic echoes only.
      'sending' = in flight, 'failed' = send failed, bubble stays with retry. */
  sendState?: 'sending' | 'failed';
};

export type TypingState = {
  isTyping: boolean;
  lastTypedAt: number;
};

/** Realtime-like chat state per conversation */
export type DmChatState = {
  chatId: string;
  participantId: string;
  messages: DmMessage[];
  participantTyping: TypingState;
  participantOnline: boolean;
  participantLastSeen: number | null; // null = online
};
