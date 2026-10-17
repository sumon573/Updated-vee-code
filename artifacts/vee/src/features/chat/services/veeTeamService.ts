/**
 * Vee Team System Account Service (2026-10-17, Sumon)
 *
 * The official system notice account. Every user gets it auto-added on signup;
 * ALL notices, warnings and announcements come from this ID. Users CANNOT
 * reply — the chat UI hides the input for this account.
 *
 *   VEE_TEAM_UID = 'vee_team'   (fixed, in users/vee_team with officialBadge)
 *
 * Message flow: notices are written with senderId='vee_team'. Firebase rules
 * allow this ONLY for (a) the chat participant themselves (welcome message —
 * harmless, only they see it) and (b) admins via the admin panel.
 */

import { ref, get, push, set, update } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { createOrGetChat, buildChatId } from './firebaseDmService';

export const VEE_TEAM_UID = 'vee_team';
export const VEE_TEAM_NAME = 'Vee Team';

/** True when the chat participant is the Vee Team system account. */
export function isVeeTeam(participantId: string | null | undefined): boolean {
  return participantId === VEE_TEAM_UID;
}

/**
 * Ensure the user has a Vee Team chat; send the welcome notice on first setup.
 * Called once from createUser() — safe to call again (welcome is deduped).
 * Never throws — a failed system-chat setup must never break signup.
 */
export async function ensureVeeTeamChat(myUid: string, myName: string): Promise<void> {
  try {
    if (!myUid || myUid === VEE_TEAM_UID) return;
    const chatId = await createOrGetChat(myUid, myName || 'User', VEE_TEAM_UID, VEE_TEAM_NAME);
    // Dedupe: only send the welcome if the chat has no messages yet.
    const msgsSnap = await get(ref(database, `chats/${chatId}/messages`)).catch(() => null);
    if (msgsSnap && msgsSnap.exists()) return;
    await sendSystemMessage(chatId, myUid,
      `👋 Welcome to Vee, ${myName || 'friend'}!\n\n` +
      `This is the official Vee Team account. Important notices, warnings and announcements will arrive here.\n\n` +
      `⚠️ This is a system account — replies are disabled.`);
  } catch {
    // Non-critical — signup must never fail because of the system chat.
  }
}

/**
 * Write a system notice from Vee Team into a 1-to-1 chat.
 * Used for the welcome message (app side). The admin panel has its own
 * sender for notices/warnings to any user.
 */
export async function sendSystemMessage(
  chatId: string,
  recipientUid: string,
  content: string,
): Promise<void> {
  const msgsRef = ref(database, `chats/${chatId}/messages`);
  const newMsgRef = push(msgsRef);
  const now = Date.now();

  await set(newMsgRef, {
    chatId,
    senderId: VEE_TEAM_UID,
    senderName: VEE_TEAM_NAME,
    type: 'text',
    content,
    createdAt: now,
    status: 'sent',
    reactions: {},
    isSystemNotice: true,
    deletedForMe: false,
    deletedForEveryone: false,
  });

  const meta = {
    id: chatId,
    lastMessage: content.length > 80 ? content.slice(0, 80) + '…' : content,
    lastMessageType: 'text',
    lastMessageTime: now,
    participantId: VEE_TEAM_UID,
    participantName: VEE_TEAM_NAME,
  };

  // Recipient's entry: unread +1. Vee Team's entry: keep metadata fresh.
  const recipRef = ref(database, `userChats/${recipientUid}/${chatId}`);
  const recipSnap = await get(recipRef).catch(() => null);
  const prevUnread = (recipSnap?.val()?.unreadCount as number) || 0;
  await Promise.all([
    update(recipRef, { ...meta, unreadCount: prevUnread + 1, isHidden: false }),
    update(ref(database, `userChats/${VEE_TEAM_UID}/${chatId}`), {
      ...meta,
      participantId: recipientUid,
      unreadCount: 0,
    }),
  ]);
}

/** Build the 1-to-1 chat ID between a user and Vee Team. */
export function veeTeamChatId(uid: string): string {
  return buildChatId(uid, VEE_TEAM_UID);
}
