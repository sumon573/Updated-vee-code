export type StoryComment = {
  id: string;
  userId: string;
  userName: string;
  /** RC8-B2: added for comment avatar display in UI */
  userAvatar?: string;
  text: string;
  /** RC8-B2: renamed from createdAt to ts to match Firebase push-key storage format */
  ts: number;
  /** 2026-10-11: reply support — ID of the parent comment being replied to */
  replyTo?: string;
  /** 2026-10-11: display name of the parent comment's author */
  replyToName?: string;
};

export type StoryPrivacy = 'public' | 'contacts';

export type StoryMediaType = 'text' | 'image' | 'video' | 'audio';

/** A freehand drawing stroke on a story (normalized 0..1 coordinates). */
export type DrawingStroke = {
  color: string;
  width: number;
  points: { x: number; y: number }[];
};

export type Story = {
  id: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  type: StoryMediaType;
  /** For text stories: the display text. For image/video/audio stories: Cloudinary URL. */
  content: string;
  bgGradient?: [string, string]; // for text stories
  textColor?: string;
  /** Display name of the attached audio file (audio stories only). */
  audioName?: string;
  /** 2026-10-11: Background music URL for photo/text stories (plays with the story). */
  musicUrl?: string;
  /** 2026-10-11: Display name of the background music. */
  musicName?: string;
  /** 2026-10-11: Text overlay for photo stories (draggable/zoomable in editor). */
  overlayText?: string;
  /** Number of times this story was shared (persisted, incremented via transaction). */
  shareCount?: number;
  /** Freehand drawing strokes saved with the story. */
  drawing?: DrawingStroke[];
  /** Real place name attached via the location toolbar button. */
  locationName?: string;
  /** Camera-effect filter index (0 = none). See EFFECTS in StoryShareScreen. */
  effect?: number;
  mentions?: string[];            // userIds mentioned
  createdAt: number;
  expiresAt: number;
  viewCount: number;
  reactions: Record<string, string>; // userId → emoji
  comments: StoryComment[];
  cloudinaryId?: string;
  /** 'public' → visible to everyone; 'contacts' → visible only to friends */
  privacy?: StoryPrivacy;
};

export type UserStories = {
  userId: string;
  userName: string;
  userAvatar?: string;
  stories: Story[];
  allSeen: boolean;
};

export type ChatMessageType = 'text' | 'image' | 'video' | 'voice' | 'story_share' | 'sticker' | 'call';

export type Chat = {
  id: string;
  participantId: string;
  participantName: string;
  participantAvatar?: string;
  lastMessage: string;
  lastMessageType: ChatMessageType;
  lastMessageTime: number;
  unreadCount: number;
  isOnline: boolean;
  hasStory: boolean;
  storySeen: boolean;
  isPinned?: boolean;
  isHidden?: boolean;
  isTyping?: boolean;
};
