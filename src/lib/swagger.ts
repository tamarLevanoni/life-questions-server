import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { Occupation } from '@prisma/client';
import {
  CreateUserSchema,
  UpdateProfileSchema,
  UuidParamSchema,
  GoogleIdParamSchema,
} from '../modules/users/users.validators';
// Note: extendZodWithOpenApi(z) is called in users.validators.ts — importing it first ensures it runs before this module
import { SearchStoriesSchema, StoryIdParamSchema } from '../modules/stories/stories.validators';

const registry = new OpenAPIRegistry();

// ── Reusable schemas ──────────────────────────────────────────────────────────

const UserResponseSchema = z
  .object({
    id: z.uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
    googleId: z.string().nullable().openapi({ example: '112233445566778899' }),
    email: z.email().openapi({ example: 'user@example.com' }),
    firstName: z.string().openapi({ example: 'Yosef' }),
    lastName: z.string().openapi({ example: 'Cohen' }),
    institutionName: z.string().nullable().openapi({ example: 'Yeshivat Har Etzion' }),
    phone: z.string().openapi({ example: '+972501234567' }),
    occupations: z.array(z.enum(Object.values(Occupation) as [Occupation, ...Occupation[]])).openapi({ example: ['teacher'] }),
    marketingConsent: z.boolean().openapi({ example: true }),
    createdAt: z.iso.datetime().openapi({ example: '2024-01-15T10:30:00.000Z' }),
    updatedAt: z.iso.datetime().openapi({ example: '2024-06-01T08:00:00.000Z' }),
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

// ── Reusable story schemas ────────────────────────────────────────────────────

const ShuSectionSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  name: z.string().openapi({ example: 'אורח חיים' }),
}).openapi('ShuSection');

const ShuSimanSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  siman: z.number().openapi({ example: 328 }),
  title: z.string().nullable().openapi({ example: 'הלכות שבת' }),
}).openapi('ShuSiman');

const MasechetSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  name: z.string().openapi({ example: 'בבא קמא' }),
  orderIndex: z.number().openapi({ example: 1 }),
}).openapi('Masechet');

const ShasPageSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  daf: z.number().openapi({ example: 5 }),
  amud: z.string().openapi({ example: 'a' }),
}).openapi('ShasPage');

const TopicSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  bookNumber: z.number().openapi({ example: 1 }),
  name: z.string().openapi({ example: 'נזיקין' }),
  orderIndex: z.number().openapi({ example: 1 }),
}).openapi('Topic');

const StoryResponseSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  bookNumber: z.number().openapi({ example: 1 }),
  storyOrder: z.number().openapi({ example: 5 }),
  title: z.string().openapi({ example: 'מעשה בגנב שנכנס לחצר' }),
  storyBody: z.string().openapi({ example: 'סיפור המעשה...' }),
  legalQuestion: z.string().openapi({ example: 'האם חייב לשלם?' }),
  legalQuestionSource: z.string().openapi({ example: 'בבא קמא ז.' }),
  shortAnswer: z.string().openapi({ example: 'חייב בנזק שלם' }),
  expansion: z.string().nullable().openapi({ example: 'הרחבה מפורטת...' }),
  conceptsAi: z.array(z.string()).openapi({ example: ['גנבה', 'נזיקין'] }),
  conceptsFromIndex: z.array(z.string()).openapi({ example: ['גנבה'] }),
  videoUrl: z.string().nullable().openapi({ example: null }),
  imageUrl: z.string().nullable().openapi({ example: null }),
  topic: TopicSchema,
  createdAt: z.iso.datetime().openapi({ example: '2024-01-15T10:30:00.000Z' }),
  updatedAt: z.iso.datetime().openapi({ example: '2024-06-01T08:00:00.000Z' }),
}).openapi('StoryResponse');

const PaginatedStoriesSchema = z.object({
  stories: z.array(StoryResponseSchema),
  total: z.number().openapi({ example: 142 }),
  page: z.number().openapi({ example: 1 }),
  limit: z.number().openapi({ example: 20 }),
}).openapi('PaginatedStories');

registry.register('StoryResponse', StoryResponseSchema);
registry.register('PaginatedStories', PaginatedStoriesSchema);
registry.register('SearchStoriesQuery', SearchStoriesSchema);

// ── GET /api/stories ──────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/stories',
  tags: ['Stories'],
  summary: 'Search stories',
  description: 'Hybrid search: vector similarity (pgvector) when embeddings exist, falls back to ILIKE. Supports filtering by Shas reference, Shulchan Aruch reference, or concept tag. Paginated.',
  security: [{ ApiSecretAuth: [] }],
  request: {
    query: SearchStoriesSchema,
  },
  responses: {
    200: {
      description: 'Paginated list of stories matching filters',
      content: { 'application/json': { schema: StandardSuccessSchema(PaginatedStoriesSchema) } },
    },
    401: {
      description: 'Missing or invalid x-api-secret header',
      content: { 'application/json': { schema: StandardErrorSchema } },
    },
    422: {
      description: 'Invalid query parameters',
      content: { 'application/json': { schema: StandardErrorSchema } },
    },
  },
});

