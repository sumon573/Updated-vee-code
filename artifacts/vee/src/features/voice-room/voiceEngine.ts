/**
 * VoiceEngine — provider-neutral voice interface.
 *
 * Purpose: abstract the voice transport (WebRTC P2P for 1-to-1 calls and
 * self-hosted LiveKit for group voice rooms) behind one small interface,
 * so screens never import a provider SDK directly.
 *
 * Status: LIVE. `useLivekitVoiceRoom` implements this interface for group
 * voice rooms; `WebRTCCallSession` (webrtcCallService.ts) covers 1-to-1
 * calls with the same join/leave/publish/mute semantics. The former paid
 * provider was fully removed — see migration notes in
 * docs/voice-rooms-scaling-design.md.
 */

/** Connection lifecycle shared by 1-to-1 calls and group rooms. */
export type VoiceConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'ended'
  | 'failed';

/** A remote participant whose audio we may subscribe to. */
export type VoiceParticipant = {
  /** Stable identity (Firebase UID). */
  userId: string;
  /** Display name for UI. */
  userName: string;
  /** True while we are currently subscribed to their audio. */
  subscribed: boolean;
  /** True while their audio level is above the speaking threshold. */
  speaking: boolean;
  /** Provider's mute signal for this participant, if known. */
  muted?: boolean;
};

/** Snapshot of local audio state for UI rendering. */
export type VoiceLocalState = {
  connection: VoiceConnectionState;
  /** Local mic muted (single source of truth — engine + UI agree). */
  muted: boolean;
  /** Audio routed to loudspeaker (vs earpiece). */
  speakerOn: boolean;
  /** True while the local mic track is being published. */
  publishing: boolean;
  /** True while local mic level is above the speaking threshold. */
  localSpeaking: boolean;
  /** Last provider error message, if any. */
  error: string | null;
};

export type VoiceEngineEvents = {
  /** Local state changed (mute, speaker, connection, publishing, error). */
  onLocalStateChange?: (state: VoiceLocalState) => void;
  /** Remote participant list changed (join/leave/subscribe). */
  onParticipantsChange?: (participants: VoiceParticipant[]) => void;
  /** Remote participant started/stopped speaking. */
  onSpeakingChange?: (userId: string, speaking: boolean) => void;
  /**
   * Provider asked us to mute (e.g. host muted this user via signaling).
   * Engine must apply it to the mic AND report it via onLocalStateChange.
   */
  onRemoteMuteRequest?: (muted: boolean) => void;
};

/**
 * Capability surface a VoiceEngine implementation reports for capacity
 * planning. Used by the scaling layer to enforce stage caps and
 * active-speaker-only subscription. All fields optional: engines that do
 * not report capabilities are treated as uncapacitated (legacy behavior).
 */
export type VoiceEngineCapabilities = {
  /** Max simultaneous publishers (stage seats) this engine supports per room. */
  maxStageSpeakers?: number;
  /** Max listeners (subscribers) per room this engine supports. */
  maxListenersPerRoom?: number;
  /** Whether the engine can dynamically subscribe/unsubscribe remote tracks. */
  supportsSelectiveSubscription?: boolean;
  /** Whether Opus DTX is enabled on the local mic publish path. */
  dtxEnabled?: boolean;
};

/** Subscription mode for scaling rooms with many listeners. */
export type VoiceSubscriptionMode =
  | 'all-speakers'
  | 'active-speakers-only';

/**
 * Provider-neutral voice engine.
 *
 * 1-to-1 call mapping: join(roomId) → connect; publish() starts automatically
 * on connect; subscribe(userId) plays the single remote stream.
 *
 * Group room mapping: join(roomId) → connect as audience (no publish);
 * publish() called when the user takes a seat; subscribe(userId) per speaker.
 */
export interface VoiceEngine {
  readonly providerName: 'webrtc-p2p' | 'livekit';

  /** Connect to a room/call and start receiving remote audio. */
  join(roomId: string, identity: { userId: string; userName: string }): Promise<void>;

  /** Leave the room/call; stop publish + subscriptions; release resources. */
  leave(): Promise<void>;

  /** Start publishing the local mic (idempotent). */
  publish(): Promise<void>;

  /** Stop publishing the local mic (idempotent). */
  unpublish(): Promise<void>;

  /** Mute/unmute the local mic. Returns the applied mute state. */
  setMuted(muted: boolean): Promise<boolean>;

  /** Route audio to loudspeaker (true) or earpiece (false). */
  setSpeakerOn(enabled: boolean): Promise<void>;

  /** Subscribe to a remote participant's audio (idempotent). */
  subscribe(userId: string): Promise<void>;

  /** Unsubscribe from a remote participant's audio (idempotent). */
  unsubscribe(userId: string): Promise<void>;

  /**
   * (Scaling extension, optional) Report engine capacity capabilities.
   * Implementations that omit this are treated as uncapacitated.
   */
  getCapabilities?(): VoiceEngineCapabilities;

  /**
   * (Scaling extension, optional) Switch subscription strategy.
   * 'active-speakers-only' keeps only the top-N loudest speaker tracks
   * subscribed and unsubscribes the rest — the client-side lever for
   * thousands of listeners. No-op on engines without selective subscription.
   */
  setSubscriptionMode?(mode: VoiceSubscriptionMode, topN?: number): Promise<void>;

  /** Current local state snapshot (for initial render). */
  getLocalState(): VoiceLocalState;

  /** Current remote participants snapshot (for initial render). */
  getParticipants(): VoiceParticipant[];

  /** Attach event handlers. */
  setEventHandlers(events: VoiceEngineEvents): void;
}
