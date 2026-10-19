import { setTimeout as sleep } from 'node:timers/promises';
import {
  firstValueFrom,
  from,
  fromEvent,
  mergeMap,
  race,
  throwError,
} from 'rxjs';

/** A waiter may cancel without cancelling work shared by other token callers. */
export function waitFor<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();

  return firstValueFrom(
    race(
      from(promise),
      fromEvent(signal, 'abort').pipe(
        mergeMap(() => throwError(() => signal.reason)),
      ),
    ),
  );
}

export async function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  try {
    await sleep(ms, undefined, { signal });
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  }
}