// ── GET /api/stories/:id ──────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/stories/{id}',
  tags: ['Stories'],
  summary: 'Get story by ID',
  description: 'Returns full story including Shas and Shulchan Aruch references. The expansion field is currently always returned.',
  security: [{ ApiSecretAuth: [] }],
  request: {
    params: z.object({ id: StoryIdParamSchema }),
  },
  responses: {
    200: {
      description: 'Story found',
      content: { 'application/json': { schema: StandardSuccessSchema(StoryResponseSchema) } },
    },
    400: {
      description: 'Invalid UUID format for story ID',
      content: { 'application/json': { schema: StandardErrorSchema } },
    },
    401: {
      description: 'Missing or invalid x-api-secret header',
      content: { 'application/json': { schema: StandardErrorSchema } },
    },
    404: {
      description: 'Story not found',
      content: { 'application/json': { schema: StandardErrorSchema } },
    },
  },
});

// ── GET /api/reference/masechtot ─────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/reference/masechtot',
  tags: ['Reference'],
  summary: 'List all tractates (Shas)',
  description: 'Returns all Talmudic tractates sorted by orderIndex. Cached for 1 hour.',
  security: [{ ApiSecretAuth: [] }],
  responses: {
    200: {
      description: 'List of tractates',
      content: { 'application/json': { schema: StandardSuccessSchema(z.array(MasechetSchema)) } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: StandardErrorSchema } } },
  },
});

// ── GET /api/reference/masechtot/:id/pages ───────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/reference/masechtot/{id}/pages',
  tags: ['Reference'],
  summary: 'Get pages for a tractate',
  description: 'Returns all daf/amud combinations for a given tractate. Load after user selects a tractate. Cached for 1 hour.',
  security: [{ ApiSecretAuth: [] }],
  request: {
    params: z.object({ id: UuidParamSchema }),
  },
  responses: {
    200: {
      description: 'List of pages',
      content: { 'application/json': { schema: StandardSuccessSchema(z.array(ShasPageSchema)) } },
    },
    400: { description: 'Invalid UUID', content: { 'application/json': { schema: StandardErrorSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: StandardErrorSchema } } },
  },
});

// ── GET /api/reference/shu-sections ──────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/reference/shu-sections',
  tags: ['Reference'],
  summary: 'List Shulchan Aruch sections with nested simanim',
  description: 'Returns all four sections of the Shulchan Aruch, each with its full list of simanim. Cached for 1 hour.',
  security: [{ ApiSecretAuth: [] }],
  responses: {
    200: {
      description: 'Sections with simanim',
      content: {
        'application/json': {
          schema: StandardSuccessSchema(
            z.array(ShuSectionSchema.extend({ simanim: z.array(ShuSimanSchema) }))
          ),
        },
      },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: StandardErrorSchema } } },
  },
});

// ── GET /api/reference/shu-sections/:sectionId/simanim ───────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/reference/shu-sections/{sectionId}/simanim',
  tags: ['Reference'],
  summary: 'Get simanim for a Shulchan Aruch section',
  description: 'Returns simanim for a specific section. Cached for 1 hour.',
  security: [{ ApiSecretAuth: [] }],
  request: {
    params: z.object({ sectionId: UuidParamSchema }),
  },
  responses: {
    200: {
      description: 'List of simanim',
      content: { 'application/json': { schema: StandardSuccessSchema(z.array(ShuSimanSchema)) } },
    },
    400: { description: 'Invalid UUID', content: { 'application/json': { schema: StandardErrorSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: StandardErrorSchema } } },
  },
});

// ── GET /api/reference/topics ─────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/reference/topics',
  tags: ['Reference'],
  summary: 'List all topics',
  description: 'Returns all topics ordered by bookNumber then orderIndex. Cached for 1 hour.',
  security: [{ ApiSecretAuth: [] }],
  responses: {
    200: {
      description: 'List of topics',
      content: { 'application/json': { schema: StandardSuccessSchema(z.array(TopicSchema)) } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: StandardErrorSchema } } },
  },
});

// ── GET /api/reference/concepts ──────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/reference/concepts',
  tags: ['Reference'],
  summary: 'List all distinct concept tags',
  description: 'Aggregates distinct values from conceptsAi and conceptsFromIndex across all stories. Cached for 24 hours.',
  security: [{ ApiSecretAuth: [] }],
  responses: {
    200: {
      description: 'Sorted list of unique concept strings',
      content: { 'application/json': { schema: StandardSuccessSchema(z.array(z.string())) } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: StandardErrorSchema } } },
  },
});

// ── POST /api/reference/cache/invalidate ──────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/reference/cache/invalidate',
  tags: ['Reference'],
  summary: 'Invalidate reference cache',
  description: 'Clears all in-memory reference cache entries. Call this manually after updating lists (masechtot, shu sections, topics, concepts). The next request to any reference endpoint will re-fetch from the database.',
  security: [{ ApiSecretAuth: [] }],
  responses: {
    200: {
      description: 'Cache cleared successfully',
      content: {
        'application/json': {
          schema: StandardSuccessSchema(z.object({ message: z.string() })),
        },
      },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: StandardErrorSchema } } },
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
