import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { embedText } from '../../lib/openai';
import { NotFoundError } from '../../types';
import { SearchStoriesInput } from './stories.validators';
import { storyInclude, storyCardInclude, storyCardOmit } from './stories.queries';

export async function searchStories(params: SearchStoriesInput) {
  const { q, topicIds, bookIds, shasRefs, shuRefs, concepts, page, limit } = params;
  const skip = (page - 1) * limit;

  const where: Prisma.StoryWhereInput = {};

  if (topicIds && topicIds.length > 0) where.topicId = { in: topicIds };
  if (bookIds && bookIds.length > 0) where.bookId = { in: bookIds };

  // Shas filters — story must have at least one ref matching any of the filter objects
  if (shasRefs && shasRefs.length > 0) {
    where.shasRefs = {
      some: {
        OR: shasRefs.map((ref) => ({
          shasPage: {
            masechetId: ref.masechetId,
            ...(ref.daf !== undefined ? { daf: ref.daf } : {}),
          },
        })),
      },
    };
  }

  // Shu filters — story must have at least one ref matching any of the filter objects
  if (shuRefs && shuRefs.length > 0) {
    where.shuRefs = {
      some: {
        OR: shuRefs.map((ref) => ({
          ...(ref.simanId ? { shuSimanId: ref.simanId } : { shuSiman: { sectionId: ref.shuSectionId } }),
          ...(ref.seif !== undefined ? { seif: ref.seif } : {}),
        })),
      },
    };
  }

  // Concepts filter — story must match at least one concept from the list
  if (concepts && concepts.length > 0) {
    where.OR = concepts.flatMap((c) => [
      { conceptsAi: { has: c } },
      { conceptsFromIndex: { has: c } },
    ]);
  }

  // Vector search path
  if (q) {
    let candidateIds: string[] | null = null;

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

      // 3. Merge: keyword hits always pass; threshold filters only pure-semantic results
      const keywordSet = new Set(keywordRows.map((r) => r.id));
      const SEMANTIC_THRESHOLD = 0.6;
      const scored = semanticRows
        .filter((r) => keywordSet.has(r.id) || r.distance <= SEMANTIC_THRESHOLD)
        .map((r) => ({
          id: r.id,
          score: r.distance - (keywordSet.has(r.id) ? 0.25 : 0),
        }));

      // 4. Add pure keyword matches not in semantic results
      const semanticIds = new Set(semanticRows.map((r) => r.id));
      for (const r of keywordRows) {
        if (!semanticIds.has(r.id)) scored.push({ id: r.id, score: 0.1 });
      }

      scored.sort((a, b) => a.score - b.score);
      candidateIds = scored.map((r) => r.id);
    } catch {
      // Fallback to text search if embedding fails (e.g. no OPENAI_API_KEY in tests)
    }

    if (candidateIds && candidateIds.length > 0) {
      where.id = { in: candidateIds };

      const [stories, total] = await Promise.all([
        prisma.story.findMany({ where, omit: storyCardOmit, include: storyCardInclude, skip, take: limit }),
        prisma.story.count({ where }),
      ]);

      // Re-sort by vector order
      const idOrder = new Map(candidateIds.map((id, i) => [id, i]));
      stories.sort((a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999));

      return { stories, total, page, limit };
    }

    // Text fallback
    const textCondition: Prisma.StoryWhereInput = {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { storyBody: { contains: q, mode: 'insensitive' } },
      ],
    };
    where.AND = [textCondition];
  }

  const [stories, total] = await Promise.all([
    prisma.story.findMany({ where, omit: storyCardOmit, include: storyCardInclude, skip, take: limit, orderBy: [{ bookId: 'asc' }, { storyOrder: 'asc' }] }),
    prisma.story.count({ where }),
  ]);

  return { stories, total, page, limit };
}

export async function getStoryById(id: string) {
  const story = await prisma.story.findUnique({
    where: { id },
    include: storyInclude,
  });

  if (!story) throw new NotFoundError('Story');

  const [prev, next] = await Promise.all([
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
  ]);

  return { ...story, neighbors: { prev: prev ?? null, next: next ?? null } };
}
