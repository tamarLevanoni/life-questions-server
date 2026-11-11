import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { embedText } from '../../lib/openai';
import { getSearchEmbeddingModel, getSearchIndexVersion } from '../../lib/search-ai';
import { NotFoundError } from '../../types';
import { SearchStoriesInput } from './stories.validators';
import { storyInclude, storyCardInclude, storyCardOmit, storyDetailOmit } from './stories.queries';
import { searchVersionedStories, type VersionedSearchOptions } from './search-retrieval';

export async function searchStories(params: SearchStoriesInput) {
  const indexVersion = getSearchIndexVersion();
  return searchStoriesWithFilters(params, indexVersion && params.q ? {
    indexVersion,
    model: getSearchEmbeddingModel(),
    rerank: process.env.SEARCH_RERANK_ENABLED === 'true',
    rewrite: process.env.SEARCH_REWRITE_ENABLED === 'true',
    rerankMinScore: configuredScore(process.env.SEARCH_RERANK_MIN_SCORE, 1),
    maxVectorDistance: configuredScore(process.env.SEARCH_EMBEDDING_MAX_DISTANCE, 2),
  } : undefined);
}

function configuredScore(value: string | undefined, maximum: number) {
  if (!value?.trim()) return undefined;
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= maximum ? score : undefined;
}

export async function searchLegacyStories(params: SearchStoriesInput) {
  return searchStoriesWithFilters(params);
}

