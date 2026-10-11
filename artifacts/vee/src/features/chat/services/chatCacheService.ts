/**
 * Chat cache service (NOTE 5, 2026-10-11).
 *
 * Offline-first chat history: the chat list and recent messages are cached
 * in AsyncStorage on every Firebase update. When the app opens offline (or
 * before the first snapshot arrives), screens render the cached copy
 * instantly instead of a spinner. Firebase subscriptions keep the cache
 * fresh whenever the network is available (auto-sync on reconnect is
 * inherent to onValue — it re-fires with the latest data).
 *
 * Cache is per-user (chat list) and per-chat (messages). Stale entries are
 * bounded: only the latest snapshot is kept, old users' caches are pruned
 * on write.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Chat } from '../types';
import type { DmMessage } from '../types/dm';

const CHAT_LIST_KEY = (uid: string) => `vee_chat_list_v1_${uid}`;
const CHAT_MSGS_KEY = (chatId: string) => `vee_chat_msgs_v1_${chatId}`;
const LAST_UID_KEY = 'vee_chat_cache_last_uid';
const MAX_CACHED_MESSAGES = 50;

async function safeGet(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function safeSet(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    /* cache write failure is non-fatal — app keeps working online */
  }
}

/** Save the latest chat list snapshot for offline use. */
export async function saveChatList(uid: string, chats: Chat[]): Promise<void> {
  // Prune the previous user's cache when the account changes.
  try {
    const lastUid = await AsyncStorage.getItem(LAST_UID_KEY);
    if (lastUid && lastUid !== uid) {
      await AsyncStorage.removeItem(CHAT_LIST_KEY(lastUid)).catch(() => {});
    }
    await AsyncStorage.setItem(LAST_UID_KEY, uid);
  } catch {
    /* non-fatal */
  }
  await safeSet(CHAT_LIST_KEY(uid), JSON.stringify(chats));
}

/** Load the cached chat list, or null when nothing was cached yet. */
export async function loadChatList(uid: string): Promise<Chat[] | null> {
  const raw = await safeGet(CHAT_LIST_KEY(uid));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Chat[]) : null;
  } catch {
    return null;
  }
}

/** Save the latest message page for a chat (bounded to the most recent 50). */
export async function saveChatMessages(chatId: string, messages: DmMessage[]): Promise<void> {
  const trimmed = messages.slice(-MAX_CACHED_MESSAGES);
  await safeSet(CHAT_MSGS_KEY(chatId), JSON.stringify(trimmed));
}

/** Load cached messages for a chat, or null when nothing was cached yet. */
export async function loadChatMessages(chatId: string): Promise<DmMessage[] | null> {
  const raw = await safeGet(CHAT_MSGS_KEY(chatId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DmMessage[]) : null;
  } catch {
    return null;
  }
}
