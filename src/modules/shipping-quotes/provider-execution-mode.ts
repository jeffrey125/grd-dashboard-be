import { z } from 'zod';

export const executionModeSchema = z.enum(['api', 'request', 'browser']);
export type ExecutionMode = z.infer<typeof executionModeSchema>;

export function providerExecutionModes(
  code: 'amazon' | 'unishippers',
): ExecutionMode[] {
  return code === 'amazon' ? ['api'] : ['request', 'browser'];
}

export function providerSupportsExecutionMode(
  code: 'amazon' | 'unishippers',
  mode: ExecutionMode,
): boolean {
  return providerExecutionModes(code).includes(mode);
}
