import OpenAI from 'openai';

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

export async function expandQuery(query: string): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: `אתה עוזר לחיפוש בספרי הלכה. קיבלת שאילתת חיפוש קצרה בעברית. הרחב אותה ל-1-2 משפטים קצרים הכוללים מונחים הלכתיים קרובים, נרדפים, והקשרים רלוונטיים. החזר רק את הטקסט המורחב, ללא הסבר.\nInput: ${query}`,
        },
      ],
      max_tokens: 150,
      temperature: 0.3,
    });
    return response.choices[0]?.message?.content?.trim() || query;
  } catch {
    return query;
  }
}

export async function embedText(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}
