import { z } from 'zod';

const OccupationEnum = z.enum(['jurist', 'educator', 'student', 'parent', 'learner']);

export const SyncUserSchema = z.object({
  id: z.string().uuid({ message: 'id must be a valid UUID' }),
  email: z.string().email({ message: 'email must be a valid email address' }),
  firstName: z.string().min(1, { message: 'firstName is required' }),
  lastName: z.string().min(1, { message: 'lastName is required' }),
  institutionName: z.string().optional(),
  phone: z.string().min(1, { message: 'phone is required' }),
  occupations: z.array(OccupationEnum).optional().default([]),
  marketingConsent: z.boolean().optional().default(true),
});

export const UpdateProfileSchema = z
  .object({
    firstName: z.string().min(1, { message: 'firstName cannot be empty' }).optional(),
    lastName: z.string().min(1, { message: 'lastName cannot be empty' }).optional(),
    institutionName: z.string().nullable().optional(),
    phone: z.string().min(1, { message: 'phone cannot be empty' }).optional(),
    occupations: z.array(OccupationEnum).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

export const UuidParamSchema = z.string().uuid({ message: 'id must be a valid UUID' });

export type SyncUserInput = z.infer<typeof SyncUserSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
