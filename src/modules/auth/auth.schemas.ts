import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const roleSchema = z.enum(['admin', 'staff']);
const name = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => !value.includes('\0'));
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));
export const passwordSchema = z
  .string()
  .min(12)
  .max(128)
  .refine((value) => !value.includes('\0'));
export const createAccountSchema = z
  .object({
    firstName: name,
    lastName: name,
    email: emailSchema,
    password: passwordSchema,
    role: roleSchema,
  })
  .strict();
export const updateAccountSchema = createAccountSchema
  .omit({ password: true })
  .partial()
  .extend({ active: z.boolean().optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const signInSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
  })
  .strict();
export const resetPasswordSchema = z
  .object({ password: passwordSchema })
  .strict();
export const emptySchema = z.object({}).strict();
export function parseAuth<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new BadRequestException('Invalid authentication input');
  return result.data;
}
