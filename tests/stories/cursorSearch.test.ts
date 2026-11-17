import request from 'supertest';
import type { Prisma } from '@prisma/client';
import { app } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import contract from '../../src/modules/stories/search-index-contract.json';
import { embedSearchInputs, rewriteSearchQuery } from '../../src/lib/search-ai';
import { parseSourceSearch } from '../../src/modules/stories/source-reference-parser';

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    story: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
    $disconnect: jest.fn(),
  },
}));
jest.mock('../../src/lib/search-ai', () => ({
  ...jest.requireActual('../../src/lib/search-ai'),
  embedSearchInputs: jest.fn(),
  rewriteSearchQuery: jest.fn(),
}));

const matching = prisma.story.findMany as jest.Mock;
const raw = prisma.$queryRaw as jest.Mock;
const embed = jest.mocked(embedSearchInputs);
const queryVector = [1, ...Array<number>(contract.embeddingDimensions - 1).fill(0)];
const secret = process.env.API_SECRET ?? 'test-secret';
const account = 'a'.repeat(64);
const section = { id: 'section', kind: 'shu' as const, name: 'חושן משפט' };
const tractate = { id: 'tractate', kind: 'shas' as const, name: 'ברכות' };
const namedTractate = { id: 'bava-kamma', kind: 'shas' as const, name: 'בבא קמא' };
// מאפשר לבצע באותה צורה חיפוש והמשך, עם אפשרות להחליף חשבון כדי לבדוק בידוד.
const search = (body: Record<string, unknown>, owner = account) => request(app)
  .post('/api/stories/search').set('x-api-secret', secret).set('x-search-account', owner)
  .send(body);

const cards = Array.from({ length: 135 }, (_, index) => ({
  id: `story-${index}`, storyOrder: index, title: `Story ${index}`,
  bookId: 'book', topicId: 'topic', legalQuestion: 'Question', videoUrl: null, shuRefs: [], centralShuSiman: null,
  topic: { name: 'הלכות אבידה ומציאה' }, book: { name: 'Example collection' },
}));

beforeEach(() => {
  embed.mockReset().mockResolvedValue({ vectors: [queryVector], inputTokens: 7 });
  jest.mocked(rewriteSearchQuery).mockReset().mockResolvedValue(null);
  raw.mockReset().mockImplementation((query: Prisma.Sql | TemplateStringsArray) => {
    const text = 'sql' in query ? query.sql : query.join('');
    if (text.includes('FROM masechtot')) return [section, tractate, namedTractate];
    if (text.includes('FROM story_to_shas')) return [
      { id: cards[0].id, number: 19, subdivision: 2 },
      { id: cards[1].id, number: 118, subdivision: 1 },
    ];
    if (text.includes('FROM story_to_shu')) return [
      { id: cards[0].id, number: 259, subdivision: 1 },
      { id: cards[1].id, number: 260, subdivision: 1 },
    ];
    if ('sql' in query && text.includes('WITH catalog AS') && query.values.includes('הלכות אבידה ומציאה')) {
      return cards.map(({ id }) => ({ id, strength: 3, exactRank: 2 }));
    }
    return [];
  });
  matching.mockReset().mockImplementation(({ where, orderBy }: { where?: { id?: { in: string[] } }; orderBy?: unknown }) => {
    if (!where?.id) return cards;
    const ids = where.id.in;
    // Prisma may return rows in any order unless the query adds ORDER BY.
    const rows = cards.filter(({ id }) => ids.includes(id));
    return orderBy ? rows : rows.reverse();
  });
});

it('paginates a catalog query beyond 50 stories, with only card reads on continuation', async () => {
  const result = await search({ q: 'השבת אבידה' }).expect(200);
  expect(result.headers['cache-control']).toBe('private, no-store');
  expect(result.body.data.total).toBe(135);
  expect(result.body.data.stories.map(({ id }: { id: string }) => id)).toEqual(cards.slice(0, 10).map(({ id }) => id));
  raw.mockClear();
  matching.mockClear();
  const initialCursor = result.body.data.nextCursor;
  let cursor = initialCursor;
  const ids = result.body.data.stories.map(({ id }: { id: string }) => id);
  while (cursor) {
    const page = await search({ cursor }).expect(200);
    ids.push(...page.body.data.stories.map(({ id }: { id: string }) => id));
    cursor = page.body.data.nextCursor;
  }
  expect(ids).toEqual(cards.map(({ id }) => id));
  const replay = await search({ cursor: initialCursor }).expect(200);
  expect(replay.body.data.stories.map(({ id }: { id: string }) => id)).toEqual(ids.slice(10, 20));
  expect(matching).toHaveBeenCalledTimes(14);
  expect(matching.mock.calls.every(([args]) => args.where.id.in.length <= 10 && args.omit.expansion)).toBe(true);
  expect(raw).not.toHaveBeenCalled();
  expect(embedSearchInputs).not.toHaveBeenCalled();
});

