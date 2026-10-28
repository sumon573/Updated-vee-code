/**
 * Edge voice-room chat receiver (cutover v1).
 *
 * When the server flag is on for a room, the app ALSO opens a WebSocket to
 * the production edge Worker and merges edge-delivered messages into the
 * same byId map the Firebase subscription maintains. Same message ids dedup
 * (the bot publishes Firebase snapshots verbatim, so the shape matches
 * RoomChatMsg). Firebase listeners stay on as fallback: if the edge socket
 * drops, if the bot misses a message, or if a payload is junk, Firebase
 * still delivers everything. The edge path can therefore never lose a
 * message the app would otherwise show.
 *
 * Silent by design: no UI, no toasts, no errors surfaced. Reconnects with
 * backoff (1s doubling to 30s) while subscribed.
 */

const EDGE_WS_BASE = 'wss://vee-edge.sumon118858.workers.dev';

export type EdgeChatMsg = {
  id: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  text: string;
  ts: number;
  replyTo?: {
    sender: string;
    text: string;
    color: string;
  };
  kind?: string;
  gift?: unknown;
};

function isEdgeChatMsg(v: unknown): v is EdgeChatMsg {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    typeof m.senderId === 'string' &&
    typeof m.text === 'string' &&
    typeof m.ts === 'number'
  );
}

// React Native provides a global WebSocket, but the app's TS config does
// not carry DOM lib types for it — resolve it dynamically and treat the
// socket as untyped rather than fighting the type system.
const WS_CTOR = (globalThis as unknown as { WebSocket?: any }).WebSocket;

/** Subscribe to edge-delivered chat for one room. Returns unsubscribe. */
export function subscribeEdgeRoomChat(
  roomId: string,
  onMsg: (msg: EdgeChatMsg) => void,
): () => void {
  let closed = false;
  let socket: any = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let delay = 1000;

  const schedule = () => {
    if (closed || retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
    delay = Math.min(delay * 2, 30000);
  };

  const connect = () => {
    if (closed || !WS_CTOR) return;
    try {
      socket = new WS_CTOR(`${EDGE_WS_BASE}/room/${encodeURIComponent(roomId)}/ws`);
    } catch (e) {
      schedule();
      return;
    }
    socket.onopen = () => {
      delay = 1000;
    };
    socket.onmessage = (ev: any) => {
      try {
        const raw = typeof ev.data === 'string' ? ev.data : '';
        const parsed: unknown = JSON.parse(raw);
        if (isEdgeChatMsg(parsed)) onMsg(parsed);
      } catch (e) {
        // Junk ignored; Firebase covers.
      }
    };
    const onDead = () => {
      socket = null;
      schedule();
    };
    socket.onclose = onDead;
    socket.onerror = onDead;
  };

  connect();

  return () => {
    closed = true;
    if (retryTimer !== null) clearTimeout(retryTimer);
    try {
      if (socket) socket.close();
    } catch (e) {}
    socket = null;
  };
}
