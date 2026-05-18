import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// ── Nested response schemas ───────────────────────────────────────────────────

export const BookSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  name: z.string().openapi({ example: 'שאלות מהחיים א' }),
}).openapi('Book');

export const MasechetSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  name: z.string().openapi({ example: 'בבא קמא' }),
  orderIndex: z.number().openapi({ example: 1 }),
}).openapi('Masechet');

export const MasechetWithPagesSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  name: z.string().openapi({ example: 'בבא קמא' }),
  orderIndex: z.number().openapi({ example: 1 }),
  pages: z.array(
    z.object({
      id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
      daf: z.number().openapi({ example: 5 }),
      amud: z.string().openapi({ example: 'a' }),
    })
  ),
}).openapi('MasechetWithPages');

export const ShasPageSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  daf: z.number().openapi({ example: 5 }),
  amud: z.string().openapi({ example: 'a' }),
  masechet: MasechetSchema,
}).openapi('ShasPage');

export const ShasRefSchema = z.object({
  shasPageId: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  sourceText: z.string().nullable().openapi({ example: 'בבא קמא ה.' }),
  shasPage: ShasPageSchema,
}).openapi('ShasRef');

export const ShuSectionSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  name: z.string().openapi({ example: 'חושן משפט' }),
}).openapi('ShuSection');

export const ShuSimanSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  siman: z.number().openapi({ example: 379 }),
  title: z.string().nullable().openapi({ example: 'דין הכונס' }),
  section: ShuSectionSchema,
}).openapi('ShuSiman');

export const ShuRefSchema = z.object({
  shuSimanId: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  seif: z.number().openapi({ example: 2 }),
  shuSiman: ShuSimanSchema,
}).openapi('ShuRef');

export const TopicSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  bookId: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  name: z.string().openapi({ example: 'נזיקין' }),
  orderIndex: z.number().openapi({ example: 1 }),
}).openapi('Topic');

export const StoryStubSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  title: z.string().openapi({ example: 'מעשה בגנב שנכנס לחצר' }),
}).openapi('StoryStub');

export const StoryNeighborsSchema = z.object({
  prev: StoryStubSchema.nullable().openapi({ example: null }),
  next: StoryStubSchema.nullable(),
}).openapi('StoryNeighbors');

export const StoryResponseSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  bookId: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
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
  shasRefs: z.array(ShasRefSchema).openapi({ description: 'Shas (Talmud) page references' }),
  shuRefs: z.array(ShuRefSchema).openapi({ description: 'Shulchan Aruch siman/seif references' }),
  createdAt: z.iso.datetime().openapi({ example: '2024-01-15T10:30:00.000Z' }),
  updatedAt: z.iso.datetime().openapi({ example: '2024-06-01T08:00:00.000Z' }),
  neighbors: StoryNeighborsSchema,
}).openapi('StoryResponse');

export const PaginatedStoriesSchema = z.object({
  stories: z.array(StoryResponseSchema),
  total: z.number().openapi({ example: 142 }),
  page: z.number().openapi({ example: 1 }),
  limit: z.number().openapi({ example: 20 }),
}).openapi('PaginatedStories');

export type StoryResponse = z.infer<typeof StoryResponseSchema>;

export const SearchStoriesSchema = z
  .object({
    q: z.string().min(1).optional().openapi({ example: 'גנבה בשבת' }),
    masechetId: z.uuid({ error: 'masechetId must be a valid UUID' }).optional().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
    daf: z.coerce.number().int().positive().optional().openapi({ example: 5 }),
    amud: z.enum(['a', 'b']).optional().openapi({ example: 'a' }),
    shuSectionId: z.uuid({ error: 'shuSectionId must be a valid UUID' }).optional().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
    simanId: z.uuid({ error: 'simanId must be a valid UUID' }).optional().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
    seif: z.coerce.number().int().positive().optional().openapi({ example: 3 }),
    concept: z.string().min(1).optional().openapi({ example: 'ריבית' }),
    page: z.coerce.number().int().positive().default(1).openapi({ example: 1 }),
    limit: z.coerce.number().int().positive().max(50).default(20).openapi({ example: 20 }),
  })
  .openapi('SearchStoriesQuery');

export const StoryIdParamSchema = z
  .uuid({ error: 'id must be a valid UUID' })
  .openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' });

export type SearchStoriesInput = z.infer<typeof SearchStoriesSchema>;
