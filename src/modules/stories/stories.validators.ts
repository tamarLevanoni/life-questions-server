import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// ── Nested response schemas ───────────────────────────────────────────────────

export const BookSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  name: z.string().openapi({ example: 'שאלות מהחיים א' }),
  orderIndex: z.number().openapi({ example: 1 }),
  coverUrl: z.string().nullable().openapi({ example: 'https://res.cloudinary.com/dasrirtzp/image/upload/stories-app/books-images/1_cover.png' }),
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
      amud: z.enum(['א', 'ב', '']).openapi({ example: 'א' }),
    })
  ),
}).openapi('MasechetWithPages');

export const ShasPageSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  daf: z.number().openapi({ example: 5 }),
  amud: z.enum(['א', 'ב', '']).openapi({ example: 'א' }),
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

/** מגדיר מזהה וכותרת לקישור לסיפור אחר. */
export const StoryStubSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  title: z.string().openapi({ example: 'מעשה בגנב שנכנס לחצר' }),
}).openapi('StoryStub');

/** מגדיר את הסיפורים הקודם והבא באותו ספר. בקצה הספר אחד הצדדים ריק. */
export const StoryNeighborsSchema = z.object({
  prev: StoryStubSchema.nullable().openapi({ example: null }),
  next: StoryStubSchema.nullable(),
}).openapi('StoryNeighbors');

/** מגדיר את עמוד הסיפור, כולל המקורות, השכנים וזמינות ההרחבה. */
export const StoryResponseSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  bookId: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  storyOrder: z.number().openapi({ example: 5 }),
  title: z.string().openapi({ example: 'מעשה בגנב שנכנס לחצר' }),
  storyBody: z.string().openapi({ example: 'סיפור המעשה...' }),
  legalQuestion: z.string().openapi({ example: 'האם חייב לשלם?' }),
  legalQuestionSource: z.string().openapi({ example: 'בבא קמא ז.' }),
  shortAnswer: z.string().openapi({ example: 'חייב בנזק שלם' }),
  expansion: z.string().nullable().openapi({ example: 'הרחבה מפורטת...', description: 'Expansion text available to a registered reader.' }),
  hasExpansion: z.boolean().openapi({ example: true, description: 'Whether the story has expansion content.' }),
  conceptsAi: z.array(z.string()).openapi({ example: ['גנבה', 'נזיקין'] }),
  conceptsFromIndex: z.array(z.string()).openapi({ example: ['גנבה'] }),
  sourceReferencesText: z.string().nullable().openapi({ example: 'בבא קמא ז. - ח.' }),
  videoUrl: z.string().nullable().openapi({ example: null }),
  imageUrl: z.string().nullable().openapi({ example: null }),
  topic: TopicSchema,
  shasRefs: z.array(ShasRefSchema).openapi({ description: 'Shas (Talmud) page references' }),
  shuRefs: z.array(ShuRefSchema).openapi({ description: 'Shulchan Aruch siman/seif references' }),
  centralShuSiman: ShuSimanSchema.nullable().openapi({ description: 'Primary Shulchan Aruch siman for this story' }),
  createdAt: z.iso.datetime().openapi({ example: '2024-01-15T10:30:00.000Z' }),
  updatedAt: z.iso.datetime().openapi({ example: '2024-06-01T08:00:00.000Z' }),
  neighbors: StoryNeighborsSchema,
}).openapi('StoryResponse');

/** מגדיר את התצוגה המקדימה של סיפורי הבית, שמגיעה בלי נתוני ניווט. */
export const FullStorySchema = StoryResponseSchema.omit({ neighbors: true }).openapi('FullStory');

/** מגדיר את המידע המצומצם שנשלח בכרטיס תוצאת חיפוש. */
export const StoryCardSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  bookId: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  storyOrder: z.number().openapi({ example: 5 }),
  topicId: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  title: z.string().openapi({ example: 'מעשה בגנב שנכנס לחצר' }),
  legalQuestion: z.string().openapi({ example: 'האם חייב לשלם?' }),
  videoUrl: z.string().nullable().openapi({ example: null }),
  shuRefs: z.array(ShuRefSchema).openapi({ description: 'Shulchan Aruch siman/seif references' }),
  centralShuSiman: ShuSimanSchema.nullable().openapi({ description: 'Primary Shulchan Aruch siman for this story' }),
}).openapi('StoryCard');

/** מגדיר רשימת מזהים ודגל המשך עבור מפת האתר. */
export const SitemapPageSchema = z.object({
  stories: z.array(z.object({ id: z.uuid() })),
  hasMore: z.boolean(),
}).openapi('SitemapPage');

/** מגביל את מספר העמוד וגודלו בנתיב מפת האתר, שקורא ערכים ממחרוזת הכתובת. */
export const SitemapPageQuerySchema = z.strictObject({
  page: z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().max(1_000_000))
    .default(1).openapi({ type: 'integer', minimum: 1, maximum: 1_000_000, default: 1 }),
  limit: z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().max(50))
    .default(50).openapi({ type: 'integer', minimum: 1, maximum: 50, default: 50 }),
}).openapi('SitemapPageQuery');

/** מאמת בחירה בחיבור שלם או בדף מסוים בתוכו. */
export const ShasRefFilterSchema = z.object({
  masechetId: z.uuid({ error: 'masechetId must be a valid UUID' }).openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  daf: z.number().int().positive().optional().openapi({ example: 7 }),
}).openapi('ShasRefFilter');

