import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const RecommendationSchema = z
  .object({
    name: z.string().openapi({ example: 'ספר ברכת שלמה' }),
    url: z.string().openapi({ example: 'https://res.cloudinary.com/demo/image/upload/recommendations/book.jpg' }),
  })
  .openapi('Recommendation');
