/**
 * withTimeout — race a promise against a timer.
 *
 * Offline-resilience helper: Firebase RTDB write promises only resolve on
 * server acknowledgement, so a bare `await` on a write hangs indefinitely
 * with no feedback while the device is offline (the write is queued
 * client-side and replayed on reconnect). Racing against a timeout lets the
 * UI stop showing a "saving" state and tell the user the change is queued,
 * without cancelling the underlying write.
 *
 * The wrapped promise is NEVER cancelled on timeout — it keeps running, and
 * a late rejection is swallowed so it can never surface as an unhandled
 * rejection after the caller has moved on.
 *
 * Returns `{ timedOut: false, value }` when the promise wins,
 * `{ timedOut: true }` when the timer wins.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });

  // Attach handlers up-front: clears the timer on settle, and — critically —
  // marks a late rejection as handled so it can never become an unhandled
  // rejection after the timeout path has already resolved.
  promise.then(
    () => { if (timer) clearTimeout(timer); },
    () => { if (timer) clearTimeout(timer); },
  );

  return Promise.race([
    promise.then((value): { timedOut: false; value: T } => ({ timedOut: false, value })),
    timeoutPromise,
  ]);
}
