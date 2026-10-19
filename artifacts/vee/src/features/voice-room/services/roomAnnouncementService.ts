/**
 * roomAnnouncementService.ts — IMO room announcements, ported to Vee (2026-10-19).
 *
 * IMO evidence: voiceroom/anouncement/model/AnnounceMsg {msg_create_time, msg_content}
 * + EditBigGroupAnnouncementActivity pattern (owner/admin edits a pinned notice).
 * IMO behavior: owner/admin posts one pinned announcement per room; every member
 * sees it as a banner/panel; only owner/admin can edit or clear it.
 *
 * Vee backend: rooms/{roomId}/announcement = { content, createdAt, createdBy, createdByName }.
 * RULES DEPENDENCY (must be deployed — see report): rooms/$roomId/announcement —
 *   .read: auth != null; .write: room owner, room admin, or platform role.
 */

import { ref, set, remove, onValue } from 'firebase/database';
import { database } from '@/src/config/firebase';

export interface RoomAnnouncement {
  content: string;
  createdAt: number;
  createdBy: string;
  createdByName: string;
}

function announcementRef(roomId: string) {
  return ref(database, `rooms/${roomId}/announcement`);
}

/** Live announcement for a room (null when none). */
export function subscribeAnnouncement(
  roomId: string,
  cb: (a: RoomAnnouncement | null) => void,
): () => void {
  return onValue(
    announcementRef(roomId),
    (snap) => {
      if (!snap.exists()) {
        cb(null);
        return;
      }
      const v = snap.val() as Partial<RoomAnnouncement>;
      if (typeof v.content !== 'string' || !v.content.trim()) {
        cb(null);
        return;
      }
      cb({
        content: v.content,
        createdAt: typeof v.createdAt === 'number' ? v.createdAt : 0,
        createdBy: typeof v.createdBy === 'string' ? v.createdBy : '',
        createdByName: typeof v.createdByName === 'string' ? v.createdByName : '',
      });
    },
    () => cb(null),
  );
}

/** Owner/admin posts (or replaces) the room announcement. */
export async function setAnnouncement(
  roomId: string,
  uid: string,
  userName: string,
  content: string,
): Promise<void> {
  const trimmed = content.trim().slice(0, 500);
  if (!trimmed) throw new Error('empty');
  await set(announcementRef(roomId), {
    content: trimmed,
    createdAt: Date.now(),
    createdBy: uid,
    createdByName: userName,
  });
}

/** Owner/admin clears the announcement. */
export async function clearAnnouncement(roomId: string): Promise<void> {
  await remove(announcementRef(roomId));
}
