import OpenAI from 'openai';

let client: OpenAI | undefined;

/** יוצר לקוח OpenAI משותף בעת השימוש הראשון ומכבה ניסיונות חוזרים אוטומטיים. */
export function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
  client ??= new OpenAI({ apiKey, maxRetries: 0, timeout: 10_000 });
  return client;
}
