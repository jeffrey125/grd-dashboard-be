import { z } from 'zod';

export const verificationActionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('click'),
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    frame: z.string().uuid(),
  }),
  z.strictObject({
    type: z.literal('text'),
    text: z.string().min(1).max(100),
    frame: z.string().uuid(),
  }),
  z.strictObject({
    type: z.literal('key'),
    key: z.enum([
      'Enter',
      'Backspace',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Space',
    ]),
    frame: z.string().uuid(),
  }),
]);
export type VerificationAction = z.infer<typeof verificationActionSchema>;

const identity = {
  owner: z.string().min(1).max(100),
  actorExternalId: z.string().uuid(),
  comparisonId: z.string().uuid(),
  attemptId: z.string().uuid(),
};
export const verificationCommandSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...identity, operation: z.literal('start') }),
  z.strictObject({
    ...identity,
    operation: z.literal('poll'),
    id: z.string().uuid(),
  }),
  z.strictObject({
    ...identity,
    operation: z.literal('cancel'),
    id: z.string().uuid(),
  }),
  z.strictObject({
    ...identity,
    operation: z.literal('action'),
    id: z.string().uuid(),
    action: verificationActionSchema,
  }),
]);
export type VerificationCommand = z.infer<typeof verificationCommandSchema>;
export const verificationViewSchema = z.strictObject({
  id: z.string().uuid(),
  state: z.enum(['preparing', 'challenge', 'verified', 'cancelled']),
  expiresAt: z.string().datetime(),
  image: z.string().max(3_000_000).optional(),
  frame: z.string().uuid().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});
export type VerificationView = z.infer<typeof verificationViewSchema>;
export const verificationErrorSchema = z.enum([
  'busy',
  'expired',
  'unavailable',
  'unsupported',
  'owner_required',
  'stale_frame',
]);
export type VerificationErrorCode = z.infer<typeof verificationErrorSchema>;
export class VerificationError extends Error {
  constructor(readonly code: VerificationErrorCode) {
    super(code);
  }
}
