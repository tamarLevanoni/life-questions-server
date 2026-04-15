import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { Occupation } from './generated/prisma';
import {
  CreateUserSchema,
  UpdateProfileSchema,
  UuidParamSchema,
  GoogleIdParamSchema,
} from '../modules/users/users.validators';
// Note: extendZodWithOpenApi(z) is called in users.validators.ts — importing it first ensures it runs before this module

const registry = new OpenAPIRegistry();

// ── Reusable schemas ──────────────────────────────────────────────────────────

const UserResponseSchema = z
  .object({
    id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
    googleId: z.string().nullable().openapi({ example: '112233445566778899' }),
    email: z.string().email().openapi({ example: 'user@example.com' }),
    firstName: z.string().openapi({ example: 'Yosef' }),
    lastName: z.string().openapi({ example: 'Cohen' }),
    institutionName: z.string().nullable().openapi({ example: 'Yeshivat Har Etzion' }),
    phone: z.string().openapi({ example: '+972501234567' }),
    occupations: z.array(z.nativeEnum(Occupation)).openapi({ example: ['teacher'] }),
    marketingConsent: z.boolean().openapi({ example: true }),
    createdAt: z.string().datetime().openapi({ example: '2024-01-15T10:30:00.000Z' }),
    updatedAt: z.string().datetime().openapi({ example: '2024-06-01T08:00:00.000Z' }),
  })
  .openapi('UserResponse');

const StandardErrorSchema = z
  .object({
    success: z.literal(false),
    error: z.string().openapi({ example: 'User not found' }),
  })
  .openapi('StandardError');

const StandardSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  });

registry.register('UserResponse', UserResponseSchema);
registry.register('StandardError', StandardErrorSchema);
registry.register('CreateUserRequest', CreateUserSchema);
registry.register('UpdateProfileRequest', UpdateProfileSchema);

// ── Security scheme ───────────────────────────────────────────────────────────

registry.registerComponent('securitySchemes', 'ApiSecretAuth', {
  type: 'apiKey',
  in: 'header',
  name: 'x-api-secret',
  description: 'Shared secret sent from the Next.js BFF. Required on every request.',
});

// ── POST /api/users ───────────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/users',
  tags: ['Users'],
  summary: 'Create a new user',
  description: 'Creates a user record after Google OAuth sign-up. Fails if the email already exists.',
  security: [{ ApiSecretAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        'application/json': { schema: CreateUserSchema },
      },
    },
  },
  responses: {
    201: {
      description: 'User created successfully',
      content: {
        'application/json': { schema: StandardSuccessSchema(UserResponseSchema) },
      },
    },
    401: {
      description: 'Missing or invalid x-api-secret header',
      content: { 'application/json': { schema: StandardErrorSchema } },
    },
    409: {
      description: 'A user with this email already exists',
      content: { 'application/json': { schema: StandardErrorSchema } },
    },
    422: {
      description: 'Request body failed validation',
      content: { 'application/json': { schema: StandardErrorSchema } },
    },
  },
});

// ── GET /api/users/google/:googleId ──────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/users/google/{googleId}',
  tags: ['Users'],
  summary: 'Get user by Google ID',
  description: 'Looks up a user by their Google OAuth subject identifier.',
  security: [{ ApiSecretAuth: [] }],
  request: {
    params: z.object({ googleId: GoogleIdParamSchema }),
  },
  responses: {
    200: {
      description: 'User found',
      content: {
        'application/json': { schema: StandardSuccessSchema(UserResponseSchema) },
      },
    },
    401: {
      description: 'Missing or invalid x-api-secret header',
      content: { 'application/json': { schema: StandardErrorSchema } },
    },
    404: {
      description: 'User not found',
      content: { 'application/json': { schema: StandardErrorSchema } },
    },
  },
});

// ── PATCH /api/users/profile/:id ─────────────────────────────────────────────

registry.registerPath({
  method: 'patch',
  path: '/api/users/profile/{id}',
  tags: ['Users'],
  summary: 'Update user profile',
  description: 'Partially updates mutable profile fields. At least one field must be provided.',
  security: [{ ApiSecretAuth: [] }],
  request: {
    params: z.object({ id: UuidParamSchema }),
    body: {
      required: true,
      content: {
        'application/json': { schema: UpdateProfileSchema },
      },
    },
  },
  responses: {
    200: {
      description: 'Profile updated successfully',
      content: {
        'application/json': { schema: StandardSuccessSchema(UserResponseSchema) },
      },
    },
    400: {
      description: 'Invalid UUID format for user ID',
      content: { 'application/json': { schema: StandardErrorSchema } },
    },
    401: {
      description: 'Missing or invalid x-api-secret header',
      content: { 'application/json': { schema: StandardErrorSchema } },
    },
    404: {
      description: 'User not found',
      content: { 'application/json': { schema: StandardErrorSchema } },
    },
    422: {
      description: 'Request body failed validation',
      content: { 'application/json': { schema: StandardErrorSchema } },
    },
  },
});

// ── Generate spec ─────────────────────────────────────────────────────────────

const generator = new OpenApiGeneratorV3(registry.definitions);

export const swaggerSpec = generator.generateDocument({
  openapi: '3.0.0',
  info: {
    title: 'Life Questions API',
    version: '1.0.0',
    description:
      'Private backend API for the Life Questions educational platform. ' +
      'All endpoints require the `x-api-secret` header. Not publicly accessible.',
  },
  servers: [{ url: '/', description: 'Current host' }],
});