/** מאמת בחירה בחלק או בסימן ומחייב סימן כשצוין גם סעיף. */
export const ShuRefFilterSchema = z.object({
  shuSectionId: z.uuid({ error: 'shuSectionId must be a valid UUID' }).openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  simanId: z.uuid({ error: 'simanId must be a valid UUID' }).optional().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  seif: z.number().int().positive().optional().openapi({ example: 3 }),
}).refine(
  (data) => data.seif === undefined || data.simanId !== undefined,
  { message: 'seif requires simanId', path: ['seif'] }
).openapi('ShuRefFilter');

const querySegmenter = new Intl.Segmenter('he', { granularity: 'grapheme' });
/** מגביל את המחרוזת ל־500 לפני ניקוי רווחים, ודורש אחריו לפחות שלושה תווים כפי שהם נראים למשתמש. */
const SearchQuerySchema = z.string().max(500).trim().refine((query) => {
  let length = 0;
  for (const _ of querySegmenter.segment(query)) if (++length >= 3) return true;
  return false;
}, 'Search query must contain at least three characters').openapi({
  example: 'השבת אבידה',
  description: 'At least three graphemes after trimming and at most 500 UTF-16 code units before trimming.',
});

/** בקשת פתיחה דורשת שאילתה תקינה או לפחות מסנן אחד. */
const CursorSearchStartSchema = z.strictObject({
  q: SearchQuerySchema.optional(),
  topicIds: z.array(z.uuid({ error: 'each topicId must be a valid UUID' })).optional().openapi({ example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'] }),
  bookIds: z.array(z.uuid({ error: 'each bookId must be a valid UUID' })).optional().openapi({ example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'] }),
  shasRefs: z.array(ShasRefFilterSchema).optional().openapi({ description: 'Filter by Shas references — story must match at least one entry' }),
  shuRefs: z.array(ShuRefFilterSchema).optional().openapi({ description: 'Filter by Shulchan Aruch references — story must match at least one entry' }),
  concepts: z.array(z.string().trim().min(1)).optional().openapi({ example: ['ריבית', 'גנבה'] }),
}).refine(({ q, topicIds, bookIds, shasRefs, shuRefs, concepts }) =>
  Boolean(q || topicIds?.length || bookIds?.length || shasRefs?.length || shuRefs?.length || concepts?.length),
  { message: 'Search requires a query or at least one filter' },
).openapi('CursorSearchStart', { description: 'Requires a query or at least one entry in a filter array.' });

/** הסמן משלב את מזהה קבוצת התוצאות ואת מיקום תחילת העמוד הבא. */
export const SearchCursorSchema = z.strictObject({
  resultSetId: z.uuid(),
  offset: z.number().int().positive(),
}).openapi('SearchCursor');

/** בקשת המשך מקבלת רק סמן וקוראת את התוצאות של הבקשה המקורית. */
const CursorSearchContinueSchema = z.strictObject({
  cursor: SearchCursorSchema,
}).openapi('CursorSearchContinue');

export const CursorSearchSchema = z.union([CursorSearchStartSchema, CursorSearchContinueSchema])
  .openapi('CursorSearchBody');

/** מאמת את צורת מזהה החשבון שה־BFF מצרף לבקשת עימוד. */
export const SearchAccountHeadersSchema = z.object({
  'x-search-account': z.string().regex(/^[a-f0-9]{64}$/).openapi({
    description: 'Account key derived by the trusted BFF from the verified session.',
  }),
});

/** מגדיר את הסוג והסיבה שאפשר להציג עבור תוצאה. */
export const SearchMatchSchema = z.object({
  matchType: z.enum(['direct', 'close']),
  reasonCode: z.enum(['source_match', 'nearby_source']),
}).openapi('SearchMatch');

export const SEARCH_PAGE_SIZE = 10;

/** מגדיר את כרטיסי העמוד, נתוני ההתאמה והסמן שנדרש לעמוד הבא. */
export const CursorStoriesPageSchema = z.object({
  stories: z.array(StoryCardSchema),
  total: z.number().int().nonnegative(),
  pageSize: z.literal(SEARCH_PAGE_SIZE),
  nextCursor: SearchCursorSchema.nullable(),
  searchMeta: z.object({
    status: z.enum(['complete', 'no_useful_match', 'partial']),
    sourceMatch: z.enum(['exact', 'same_location', 'nearby']).optional(),
    matches: z.record(z.string(), SearchMatchSchema),
  }).openapi('SearchPageMetadata'),
}).openapi('CursorStoriesPage');

export type CursorSearchInput = z.infer<typeof CursorSearchSchema>;
export type CursorStoriesPage = z.infer<typeof CursorStoriesPageSchema>;
export type SearchCursor = z.infer<typeof SearchCursorSchema>;

export const StoryIdParamSchema = z
  .uuid({ error: 'id must be a valid UUID' })
  .openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' });

/** מזהה את הקורא הרשום שה־BFF מייצג בבקשת פרטי הסיפור. */
export const StoryReaderHeadersSchema = z.object({
  'x-story-reader-id': z.uuid().optional().openapi({
    description: 'Registered user ID derived by the BFF from its verified session.',
  }),
});

export type StoryFilters = Omit<z.infer<typeof CursorSearchStartSchema>, 'q'>;
