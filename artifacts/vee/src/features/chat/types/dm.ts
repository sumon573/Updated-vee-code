/** A single direct message in an inbox thread */
export type DmReaction = {
  emoji: string;
  userId: string; // 'me' | participantId
};

export type DmReplyPreview = {
  messageId: string;
  senderName: string;
  preview: string; // first 60 chars of the message content
  type: 'text' | 'image' | 'video' | 'voice' | 'call' | 'sticker' | 'story_share';
};

export type DmMessageStatus = 'sending' | 'sent' | 'delivered' | 'seen';

export type DmMessage = {
  id: string;
  chatId: string;
  /** 'me' = current user, anything else = the other participant */
  senderId: string;
  type: 'text' | 'image' | 'video' | 'voice' | 'call' | 'sticker' | 'story_share';
  /** text content, or local URI / cloudinary URL for media */
  content: string;
  /** cloudinary public_id — set after upload */
  cloudinaryId?: string;
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
