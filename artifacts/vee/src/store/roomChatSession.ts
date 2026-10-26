/**
 * roomChatSession — session-scoped room chat (boss 2026-10-26).
 *
 * Concept: a room's chat view starts fresh on every entry, and while the
 * user stays they see only the last 30 messages. Leaving + re-entering
 * shows NOTHING from before — not from a previous stay, not from while
 * they were away.
 *
 * The session survives minimize-return: the room screen unmounts on
 * minimize but the user never left (the minimized record proves it), so
 * the stored joinTs is reused on return. Any other unmount (explicit
 * leave, kick/disband navigation, invite to another room) clears it via
 * the screen's unmount cleanup, and a cold start starts empty by
 * construction (module state). A different roomId overwrites the slot.
 */

let session: { roomId: string; joinTs: number } | null = null;

export function getRoomChatSession(roomId: string): number | null {
  return session && session.roomId === roomId ? session.joinTs : null;
}

export function setRoomChatSession(roomId: string, joinTs: number): void {
  session = { roomId, joinTs };
}

export function clearRoomChatSession(roomId: string): void {
  if (session && session.roomId === roomId) session = null;
}
