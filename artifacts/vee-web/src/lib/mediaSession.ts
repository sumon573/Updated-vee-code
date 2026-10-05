/**
 * Media Session API wiring for background voice audio.
 *
 * The voice feature (voice rooms / 1-to-1 calls) should call
 * `setMediaSessionHandlers()` when a session starts and
 * `clearMediaSession()` when it ends. Until then this is a no-op stub so the
 * skeleton compiles and PWA audio controls have a home.
 */

export interface MediaSessionHandlers {
  /** Called when the OS/system UI asks to pause the voice session. */
  onPause?: () => void;
  /** Called when the OS/system UI asks to resume the voice session. */
  onResume?: () => void;
  /** Called when the OS/system UI asks to leave/hang up the session. */
  onHangUp?: () => void;
  /** Called when the OS/system UI toggles the mic mute. */
  onToggleMute?: () => void;
}

export interface MediaSessionMetadata {
  title: string;
  artist?: string;
  album?: string;
}

/**
 * Register Media Session metadata + action handlers for the active voice
 * session. Safe to call in browsers without Media Session support.
 */
export function setMediaSessionHandlers(
  metadata: MediaSessionMetadata,
  handlers: MediaSessionHandlers,
): void {
  if (!('mediaSession' in navigator)) {
    return;
  }

  navigator.mediaSession.metadata = new MediaMetadata({
    title: metadata.title,
    artist: metadata.artist ?? '',
    album: metadata.album ?? 'Vee',
  });

  const actionHandlers: Array<[string, MediaSessionActionHandler | null]> = [
    ['play', handlers.onResume ?? null],
    ['pause', handlers.onPause ?? null],
    ['stop', handlers.onHangUp ?? null],
    ['hangup', handlers.onHangUp ?? null],
    ['togglemicrophone', handlers.onToggleMute ?? null],
  ];

  for (const [action, handler] of actionHandlers) {
    try {
      navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler);
    } catch {
      // Unsupported action on this platform — ignore.
    }
  }
}

/** Clear Media Session metadata and handlers when the voice session ends. */
export function clearMediaSession(): void {
  if (!('mediaSession' in navigator)) {
    return;
  }
  navigator.mediaSession.metadata = null;
  for (const action of ['play', 'pause', 'stop', 'hangup', 'togglemicrophone'] as Array<string>) {
    try {
      navigator.mediaSession.setActionHandler(action as MediaSessionAction, null);
    } catch {
      // Unsupported action on this platform — ignore.
    }
  }
}
