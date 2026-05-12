import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

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
