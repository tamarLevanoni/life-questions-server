import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const contactCategoryEnum = z.enum(['general', 'bug', 'collaboration', 'story_question']);

export const ContactSchema = z
  .object({
    name:     z.string().min(2, 'שם חייב להכיל לפחות 2 תווים').openapi({ example: 'ישראל ישראלי' }),
    email:    z.email('אימייל לא תקין').openapi({ example: 'israel@example.com' }),
    category: contactCategoryEnum.openapi({ example: 'general' }),
    subject:  z.string().min(3, 'נושא חייב להכיל לפחות 3 תווים').openapi({ example: 'שאלה לגבי תכנים' }),
    message:  z.string().min(10, 'ההודעה חייבת להכיל לפחות 10 תווים').openapi({ example: 'שלום, אני רוצה לשאול...' }),
    pageUrl:  z.string().optional().openapi({ example: 'https://life-questions.app/stories/123' }),

    // רלוונטי רק ל-story_question
    story: z.object({
      id:            z.uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
      title:         z.string().openapi({ example: 'סיפור על שבת' }),
      storyBody:     z.string().openapi({ example: 'היה היה...' }),
      legalQuestion: z.string().openapi({ example: 'האם מותר...' }),
      shortAnswer:   z.string().openapi({ example: 'מותר משום...' }),
      expansion:     z.string().optional().openapi({ example: 'בהרחבה...' }),
    }).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.category === 'story_question' && !data.story) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['story'], message: 'story הוא שדה חובה עבור קטגוריית story_question' });
    }
  })
  .openapi('ContactRequest');

export type ContactInput = z.infer<typeof ContactSchema>;
