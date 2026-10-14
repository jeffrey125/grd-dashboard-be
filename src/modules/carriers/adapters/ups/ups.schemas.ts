import { z } from 'zod';

const text = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => value.trim().length > 0);
const date = z
  .string()
  .regex(/^\d{8}$/)
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const parsed = new Date(Date.UTC(year, month - 1, day));

    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  });

// Zod strips unknown keys. Raw values remain available for allowlisted source data.
export const upsPackageSchema = z.object({
  trackingNumber: z.string().min(7).max(34),
  currentStatus: z.object({
    description: text,
    simplifiedTextDescription: z.string().max(255).nullable().optional(),
  }),
  deliveryDate: z
    .array(
      z.object({
        type: text,
        date: date.nullable().optional(),
      }),
    )
    .max(100)
    .nullable()
    .optional(),
});

export const upsResponseSchema = z.object({
  trackResponse: z.object({
    shipment: z
      .array(z.object({ package: z.array(z.unknown()).max(1000) }))
      .max(1000),
  }),
});

export const upsOAuthSchema = z.object({
  access_token: z
    .string()
    .min(1)
    .max(16_384)
    .refine((value) => !/\s/.test(value)),
  expires_in: z
    .union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/)])
    .transform(Number)
    .pipe(z.number().positive().max(2_147_483)),
});
