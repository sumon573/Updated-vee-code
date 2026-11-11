/* ── 2026-11-11 (boss, imo mirror): one-shot "return to room" action ────
   The full profile is pushed OVER the room; its gift button and "@" button
   act back IN the room (open GiftsModal for the user / insert @name into
   the room chat input). The profile requests the action + goes back; the
   room screen consumes it once on focus (useFocusEffect). Single-shot:
   consume() clears it, so a second focus never replays it. No timers, no
   polling, no subscription — one module-level slot. */

export type RoomReturnAction =
  | { type: 'gift'; roomId: string; uid: string; name: string }
  | { type: 'mention'; roomId: string; uid: string; name: string };

let pending: RoomReturnAction | null = null;

export function requestRoomReturnAction(action: RoomReturnAction): void {
  pending = action;
}

export function consumeRoomReturnAction(): RoomReturnAction | null {
  const action = pending;
  pending = null;
  return action;
}
