/**
 * Firebase DM service (web port of the native `firebaseDmService`).
 *
 * RTDB structure (exactly as the contract documents):
 *   chats/{chatId}/messages/{msgId}  → DmMessage
 *   chats/{chatId}/typing/{uid}      → { isTyping, lastTypedAt }
 *   userChats/{uid}/{chatId}         → chat-list metadata
 *
 * Conventions reproduced exactly:
 * - chatId = [uidA, uidB].sort().join('_') (canonical)
 * - message pages of 50 via limitToLast(50)
 * - typing auto-clears after ~4s + onDisconnect reset
 * - push notification via POST /api/notifications/send (category "messages"),
 *   fire-and-forget
 */

import {
  ref,
  push,
  set,
  update,
  get,
  onValue,
  increment,
  serverTimestamp,
  onDisconnect as fbOnDisconnect,
  query,
  orderByKey,
  limitToLast,
} from 'firebase/database';
import { rtdb } from '../../lib/firebase';
import { apiFetch } from '../../lib/api';

/** Number of messages loaded per page. */
export const DM_PAGE_SIZE = 50;

export type DmMessage = {
  id: string;
  chatId: string;
  senderId: string;
  type: 'text' | 'image' | 'video';
  content: string;
  createdAt: number;
  status: 'sending' | 'sent' | 'delivered' | 'seen';
  reactions: Record<string, string>;
  replyTo?: { messageId: string; senderName: string; preview: string; type: string };
};

export type ChatListEntry = {
  id: string;
  participantId: string;
  participantName: string;
  lastMessage: string;
  lastMessageType: string;
  lastMessageTime: number;
  unreadCount: number;
  isOnline: boolean;
  isPinned: boolean;
};

/** Deterministic chatId: sorted UIDs joined with '_' — matches native. */
export function buildChatId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join('_');
}

/** The other participant's uid, derived from the canonical chatId. */
export function peerUidFromChatId(chatId: string, myUid: string): string | null {
  const parts = chatId.split('_');
  if (parts.length !== 2) return null;
  const [a, b] = parts as [string, string];
  if (a === myUid) return b;
  if (b === myUid) return a;
  return null;
}

function snapToMessage(
  key: string,
  v: Record<string, unknown>,
  myUid: string,
): DmMessage | null {
  const deletedForUids = (v.deletedForUids as Record<string, boolean> | undefined) ?? {};
  if (deletedForUids[myUid] === true) return null;
  if (v.deletedForEveryone === true) {
    return {
      id: key,
      chatId: String(v.chatId ?? ''),
      senderId: String(v.senderId ?? ''),
      type: 'text',
      content: '',
      createdAt: typeof v.createdAt === 'number' ? v.createdAt : Date.now(),
      status: 'seen',
      reactions: {},
    };
  }
  return {
    id: key,
    chatId: String(v.chatId ?? ''),
    senderId: String(v.senderId ?? ''),
    type: v.type === 'image' || v.type === 'video' ? v.type : 'text',
    content: typeof v.content === 'string' ? v.content : '',
    createdAt: typeof v.createdAt === 'number' ? v.createdAt : Date.now(),
    status: v.status === 'seen' || v.status === 'delivered' || v.status === 'sending' ? v.status : 'sent',
    reactions: (v.reactions as Record<string, string> | undefined) ?? {},
    replyTo: v.replyTo as DmMessage['replyTo'],
  };
}

/**
 * Subscribe to the most recent DM_PAGE_SIZE messages, oldest-first.
 * Returns an unsubscribe function.
 */
export function subscribeMessages(
  chatId: string,
  myUid: string,
  callback: (messages: DmMessage[]) => void,
): () => void {
  const msgsQuery = query(ref(rtdb, `chats/${chatId}/messages`), orderByKey(), limitToLast(DM_PAGE_SIZE));
  return onValue(msgsQuery, (snap) => {
    if (!snap.exists()) {
      callback([]);
      return;
    }
    const msgs: DmMessage[] = [];
    snap.forEach((child) => {
      const msg = snapToMessage(child.key ?? '', child.val() as Record<string, unknown>, myUid);
      if (msg) msgs.push(msg);
    });
    msgs.sort((a, b) => a.createdAt - b.createdAt);
    callback(msgs);
  });
}

