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
import { ContactSchema } from '../modules/contact/contact.validators';
import {
  SearchStoriesSchema,
  ShasRefFilterSchema,
  ShuRefFilterSchema,
  StoryIdParamSchema,
  StoryResponseSchema,
  FullStorySchema,
  StoryCardSchema,
  StoryStubSchema,
  StoryNeighborsSchema,
  StoriesCardListSchema,
  BookSchema,
  MasechetSchema,
  MasechetWithPagesSchema,
  ShuSectionSchema,
  ShuSimanSchema,
  TopicSchema,
} from '../modules/stories/stories.validators';

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

registry.register('StoryResponse', StoryResponseSchema);
registry.register('FullStory', FullStorySchema);
registry.register('StoryCard', StoryCardSchema);
registry.register('ShasRefFilter', ShasRefFilterSchema);
registry.register('ShuRefFilter', ShuRefFilterSchema);
registry.register('StoriesCardList', StoriesCardListSchema);
registry.register('SearchStoriesBody', SearchStoriesSchema);

// ── POST /api/stories/search ──────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/stories/search',
  tags: ['Stories'],
  summary: 'Search stories',
  description: 'Hybrid search: vector similarity (pgvector, cosine) when embeddings exist, falls back to ILIKE. Supports multi-value filtering by bookIds, topicIds, masechetIds, shuSectionIds, simanIds, and concepts arrays. Paginated.',
  security: [{ ApiSecretAuth: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: SearchStoriesSchema } },
    },
  },
  responses: {
    200: {
      description: 'Paginated list of stories matching filters',
      content: { 'application/json': { schema: StandardSuccessSchema(StoriesCardListSchema) } },
    },
    401: {
      description: 'Missing or invalid x-api-secret header',
      content: { 'application/json': { schema: StandardErrorSchema } },
    },
    422: {
      description: 'Invalid request body',
      content: { 'application/json': { schema: StandardErrorSchema } },
    },
  },
});

// ── GET /api/stories/featured ─────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/stories/featured',
  tags: ['Stories'],
  summary: 'Get featured full stories',
  description: 'Returns 3 random stories with all fields and references (Shas, Shu, topic, central siman). Intended for homepage / showcase use.',
  security: [{ ApiSecretAuth: [] }],
  responses: {
    200: {
      description: 'Array of 3 random full stories (may be fewer if the database has less than 3)',
      content: { 'application/json': { schema: StandardSuccessSchema(z.array(FullStorySchema)) } },
    },
    401: {
      description: 'Missing or invalid x-api-secret header',
      content: { 'application/json': { schema: StandardErrorSchema } },
    },
  },
});

// ── GET /api/stories/:id ──────────────────────────────────────────────────────

registry.register('StoryStub', StoryStubSchema);
registry.register('StoryNeighbors', StoryNeighborsSchema);

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

// ── GET /api/reference/books ─────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/reference/books',
  tags: ['Reference'],
  summary: 'List all books',
  description: 'Returns all books sorted alphabetically by name. Cached.',
  security: [{ ApiSecretAuth: [] }],
  responses: {
    200: {
      description: 'List of books',
      content: { 'application/json': { schema: StandardSuccessSchema(z.array(BookSchema)) } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: StandardErrorSchema } } },
  },
});

// ── GET /api/reference/masechtot ─────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/reference/masechtot',
  tags: ['Reference'],
  summary: 'List all tractates (Shas) with pages',
  description: 'Returns all Talmudic tractates sorted by orderIndex, each with its full list of daf/amud pages. Cached.',
  security: [{ ApiSecretAuth: [] }],
  responses: {
    200: {
      description: 'List of tractates with nested pages',
      content: { 'application/json': { schema: StandardSuccessSchema(z.array(MasechetWithPagesSchema)) } },
    },
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

// ── GET /api/reference/topics ─────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/reference/topics',
  tags: ['Reference'],
  summary: 'List all topics',
  description: 'Returns all topics ordered by book name then orderIndex. Cached for 1 hour.',
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

// ── POST /api/contact ─────────────────────────────────────────────────────────

registry.register('ContactRequest', ContactSchema);

const ContactResponseSchema = z
  .object({
    id: z.uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
    name: z.string().openapi({ example: 'ישראל ישראלי' }),
    email: z.email().openapi({ example: 'israel@example.com' }),
    category: z.enum(['general', 'bug', 'collaboration']).openapi({ example: 'general' }),
    subject: z.string().openapi({ example: 'שאלה לגבי תכנים' }),
    message: z.string().openapi({ example: 'שלום, אני רוצה לשאול...' }),
    pageUrl: z.string().nullable().openapi({ example: null }),
    createdAt: z.iso.datetime().openapi({ example: '2024-01-15T10:30:00.000Z' }),
  })
  .openapi('ContactResponse');

registry.registerPath({
  method: 'post',
  path: '/api/contact',
  tags: ['Contact'],
  summary: 'Submit a contact form',
  description: 'Saves the message to the database and sends a notification email to the site owner.',
  security: [{ ApiSecretAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        'application/json': { schema: ContactSchema },
      },
    },
  },
  responses: {
    201: {
      description: 'Message received and email sent',
      content: {
        'application/json': { schema: StandardSuccessSchema(ContactResponseSchema) },
      },
    },
    401: {
      description: 'Missing or invalid x-api-secret header',
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
