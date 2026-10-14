import { z } from 'zod';

export const fetchModeSchema = z.enum(['request', 'browser']);

export type FetchMode = z.infer<typeof fetchModeSchema>;

/** Shared metadata only: the API must not import worker/browser providers. */
export function supportsFetchMode(code: string, mode: FetchMode): boolean {
  return (
    code === 'echoship' ||
    code === 'ffe' ||
    (code === 'ups' && mode === 'request')
  );
}
