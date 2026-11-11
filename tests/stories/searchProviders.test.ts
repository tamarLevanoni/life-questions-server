import { EMBEDDING_DIMENSIONS, embedSearchInputs, rerankSearch } from '../../src/lib/search-ai';

const geminiKey = process.env.GEMINI_API_KEY;
const cohereKey = process.env.COHERE_API_KEY;
const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index === 0 ? 1 : 0);

afterEach(() => {
  if (geminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = geminiKey;
  if (cohereKey === undefined) delete process.env.COHERE_API_KEY;
  else process.env.COHERE_API_KEY = cohereKey;
  jest.restoreAllMocks();
});

it('requests one Gemini embedding per document and includes the retrieval prefix for a query', async () => {
  process.env.GEMINI_API_KEY = 'test-gemini';
  const fetchMock = jest.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ embeddings: [{ values: vector }, { values: vector }] }))
    .mockResolvedValueOnce(Response.json({ embeddings: [{ values: vector }] }));

  await expect(embedSearchInputs('gemini-embedding-2', ['מעשה אחד', 'מעשה שני'], 'document'))
    .resolves.toEqual({ vectors: [vector, vector], inputTokens: null });
  await embedSearchInputs('gemini-embedding-2', ['שומר שמסר לשומר'], 'query');

  const bodies = fetchMock.mock.calls.map(([, request]) => JSON.parse(String(request?.body)));
  expect(bodies[0].requests.map(({ content }: { content: { parts: { text: string }[] } }) => content.parts[0].text))
    .toEqual(['title: none | text: מעשה אחד', 'title: none | text: מעשה שני']);
  expect(bodies[1].requests[0]).toMatchObject({
    model: 'models/gemini-embedding-2',
    content: { parts: [{ text: 'task: search result | query: שומר שמסר לשומר' }] },
    outputDimensionality: EMBEDDING_DIMENSIONS,
  });
});

it('rejects missing or duplicated Cohere results instead of ranking the wrong stories', async () => {
  process.env.COHERE_API_KEY = 'test-cohere';
  const fetchMock = jest.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ results: [
      { index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.1 },
    ] }))
    .mockResolvedValueOnce(Response.json({ results: [
      { index: 0, relevance_score: 0.9 }, { index: 0, relevance_score: 0.1 },
    ] }));

  await expect(rerankSearch('שאלה', ['סיפור א', 'סיפור ב']))
    .resolves.toEqual([{ index: 1, score: 0.9 }, { index: 0, score: 0.1 }]);
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
    model: 'rerank-v5.0-fast', query: 'שאלה', top_n: 2,
  });
  await expect(rerankSearch('שאלה', ['סיפור א', 'סיפור ב']))
    .rejects.toThrow('Invalid Cohere rerank response');
});