/**
 * Send a text message. Updates userChats metadata for both participants
 * (atomic unread increment for the recipient) and fires a best-effort push.
 */
export async function sendMessage(
  chatId: string,
  myUid: string,
  myName: string,
  participantUid: string,
  content: string,
): Promise<void> {
  const text = content.trim().slice(0, 2000);
  if (!text) return;

  const newMsgRef = push(ref(rtdb, `chats/${chatId}/messages`));
  await set(newMsgRef, {
    chatId,
    senderId: myUid,
    type: 'text',
    content: text,
    createdAt: serverTimestamp(),
    status: 'sent',
    reactions: {},
  });

  const lastMessageTime = Date.now();
  await Promise.all([
    update(ref(rtdb, `userChats/${myUid}/${chatId}`), {
      id: chatId,
      lastMessage: text,
      lastMessageType: 'text',
      lastMessageTime,
      unreadCount: 0,
    }),
    // Atomic unread increment — no read-then-write race.
    update(ref(rtdb, `userChats/${participantUid}/${chatId}`), {
      id: chatId,
      lastMessage: text,
      lastMessageType: 'text',
      lastMessageTime,
      unreadCount: increment(1),
    }),
  ]);

  // Fire-and-forget push — never blocks message delivery.
  void apiFetch('/api/notifications/send', {
    method: 'POST',
    body: {
      externalUserId: participantUid,
      title: myName,
      message: text.slice(0, 200),
      category: 'messages',
      data: { chatId },
    },
  }).catch(() => {
    /* best-effort */
  });
}

/** Mark the other participant's recent messages as seen + reset unread. */
export async function markAllSeen(chatId: string, myUid: string): Promise<void> {
  const recentQuery = query(ref(rtdb, `chats/${chatId}/messages`), orderByKey(), limitToLast(100));
  const snap = await get(recentQuery);
  const updates: Record<string, string> = {};
  if (snap.exists()) {
    snap.forEach((child) => {
      const v = child.val() as { senderId: string; status: string };
      if (v.senderId !== myUid && v.status !== 'seen') {
        updates[`chats/${chatId}/messages/${child.key}/status`] = 'seen';
      }
    });
  }
  if (Object.keys(updates).length > 0) {
    await update(ref(rtdb), updates);
  }
  await update(ref(rtdb, `userChats/${myUid}/${chatId}`), { unreadCount: 0 }).catch(() => {
    /* best-effort */
  });
}

/** Set typing state — auto-clears after 4s; onDisconnect resets it. */
export function setTyping(chatId: string, myUid: string, isTyping: boolean): void {
  const typingRef = ref(rtdb, `chats/${chatId}/typing/${myUid}`);
  const payload = { isTyping, lastTypedAt: Date.now() };
  set(typingRef, payload).catch(() => {
    /* fire-and-forget */
  });
  if (isTyping) {
    setTimeout(() => {
      set(typingRef, { isTyping: false, lastTypedAt: Date.now() }).catch(() => {
        /* ephemeral — safe to swallow */
      });
    }, 4000);
  }
  fbOnDisconnect(typingRef).set({ isTyping: false, lastTypedAt: Date.now() }).catch(() => {
    /* non-critical */
  });
}

/** Subscribe to the other participant's typing status. */
export function subscribeTyping(
  chatId: string,
  participantUid: string,
  callback: (isTyping: boolean) => void,
): () => void {
  return onValue(ref(rtdb, `chats/${chatId}/typing/${participantUid}`), (snap) => {
    if (!snap.exists()) {
      callback(false);
      return;
    }
    const v = snap.val() as { isTyping?: boolean };
    callback(v.isTyping === true);
  });
}