async function searchStoriesWithFilters(params: SearchStoriesInput, index?: VersionedSearchOptions) {
  const { q, topicIds, bookIds, shasRefs, shuRefs, concepts, page, limit } = params;
  const skip = (page - 1) * limit;

  // Each filter group below is a distinct way a story can qualify: it should
  // be returned if it matches the free-text query, OR the book+topic
  // selection, OR a shas ref, OR a shu ref, OR a concept tag — not require
  // all of them at once. Groups present are combined with OR; a single
  // active group behaves exactly as a plain AND-filter would.
  const structuralGroups: Prisma.StoryWhereInput[] = [];

  // Book+topic filter — topicId and bookId, when both given, narrow together
  // (a topic within a specific book) rather than acting as separate OR arms.
  if ((topicIds && topicIds.length > 0) || (bookIds && bookIds.length > 0)) {
    const bookTopicCondition: Prisma.StoryWhereInput = {};
    if (topicIds && topicIds.length > 0) bookTopicCondition.topicId = { in: topicIds };
    if (bookIds && bookIds.length > 0) bookTopicCondition.bookId = { in: bookIds };
    structuralGroups.push(bookTopicCondition);
  }

  // Shas filters — story must have at least one ref matching any of the filter objects
  if (shasRefs && shasRefs.length > 0) {
    structuralGroups.push({
      shasRefs: {
        some: {
          OR: shasRefs.map((ref) => ({
            shasPage: {
              masechetId: ref.masechetId,
              ...(ref.daf !== undefined ? { daf: ref.daf } : {}),
            },
          })),
        },
      },
    });
  }

  // Shu filters — story must have at least one ref matching any of the filter objects
  if (shuRefs && shuRefs.length > 0) {
    structuralGroups.push({
      shuRefs: {
        some: {
          OR: shuRefs.map((ref) => ({
            ...(ref.simanId ? { shuSimanId: ref.simanId } : { shuSiman: { sectionId: ref.shuSectionId } }),
            ...(ref.seif !== undefined ? { seif: ref.seif } : {}),
          })),
        },
      },
    });
  }

  // Concepts filter — story must match at least one concept from the list
  if (concepts && concepts.length > 0) {
    structuralGroups.push({
      OR: concepts.flatMap((c) => [
        { conceptsAi: { has: c } },
        { conceptsFromIndex: { has: c } },
      ]),
    });
  }

  // No filters at all — plain paginated listing, no per-group bookkeeping needed.
  if (structuralGroups.length === 0 && !q) {
    const [stories, total] = await Promise.all([
      prisma.story.findMany({
        where: {},
        omit: storyCardOmit,
        include: storyCardInclude,
        skip,
        take: limit,
        orderBy: [{ bookId: 'asc' }, { storyOrder: 'asc' }, { id: 'asc' }],
      }),
      prisma.story.count({}),
    ]);
    return { stories, total, page, limit };
  }

  // Resolve each active filter group to its own id set, independently of the
  // others, so a story's rank can reflect how many distinct groups it
  // satisfies (matched-in-more-groups sorts first) rather than just whether
  // it satisfies at least one.
  const [groupIdSets, indexedResults] = await Promise.all([
    Promise.all(structuralGroups.map(async (condition) => {
      const rows = await prisma.story.findMany({ where: condition, select: { id: true } });
      return new Set(rows.map((r) => r.id));
    })),
    index && q ? searchVersionedStories(q, index) : undefined,
  ]);

  // Vector rank (lower = more relevant) for the text-query group, when a
  // ranked search succeeded — used only as a tiebreaker among stories with
  // an equal match count.
  let queryRank: Map<string, number> | null = null;

  // Vector-only matches (semantically close, but no literal keyword hit) are
  // included in the results but don't count as a "matched parameter" — only
  // an exact keyword/ILIKE hit is confident enough to add to matchCount.
  const vectorOnlyIds: string[] = [];

  if (indexedResults) {
    groupIdSets.push(new Set(indexedResults.rankedIds));
    queryRank = new Map(indexedResults.rankedIds.map((id, i) => [id, i]));
  } else if (q) {
    let embeddingSucceeded = false;

    try {
      const vector = await embedText(q);
      const vectorLiteral = `[${vector.join(',')}]`;
      const keywordPattern = `%${q}%`;

      // 1. Semantic candidates (wide net, no threshold)
      const semanticRows = await prisma.$queryRaw<{ id: string; distance: number }[]>(
        Prisma.sql`
          SELECT id, (embedding <=> ${vectorLiteral}::vector) AS distance
          FROM stories
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> ${vectorLiteral}::vector
          LIMIT 200
        `
      );

      // 2. Keyword matches on all text fields + topic name
      const keywordRows = await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`
          SELECT s.id FROM stories s
          LEFT JOIN topics t ON s."topicId" = t.id
          WHERE s."searchText" ILIKE ${keywordPattern}
             OR s.title        ILIKE ${keywordPattern}
             OR t.name         ILIKE ${keywordPattern}
             OR EXISTS (SELECT 1 FROM unnest(s."conceptsAi")        c WHERE c ILIKE ${keywordPattern})
             OR EXISTS (SELECT 1 FROM unnest(s."keywordsAi")        k WHERE k ILIKE ${keywordPattern})
             OR EXISTS (SELECT 1 FROM unnest(s."conceptsFromIndex") c WHERE c ILIKE ${keywordPattern})
             OR EXISTS (SELECT 1 FROM unnest(s."keywordsFromIndex") k WHERE k ILIKE ${keywordPattern})
        `
      );

      // 3. Rank in two tiers: exact keyword matches always outrank pure-vector
      // matches, regardless of vector distance — a story that literally
      // contains the search term is a more confident match than one that's
      // merely semantically nearby. Within each tier, closer vector distance
      // (when known) still breaks ties.
      const keywordSet = new Set(keywordRows.map((r) => r.id));
      const distanceById = new Map(semanticRows.map((r) => [r.id, r.distance]));
      const SEMANTIC_THRESHOLD = 0.6;

      const keywordTier = keywordRows
        .map((r) => ({ id: r.id, distance: distanceById.get(r.id) ?? Infinity }))
        .sort((a, b) => a.distance - b.distance)
        .map((r) => r.id);

      const vectorOnlyTier = semanticRows
        .filter((r) => !keywordSet.has(r.id) && r.distance <= SEMANTIC_THRESHOLD)
        .sort((a, b) => a.distance - b.distance)
        .map((r) => r.id);

      if (keywordTier.length > 0) groupIdSets.push(new Set(keywordTier));
      vectorOnlyIds.push(...vectorOnlyTier);
      queryRank = new Map([...keywordTier, ...vectorOnlyTier].map((id, i) => [id, i]));
      embeddingSucceeded = true;
    } catch {
      // Fallback to text search if embedding fails (e.g. no OPENAI_API_KEY in tests)
    }

    if (!embeddingSucceeded) {
      // Text fallback — a literal ILIKE hit, so it counts as a group match same as keywords above.
      const textCondition: Prisma.StoryWhereInput = {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { storyBody: { contains: q, mode: 'insensitive' } },
        ],
      };
      const rows = await prisma.story.findMany({ where: textCondition, select: { id: true } });
      groupIdSets.push(new Set(rows.map((r) => r.id)));
    }
  }

  // Union of every group's ids is the full match set; each id's match count
  // is how many of those groups it appears in. Vector-only ids are folded in
  // afterward without incrementing the count, so they still surface as
  // results but never outrank an actual parameter match.
  const matchCount = new Map<string, number>();
  for (const idSet of groupIdSets) {
    for (const id of idSet) matchCount.set(id, (matchCount.get(id) ?? 0) + 1);
  }
  for (const id of vectorOnlyIds) {
    if (!matchCount.has(id)) matchCount.set(id, 0);
  }
  const unionIds = Array.from(matchCount.keys());

  if (unionIds.length === 0) return { stories: [], total: 0, page, limit };

  const allMatched = await prisma.story.findMany({
    where: { id: { in: unionIds } },
    omit: storyCardOmit,
    include: storyCardInclude,
    orderBy: [{ bookId: 'asc' }, { storyOrder: 'asc' }, { id: 'asc' }],
  });

  // The versioned index prioritizes free-text relevance. Legacy and facet-only
  // searches retain the structural-group count, followed by catalog order.
  allMatched.sort((a, b) => {
    const rankA = queryRank?.get(a.id) ?? Infinity;
    const rankB = queryRank?.get(b.id) ?? Infinity;
    if (indexedResults && rankA !== rankB) return rankA - rankB;
    const countDiff = (matchCount.get(b.id) ?? 0) - (matchCount.get(a.id) ?? 0);
    if (countDiff !== 0) return countDiff;
    return rankA === rankB ? 0 : rankA - rankB;
  });

  const total = allMatched.length;
  const stories = allMatched.slice(skip, skip + limit);

  return { stories, total, page, limit };
}