it('keeps all exact topic matches when the query also includes a source', async () => {
  const result = await search({ q: 'חו״מ רנט סעיף א — השבת אבידה' }).expect(200);
  expect(result.body.data).toMatchObject({
    total: cards.length,
    nextCursor: { offset: 10 },
    searchMeta: { sourceMatch: 'exact', matches: { [cards[0].id]: { reasonCode: 'source_match' } } },
  });
  expect(embedSearchInputs).not.toHaveBeenCalled();
});

it.each([
  { q: 'מצאתי ארנק ברחוב מה עושים', titleMatch: false },
  { q: 'סיפורים עם אותה כותרת', titleMatch: true },
])('returns ten cards per load in a new search: $q', async ({ q, titleMatch }) => {
  const matches = cards.slice(0, 24);
  const originalQuery = raw.getMockImplementation()!;
  raw.mockImplementation((query: Prisma.Sql | TemplateStringsArray) => {
    if ('sql' in query && titleMatch && query.sql.includes('WITH catalog AS')) {
      return matches.map(({ id }) => ({ id, strength: 4, exactRank: 1 }));
    }
    if ('sql' in query && !titleMatch && query.sql.includes('d.search_vector @@ q.any_words')) {
      return matches.map(({ id }) => ({ id, kind: 'scenario', part: 0, score: 1 }));
    }
    return originalQuery(query);
  });

  const first = await search({ q }).expect(200);
  expect(first.body.data).toMatchObject({ pageSize: 10, total: 24, nextCursor: { offset: 10 } });
  expect(first.body.data.stories.map(({ id }: { id: string }) => id)).toEqual(matches.slice(0, 10).map(({ id }) => id));

  const next = await search({ cursor: first.body.data.nextCursor }).expect(200);
  expect(next.body.data).toMatchObject({ pageSize: 10, total: 24, nextCursor: { offset: 20 } });
  expect(next.body.data.stories.map(({ id }: { id: string }) => id)).toEqual(matches.slice(10, 20).map(({ id }) => id));
});

it('validates account ownership, page boundaries, request shape and expiry', async () => {
  const first = await search({ bookIds: ['f7f40e48-65f0-4282-bb45-b1320ea3cc2e'] }).expect(200);
  const cursor = first.body.data.nextCursor;
  await search({ cursor }, 'b'.repeat(64)).expect(404);
  await search({ cursor: { ...cursor, offset: 5 } }).expect(422);
  await search({ cursor, q: 'מקרה בדיקה' }).expect(422);
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60 * 1000);
  try {
    const expired = await search({ cursor }).expect(410);
    expect(expired.body.error).toBe('search_expired');
  } finally {
    clock.mockRestore();
  }
});

it('chooses exact evidence, then the whole location, then neighboring locations', async () => {
  const exact = await search({ q: 'חו״מ רנט, א' }).expect(200);
  expect(exact.body.data.searchMeta.sourceMatch).toBe('exact');
  expect(exact.body.data.stories.map(({ id }: { id: string }) => id)).toEqual([cards[0].id]);
  const parent = await search({ q: 'חו״מ רנט סעיף ב' }).expect(200);
  expect(parent.body.data.searchMeta.sourceMatch).toBe('same_location');
  expect(parent.body.data.searchMeta.matches[cards[0].id].reasonCode).toBe('nearby_source');
  const neighbor = await search({ q: 'חו״מ סימן רנ״ח' }).expect(200);
  expect(neighbor.body.data.searchMeta.sourceMatch).toBe('nearby');
  expect(neighbor.body.data.stories.map(({ id }: { id: string }) => id)).toEqual([cards[0].id]);
  expect(embedSearchInputs).not.toHaveBeenCalled();
});

