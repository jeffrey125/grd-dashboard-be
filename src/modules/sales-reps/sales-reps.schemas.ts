import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const salesRepExternalIdSchema = z
  .uuidv4()
  .transform((id) => id.toLowerCase());

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => !value.includes('\u0000'));

export const createSalesRepSchema = z.strictObject({
  firstName: nameSchema,
  lastName: nameSchema,
  email: emailSchema,
});

export const updateSalesRepSchema = z
  .strictObject({
    firstName: nameSchema.optional(),
    lastName: nameSchema.optional(),
    email: emailSchema.optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'At least one field is required',
  });

export type NewSalesRep = z.infer<typeof createSalesRepSchema>;
export type SalesRepUpdate = z.infer<typeof updateSalesRepSchema>;

export const salesRepRecordSchema = z.strictObject({
  externalId: z.uuidv4(),
  firstName: z.string(),
  lastName: z.string(),
  email: emailSchema,
  active: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().nullable(),
});

export function parseSalesRepInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);

  if (!result.success) throw new BadRequestException('Invalid Sales Rep input');

  return result.data;
}
