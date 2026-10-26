import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { fetchModeSchema } from './carrier-fetch-mode.js';

export const carrierExternalIdSchema = z.uuidv4();

export const updateCarrierSchema = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => !value.includes('\u0000'), 'Name cannot contain NUL')
      .optional(),
    isActive: z.boolean().optional(),
    failurePauseEnabled: z.boolean().optional(),
    failurePauseThreshold: z.int().min(1).max(10).optional(),
    sessionFailureDisableEnabled: z.boolean().optional(),
    sessionFailureDisableThreshold: z.int().min(1).max(10).optional(),
    fetchMode: fetchModeSchema.optional(),
    notFoundPauseThreshold: z.int().min(2).max(32767).optional(),
    pollIntervalMinutes: z.int().min(1).max(32767).optional(),
    rateLimitPerMinute: z.int().min(1).max(32767).nullable().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'At least one setting is required',
  });

export type CarrierUpdate = z.infer<typeof updateCarrierSchema>;

export function parseCarrierInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);

  if (!result.success) {
    // Do not echo client values, unknown field names, or credentials in errors.
    throw new BadRequestException('Invalid Carrier input');
  }

  return result.data;
}