it('does not use the eight-second performance target to cancel source expansion', async () => {
  const createTimeout = AbortSignal.timeout.bind(AbortSignal);
  const timeout = jest.spyOn(AbortSignal, 'timeout').mockImplementation(
    (milliseconds) => milliseconds === 8000 ? AbortSignal.abort() : createTimeout(milliseconds),
  );
  try {
    const result = await search({ q: 'חו״מ סימן רנ״ח' }).expect(200);
    expect(result.body.data.searchMeta).toMatchObject({ status: 'complete', sourceMatch: 'nearby' });
    expect(result.body.data.stories.map(({ id }: { id: string }) => id)).toEqual([cards[0].id]);
  } finally {
    timeout.mockRestore();
  }
});

it.each([
  { mode: 'without filters', filters: {}, allowedIds: [] },
  { mode: 'within a selected book', filters: { bookIds: ['f7f40e48-65f0-4282-bb45-b1320ea3cc2e'] }, allowedIds: [cards[0].id] },
])('searches the story index and only sends story IDs when restricted ($mode)', async ({ filters, allowedIds }) => {
  if (allowedIds.length) matching.mockResolvedValueOnce([cards[0]]);
  const originalQuery = raw.getMockImplementation()!;
  raw.mockImplementation((query: Prisma.Sql | TemplateStringsArray) => {
    if ('sql' in query && query.sql.includes('d.embedding <=>')) {
      expect(query.values).toContain(contract.indexId);
      expect(query.values).toContain(contract.embeddingModel);
      return [{ id: cards[0].id, kind: 'scenario', part: 0, distance: 0.1 }];
    }
    return originalQuery(query);
  });
  const q = 'מצאתי ארנק ברחוב';
  const result = await search({ q, ...filters }).expect(200);
  const retrievalQueries: Prisma.Sql[] = raw.mock.calls
    .map(([query]) => query)
    .filter((query) => 'sql' in query && /WITH catalog AS|d\.search_vector @@ q\.any_words|d\.embedding <=>/.test(query.sql));
  expect(retrievalQueries).toHaveLength(3);
  for (const { sql, values } of retrievalQueries) {
    expect(/\b(?:s\.id|d\.story_id) IN \(/.test(sql)).toBe(allowedIds.length > 0);
    expect(values.filter((value) => typeof value === 'string' && /^story-\d+$/.test(value))).toEqual(allowedIds);
  }
  expect(embed).toHaveBeenCalledWith([q], expect.any(AbortSignal));
  expect(result.body.data.stories.map(({ id }: { id: string }) => id)).toEqual([cards[0].id]);
  expect(result.body.data.searchMeta.status).toBe('complete');
});

it.each(['מצאתי ארנק ברחוב', 'דף ל׳', 'ברכות דף ל'])('returns no results before parsing when filters leave no stories (%s)', async (q) => {
  matching.mockResolvedValueOnce([]);
  const result = await search({ q, bookIds: ['f7f40e48-65f0-4282-bb45-b1320ea3cc2e'] }).expect(200);
  expect(result.body.data).toMatchObject({ stories: [], total: 0, searchMeta: { status: 'no_useful_match' } });
  expect(raw).not.toHaveBeenCalled();
  expect(embed).not.toHaveBeenCalled();
});

it('keeps lexical order when a result has a vector match beyond the distance threshold', async () => {
  const originalQuery = raw.getMockImplementation()!;
  raw.mockImplementation((query: Prisma.Sql | TemplateStringsArray) => {
    if ('sql' in query && query.sql.includes('d.search_vector @@ q.any_words')) {
      return [
        { id: cards[0].id, kind: 'scenario', part: 0, score: 2 },
        { id: cards[1].id, kind: 'scenario', part: 0, score: 1 },
      ];
    }
    if ('sql' in query && query.sql.includes('d.embedding <=>')) {
      return [{ id: cards[1].id, kind: 'scenario', part: 0, distance: 0.61 }];
    }
    return originalQuery(query);
  });

  const result = await search({ q: 'מצאתי ארנק ברחוב' }).expect(200);
  expect(result.body.data.stories.map(({ id }: { id: string }) => id)).toEqual([cards[0].id, cards[1].id]);
});

it('uses a rewrite to find extra candidates after a sparse search', async () => {
  const q = 'מצאתי ארנק ברחוב';
  const rewrite = 'מצאתי ארנק ברחוב השבת אבידה';
  jest.mocked(rewriteSearchQuery).mockResolvedValueOnce(rewrite);
  const originalQuery = raw.getMockImplementation()!;
  raw.mockImplementation((query: Prisma.Sql | TemplateStringsArray) => {
    if ('sql' in query && query.sql.includes('d.search_vector @@ q.any_words')) {
      return query.values.includes('מצאתי ארנק ברחוב השבת אבידה')
        ? [{ id: cards[1].id, kind: 'scenario', part: 0, score: 1 }]
        : [{ id: cards[0].id, kind: 'scenario', part: 0, score: 1 }];
    }
    return originalQuery(query);
  });

  const result = await search({ q }).expect(200);
  expect(rewriteSearchQuery).toHaveBeenCalledTimes(1);
  expect(embed.mock.calls.map(([inputs]) => inputs)).toEqual([[q], [rewrite]]);
  expect(result.body.data.stories.map(({ id }: { id: string }) => id)).toEqual([cards[0].id, cards[1].id]);
});

it('combines source and content matches once, respecting filters and source labels', async () => {
  const [sourceOnly, outsideFilter, contentOnly, both] = cards;
  matching.mockResolvedValueOnce([sourceOnly, contentOnly, both]);
  const originalQuery = raw.getMockImplementation()!;
  raw.mockImplementation((query: Prisma.Sql | TemplateStringsArray) => {
    if ('sql' in query && query.sql.includes('d.search_vector @@ q.any_words')) {
      expect(query.values).toEqual(expect.arrayContaining([sourceOnly.id, contentOnly.id, both.id]));
      expect(query.values).not.toContain(outsideFilter.id);
      return [contentOnly, both].map(({ id }) => ({ id, kind: 'scenario', part: 0, score: 1 }));
    }
    if ('sql' in query && query.sql.includes('FROM story_to_shu')) {
      return [sourceOnly, outsideFilter, both].map(({ id }) => ({ id, number: 259, subdivision: 1 }));
    }
    return originalQuery(query);
  });

  const bookId = 'f7f40e48-65f0-4282-bb45-b1320ea3cc2e';
  const result = await search({ q: 'חו״מ רנט סעיף א — החזרת חפץ', bookIds: [bookId] }).expect(200);
  expect(matching.mock.invocationCallOrder[0]).toBeLessThan(raw.mock.invocationCallOrder[0]);
  expect(matching.mock.calls[0][0].select).toEqual({ id: true });
  const sourceSearchCall = raw.mock.calls.findIndex(([query]) => query.sql?.includes('FROM story_to_shu'));
  expect(raw.mock.invocationCallOrder[sourceSearchCall]).toBeGreaterThan(matching.mock.invocationCallOrder[0]);
  expect(result.body.data.stories.map(({ id }: { id: string }) => id))
    .toEqual([both.id, sourceOnly.id, contentOnly.id]);
  expect(result.body.data.searchMeta.matches).toEqual({
    [both.id]: { matchType: 'direct', reasonCode: 'source_match' },
    [sourceOnly.id]: { matchType: 'direct', reasonCode: 'source_match' },
  });
  expect(embed).toHaveBeenCalledTimes(1);
  expect(embed.mock.calls[0][0][0]).toContain('החזרת חפץ');
  expect(embed.mock.calls[0][0][0]).not.toContain('רנט');
});

it('keeps source and lexical matches during an embedding outage', async () => {
  embed.mockRejectedValue(new Error('Embedding provider unavailable'));
  const originalQuery = raw.getMockImplementation()!;
  raw.mockImplementation((query: Prisma.Sql | TemplateStringsArray) => {
    if ('sql' in query && query.sql.includes('d.search_vector @@ q.any_words')) {
      return [{ id: cards[2].id, kind: 'scenario', part: 0, score: 1 }];
    }
    return originalQuery(query);
  });

  const result = await search({ q: 'חו״מ סימן רנ״ח — החזרת חפץ' }).expect(200);
  expect(result.body.data.searchMeta).toMatchObject({ status: 'partial', sourceMatch: 'nearby' });
  expect(result.body.data.stories.map(({ id }: { id: string }) => id)).toEqual([cards[0].id, cards[2].id]);
  expect(result.body.data.searchMeta.matches[cards[0].id].reasonCode).toBe('nearby_source');
});

it('keeps UI filter groups active before source expansion', async () => {
  matching.mockResolvedValueOnce([cards[1]]);
  const topicId = '8de628de-e275-416f-b8c1-2b492ad10876';
  const bookId = 'f7f40e48-65f0-4282-bb45-b1320ea3cc2e';
  const result = await search({ q: 'חו״מ סימן רנ״ח', bookIds: [bookId], topicIds: [topicId], concepts: ['Example'] }).expect(200);
  expect(matching.mock.calls[0][0].where.AND).toEqual([
    { bookId: { in: [bookId] }, topicId: { in: [topicId] } },
    { OR: [{ conceptsAi: { has: 'Example' } }, { conceptsFromIndex: { has: 'Example' } }] },
  ]);
  expect(result.body.data).toMatchObject({ total: 0, nextCursor: null });
});

it.each([
  ['חתול בבא קמא', 'חתול'],
  ['חפץ אבוד בחושן משפט', 'חפץ אבוד'],
  ['חפץ אבוד בחו״מ', 'חפץ אבוד'],
])('boosts topical results from the named work without adding source-only stories (%s)', async (q, topic) => {
  const originalQuery = raw.getMockImplementation()!;
  raw.mockImplementation((query: Prisma.Sql | TemplateStringsArray) => {
    if ('sql' in query && query.sql.includes('d.search_vector @@ q.any_words')) {
      expect(query.values).toContain(topic);
      return [cards[2], cards[0]].map(({ id }) => ({ id, kind: 'scenario', part: 0, score: 1 }));
    }
    return originalQuery(query);
  });

  const result = await search({ q }).expect(200);
  expect(embed).toHaveBeenCalledWith([topic], expect.any(AbortSignal));
  expect(result.body.data.total).toBe(2);
  expect(result.body.data.stories.map(({ id }: { id: string }) => id)).toEqual([cards[0].id, cards[2].id]);
});

it.each(['בבא קמא', 'חושן משפט', 'חו״מ', 'מסכת ברכות'])('lists stories linked to a source-only query (%s)', async (q) => {
  const result = await search({ q }).expect(200);
  expect(result.body.data.stories.map(({ id }: { id: string }) => id)).toEqual([cards[0].id, cards[1].id]);
  expect(embed).not.toHaveBeenCalled();
});

it('keeps ambiguous words in the topic unless the query identifies a source', () => {
  expect(parseSourceSearch('ברכות לאירוע', [tractate])).toMatchObject({ works: [], remainder: 'ברכות לאירוע' });
  expect(parseSourceSearch('חתול (בבא קמא)', [namedTractate])).toMatchObject({ works: [namedTractate], remainder: 'חתול' });
});

it('parses punctuation and the customary spelling of a page, preserving work identity', () => {
  expect(parseSourceSearch('חו״מ רנט, א — מציאה', [section]).references[0]).toMatchObject({ number: 259, subdivision: 1 });
  expect(parseSourceSearch('בברכות (ל’ עמ’ ב’)', [tractate])).toMatchObject({
    references: [{ number: 30, subdivision: 2 }],
    remainder: '',
  });
  expect(parseSourceSearch('יביע אומר חלק ה אורח חיים סימן יח', [
    { ...section, name: 'אורח חיים' },
  ]).references).toEqual([]);
});

it.each(['', ' א ', '😀😀', 'א'.repeat(501), ' '.repeat(499) + 'אבד'])('rejects an out-of-range query before database access', async (q) => {
  await search({ q }).expect(422);
  expect(matching).not.toHaveBeenCalled();
  expect(raw).not.toHaveBeenCalled();
});

it('searches by text when the query is only an unqualified page number', async () => {
  const result = await search({ q: 'דף קי״א' }).expect(200);
  expect(result.body.data.searchMeta.status).toBe('no_useful_match');
  expect(result.body.data.searchMeta).not.toHaveProperty('sourceMatch');
  expect(result.body.data.stories).toEqual([]);
  expect(embedSearchInputs).toHaveBeenCalledWith(['דף קי״א'], expect.any(AbortSignal));
});

it('requires API secret and account before starting a cursor search', async () => {
  await request(app).post('/api/stories/search').set('x-search-account', account).send({}).expect(401);
  await request(app).post('/api/stories/search').set('x-api-secret', secret).send({ q: 'מראה מקום' }).expect(401);
  expect(matching).not.toHaveBeenCalled();
});

it.each([{}, { bookIds: [], topicIds: [], shuRefs: [], shasRefs: [], concepts: [] }, { q: '   ' },
  { page: 1, limit: 10 }, { q: 'בדיקה', offset: 10 }, { cursor: {} }])(
  'rejects unsupported search requests before querying the catalog: %j',
  async (body) => {
    await request(app).post('/api/stories/search')
      .set('x-api-secret', secret).set('x-search-account', account)
      .send(body).expect(422);
    expect(matching).not.toHaveBeenCalled();
    expect(raw).not.toHaveBeenCalled();
  },
);
