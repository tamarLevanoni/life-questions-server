import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { Occupation } from '../../lib/generated/prisma';

extendZodWithOpenApi(z);

const OccupationEnum = z.enum(Object.values(Occupation) as [Occupation, ...Occupation[]]);

export const CreateUserSchema = z
  .object({
    googleId: z.string().min(1, { message: 'googleId is required' }).openapi({ example: '112233445566778899' }),
    email: z.email({ error: 'email must be a valid email address' }).openapi({ example: 'user@example.com' }),
    firstName: z.string().min(1, { message: 'firstName is required' }).openapi({ example: 'Yosef' }),
    lastName: z.string().min(1, { message: 'lastName is required' }).openapi({ example: 'Cohen' }),
    institutionName: z.string().optional().openapi({ example: 'Yeshivat Har Etzion' }),
    phone: z.string().min(1, { message: 'phone is required' }).openapi({ example: '+972501234567' }),
    occupations: z.array(OccupationEnum).optional().default([]),
    marketingConsent: z.boolean().optional().default(true).openapi({ example: true }),
  })
  .openapi('CreateUserRequest');

export const UpdateProfileSchema = z
  .object({
    firstName: z.string().min(1, { message: 'firstName cannot be empty' }).optional().openapi({ example: 'Miriam' }),
    lastName: z.string().min(1, { message: 'lastName cannot be empty' }).optional().openapi({ example: 'Levi' }),
    institutionName: z.string().nullable().optional().openapi({ example: 'Machon Meir' }),
    phone: z.string().min(1, { message: 'phone cannot be empty' }).optional().openapi({ example: '+972509876543' }),
    occupations: z.array(OccupationEnum).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  })
  .openapi('UpdateProfileRequest');

export const UuidParamSchema = z
  .uuid({ error: 'id must be a valid UUID' })
  .openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' });

export const GoogleIdParamSchema = z
  .string()
  .min(1, { message: 'googleId is required' })
  .openapi({ example: '112233445566778899' });

export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
