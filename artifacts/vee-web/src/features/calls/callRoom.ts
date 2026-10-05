/**
 * Deterministic 1-to-1 call room id.
 *
 * MUST match the native app exactly (`buildCallRoomId` in
 * `vee/src/features/audio-call/services/firebaseCallService.ts`):
 *   `ac_${[uidA, uidB].sort().join('_')}`
 * so web and native clients rendezvous on the same RTDB signaling node
 * without any extra coordination.
 */
export function buildCallRoomId(uidA: string, uidB: string): string {
  return `ac_${[uidA, uidB].sort().join('_')}`;
}