/** Subscribe to a user's presence (respects their privacy toggles). */
export function subscribePresence(
  participantUid: string,
  callback: (online: boolean, lastSeen: number | null) => void,
): () => void {
  let cancelled = false;
  let realUnsub: (() => void) | null = null;

  void get(ref(rtdb, `users/${participantUid}/privacy`))
    .then((privacySnap) => {
      if (cancelled) return;
      const p = (privacySnap.exists() ? privacySnap.val() : {}) as {
        showOnlineStatus?: boolean;
        showLastSeen?: boolean;
      };
      const showOnline = p.showOnlineStatus !== false;
      const showLastSeen = p.showLastSeen !== false;
      realUnsub = onValue(ref(rtdb, `users/${participantUid}`), (snap) => {
        if (!snap.exists()) {
          callback(false, null);
          return;
        }
        const v = snap.val() as { online?: boolean; lastSeen?: number };
        callback(
          showOnline ? v.online === true : false,
          showLastSeen && typeof v.lastSeen === 'number' ? v.lastSeen : null,
        );
      });
    })
    .catch(() => {
      if (cancelled) return;
      realUnsub = onValue(ref(rtdb, `users/${participantUid}`), (snap) => {
        if (!snap.exists()) {
          callback(false, null);
          return;
        }
        const v = snap.val() as { online?: boolean; lastSeen?: number };
        callback(v.online === true, typeof v.lastSeen === 'number' ? v.lastSeen : null);
      });
    });

  return () => {
    cancelled = true;
    realUnsub?.();
  };
}

/** Subscribe to the logged-in user's chat list (newest first). */
export function subscribeUserChats(
  myUid: string,
  callback: (chats: ChatListEntry[]) => void,
): () => void {
  return onValue(ref(rtdb, `userChats/${myUid}`), (snap) => {
    if (!snap.exists()) {
      callback([]);
      return;
    }
    const chats: ChatListEntry[] = [];
    snap.forEach((child) => {
      const v = child.val() as Partial<ChatListEntry>;
      chats.push({
        id: child.key ?? '',
        participantId: v.participantId ?? '',
        participantName: v.participantName ?? 'Unknown',
        lastMessage: v.lastMessage ?? '',
        lastMessageType: v.lastMessageType ?? 'text',
        lastMessageTime: v.lastMessageTime ?? 0,
        unreadCount: v.unreadCount ?? 0,
        isOnline: v.isOnline ?? false,
        isPinned: v.isPinned ?? false,
      });
    });
    // Pinned first, then newest.
    chats.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return b.lastMessageTime - a.lastMessageTime;
    });
    callback(chats);
  });
}

/** Create (or get) a chat between two users; returns the chatId. */
export async function createOrGetChat(
  myUid: string,
  myName: string,
  participantUid: string,
  participantName: string,
): Promise<string> {
  const chatId = buildChatId(myUid, participantUid);
  const now = Date.now();
  const myEntry = ref(rtdb, `userChats/${myUid}/${chatId}`);
  const theirEntry = ref(rtdb, `userChats/${participantUid}/${chatId}`);
  const [mySnap, theirSnap] = await Promise.all([get(myEntry), get(theirEntry)]);
  if (!mySnap.exists()) {
    await set(myEntry, {
      id: chatId,
      participantId: participantUid,
      participantName,
      lastMessage: '',
      lastMessageType: 'text',
      lastMessageTime: now,
      unreadCount: 0,
      isOnline: false,
      isPinned: false,
    });
  }
  if (!theirSnap.exists()) {
    await set(theirEntry, {
      id: chatId,
      participantId: myUid,
      participantName: myName,
      lastMessage: '',
      lastMessageType: 'text',
      lastMessageTime: now,
      unreadCount: 0,
      isOnline: false,
      isPinned: false,
    });
  }
  return chatId;
}