export async function getFeaturedFullStories(count: number) {
  // First, try to fill with stories that have an image
  const withImageRows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM stories WHERE "imageUrl" IS NOT NULL ORDER BY RANDOM() LIMIT ${count}`
  );
  const withImageIds = withImageRows.map((r) => r.id);

  let ids = withImageIds;

  // Fill remaining slots with stories without an image
  if (withImageIds.length < count) {
    const remaining = count - withImageIds.length;
    const withoutImageRows = await prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM stories WHERE "imageUrl" IS NULL ORDER BY RANDOM() LIMIT ${remaining}`
    );
    ids = [...withImageIds, ...withoutImageRows.map((r) => r.id)];
  }

  if (ids.length === 0) return [];

  const stories = await prisma.story.findMany({
    where: { id: { in: ids } },
    include: storyInclude,
    omit: storyDetailOmit,
  });

  const order = new Map(ids.map((id, i) => [id, i]));
  stories.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return stories.map((story) => withExpansionAccess(story, false));
}

/**
 * Returns the "story of the week": a single story that has a video.
 *
 * How it works:
 * - Only stories with a videoUrl are eligible.
 * - Eligible stories are ordered deterministically by `id` (ascending), so the
 *   Nth story in that fixed order is always the same story on every call.
 * - `weekNumber` is the number of full 7-day periods since the Unix epoch
 *   (Date.now() / 7 days, floored). It increments by exactly 1 once every
 *   7 days and is the same for every request during that week, so no
 *   "current week's pick" needs to be stored in the database.
 * - `offset = weekNumber % total` maps the current week to an index in the
 *   ordered list of eligible stories, cycling back to the start once every
 *   story has had its turn.
 */
export async function getWeeklyStory() {
  const total = await prisma.story.count({ where: { videoUrl: { not: null } } });
  if (total === 0) return null;

  const weekNumber = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const offset = weekNumber % total;

  const story = await prisma.story.findFirst({
    where: { videoUrl: { not: null } },
    orderBy: { id: 'asc' },
    skip: offset,
    include: storyInclude,
    omit: storyDetailOmit,
  });
  return story && withExpansionAccess(story, false);
}

function withExpansionAccess<T extends { expansion: string | null }>(story: T, canReadExpansion: boolean) {
  return {
    ...story,
    expansion: canReadExpansion ? story.expansion : null,
    hasExpansion: Boolean(story.expansion?.trim()),
  };
}

export async function getStoryById(id: string, readerId?: string) {
  const story = await prisma.story.findUnique({
    where: { id },
    include: storyInclude,
    omit: storyDetailOmit,
  });

  if (!story) throw new NotFoundError('Story');

  const [prev, next, reader] = await Promise.all([
    prisma.story.findFirst({
      where: { bookId: story.bookId, storyOrder: { lt: story.storyOrder } },
      orderBy: { storyOrder: 'desc' },
      select: { id: true, title: true },
    }),
    prisma.story.findFirst({
      where: { bookId: story.bookId, storyOrder: { gt: story.storyOrder } },
      orderBy: { storyOrder: 'asc' },
      select: { id: true, title: true },
    }),
    readerId
      ? prisma.user.findUnique({ where: { id: readerId }, select: { googleId: true } })
      : null,
  ]);

  return { ...withExpansionAccess(story, Boolean(reader?.googleId)), neighbors: { prev, next } };
}
