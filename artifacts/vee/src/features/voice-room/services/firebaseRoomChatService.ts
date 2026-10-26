/**
 * Firebase Voice Room Chat Service
 * Real-time room chat messages stored in Firebase Realtime DB.
 *
 * Fix: Comment-block enforcement — sendRoomChatMsg now checks Firebase
 * roomBlocks before writing. If the sender is comment-blocked or room-blocked,
 * the write is rejected with a thrown Error so the caller can show feedback.
 * System messages (senderId === 'system') bypass this check.
 *
 * DB Structure:
 *   rooms/{roomId}/chat/{msgId} → RoomChatMsg
 *   roomBlocks/{roomId}/{userId} → RoomBlockRecord
 */

import { ref, push, set, get, query, limitToLast, onChildAdded, onChildChanged, onChildRemoved } from 'firebase/database';
import { database } from '@/src/config/firebase';

export type RoomChatGift = {
  giftId: string;
  giftName: string;
  thumbnailUrl?: string | null;
  coins: number;
  quantity: number;
  totalCoins: number;
  senderAvatar?: string | null;
  recipients: Array<{ uid: string; name: string; photoURL?: string | null }>;
};

export type RoomChatMsg = {
  id: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  text: string;
  isMe?: boolean; // resolved client-side
  ts: number;
  replyTo?: {
    sender: string;
    text: string;
    color: string;
  };
  /** 2026-10-23 gift card (Option A): kind === 'gift' + structured payload.
   *  The plain `text` fallback is always written too (rules require it and
   *  older clients render it). */
  kind?: string;
  gift?: RoomChatGift;
};

/** Subscribe to room chat (last 30 messages).
 *  2026-10-26 (boss: room chat = session + last 30): the window is 30 —
 *  the screen filters it further to this stay only (joinTs) and there is
 *  no Load earlier anymore, so the service no longer paginates. The old
 *  loadOlderMessages() is deleted with it: pre-join history must never
 *  be reachable again.
 *  2026-10-23 (Sumon: "সব কিছু সুপার ফাস্ট send হবে"): INCREMENTAL child
 *  listeners instead of onValue. The old onValue re-downloaded and
 *  re-parsed the ENTIRE window on every single new message —
 *  the main receiver-side lag. Now each event transfers only the one
 *  changed message; the array is maintained locally and the callback
 *  still receives the full sorted window (same contract as before).
 *  Events are coalesced per tick so the initial child burst produces
 *  one callback, not thirty. */
export function subscribeRoomChat(
  roomId: string,
  myUid: string,
  callback: (msgs: RoomChatMsg[]) => void,
): () => void {
  const chatRef = query(
    ref(database, `rooms/${roomId}/chat`),
    limitToLast(30),
  );
  const byId = new Map<string, RoomChatMsg>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let delivered = false;
  const flush = () => {
    flushTimer = null;
    const msgs = Array.from(byId.values());
    msgs.sort((a, b) => (a.ts - b.ts) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    delivered = true;
    callback(msgs);
  };
  const schedule = () => {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(flush, 0);
  };
  const upsert = (key: string | null, val: unknown) => {
    if (!key || !val || typeof val !== 'object') return;
    const v = val as Omit<RoomChatMsg, 'id' | 'isMe'>;
    byId.set(key, { ...v, id: key, isMe: v.senderId === myUid });
    schedule();
  };
  const unsubAdd = onChildAdded(chatRef, (snap) => upsert(snap.key, snap.val()));
  const unsubChange = onChildChanged(chatRef, (snap) => upsert(snap.key, snap.val()));
  const unsubRemove = onChildRemoved(chatRef, (snap) => {
    if (snap.key) byId.delete(snap.key);
    schedule();
  });
  // Empty room: no child events ever fire — deliver [] once so the UI
  // doesn't sit in its initial state forever (onValue did this too).
  const emptyTimer = setTimeout(() => { if (!delivered) callback([]); }, 1200);
  return () => {
    if (flushTimer !== null) clearTimeout(flushTimer);
    clearTimeout(emptyTimer);
    unsubAdd();
    unsubChange();
    unsubRemove();
  };
}

/**
 * Send a chat message to the room.
 *
 * Comment-block enforcement: non-system senders are checked against
 * roomBlocks/{roomId}/{senderId} before the write. A 'comment-block' or
 * 'room-block' record causes this function to throw so the UI can notify
 * the user. System messages (join/leave/gift) always go through.
 *
 * @throws {Error} if the sender is blocked from sending messages.
 */
/** 2026-10-23 (Sumon: super-fast sends): the block check used to cost a
 *  full extra RTDB round trip BEFORE every write. The room screen already
 *  holds a LIVE block listener (amChatBlocked) that gates the UI instantly;
 *  this service-level check is the second line of defence, so its result
 *  is cached per (room, sender) for 20 s — a fresh block still bites
 *  within 20 s here and instantly in the UI. */
const blockCheckCache = new Map<string, { blocked: boolean; at: number }>();
const BLOCK_CHECK_TTL_MS = 20_000;

async function isChatBlocked(roomId: string, senderId: string): Promise<boolean> {
  const cacheKey = `${roomId}/${senderId}`;
  const hit = blockCheckCache.get(cacheKey);
  if (hit && Date.now() - hit.at < BLOCK_CHECK_TTL_MS) return hit.blocked;
  let blocked = false;
  const blockSnap = await get(ref(database, `roomBlocks/${roomId}/${senderId}`));
  if (blockSnap.exists()) {
    const block = blockSnap.val() as { action: string };
    blocked = block.action === 'comment-block' || block.action === 'room-block';
  }
  blockCheckCache.set(cacheKey, { blocked, at: Date.now() });
  return blocked;
}

/** Pre-generate a chat message key so the UI can render an optimistic
 *  echo under the SAME id the subscription will later deliver — the
 *  snapshot then replaces the echo in place instead of duplicating it. */
export function createRoomChatKey(roomId: string): string {
  return push(ref(database, `rooms/${roomId}/chat`)).key!;
}

export async function sendRoomChatMsg(
  roomId: string,
  msg: Omit<RoomChatMsg, 'id' | 'isMe'>,
  msgId?: string,
): Promise<void> {
  // System messages (join/leave/gift notifications) always go through
  if (msg.senderId !== 'system') {
    if (await isChatBlocked(roomId, msg.senderId)) {
      throw new Error('blocked');
    }
  }
  const msgRef = msgId
    ? ref(database, `rooms/${roomId}/chat/${msgId}`)
    : push(ref(database, `rooms/${roomId}/chat`));
  await set(msgRef, msg);
}
