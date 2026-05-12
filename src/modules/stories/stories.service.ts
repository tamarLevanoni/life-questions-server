import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { embedText } from '../../lib/openai';
import { NotFoundError } from '../../types';
import { SearchStoriesInput } from './stories.validators';

const storyInclude = {
  topic: true,
  shuRefs: {
    include: {
      shuSiman: {
        include: { section: true },
      },
    },
  },
  shasRefs: {
    include: {
      shasPage: {
        include: { masechet: true },
      },
    },
  },
} satisfies Prisma.StoryInclude;

export async function searchStories(params: SearchStoriesInput) {
  const { q, masechetId, daf, amud, shuSectionId, simanId, seif, concept, page, limit } = params;
  const skip = (page - 1) * limit;

  // Build base Prisma where clause
  const where: Prisma.StoryWhereInput = {};

  // Shas filters
  if (masechetId || daf !== undefined || amud) {
    where.shasRefs = {
      some: {
        shasPage: {
          ...(masechetId ? { masechetId } : {}),
          ...(daf !== undefined ? { daf } : {}),
          ...(amud ? { amud } : {}),
        },
      },
    };
  }

  // Shu filters
  if (shuSectionId || simanId) {
    where.shuRefs = {
      some: {
        ...(simanId ? { shuSimanId: simanId } : {}),
        ...(seif !== undefined ? { seif } : {}),
        ...(shuSectionId && !simanId
          ? { shuSiman: { sectionId: shuSectionId } }
          : {}),
      },
    };
  } else if (seif !== undefined) {
    where.shuRefs = { some: { seif } };
  }

  // Concept filter
  if (concept) {
    where.OR = [
      { conceptsAi: { has: concept } },
      { conceptsFromIndex: { has: concept } },
    ];
  }

  // Vector search path
  if (q) {
    let candidateIds: string[] | null = null;

    try {
      const vector = await embedText(q);
      const vectorLiteral = `[${vector.join(',')}]`;

      const rows = await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`
          SELECT id FROM stories
          WHERE embedding IS NOT NULL
          ORDER BY embedding <-> ${vectorLiteral}::vector
          LIMIT 200
        `
      );
      candidateIds = rows.map((r) => r.id);
    } catch {
      // Fallback to text search if embedding fails (e.g. no OPENAI_API_KEY in tests)
    }

    if (candidateIds && candidateIds.length > 0) {
      where.id = { in: candidateIds };

      const [stories, total] = await Promise.all([
        prisma.story.findMany({ where, include: storyInclude, skip, take: limit }),
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
    prisma.story.findMany({ where, include: storyInclude, skip, take: limit, orderBy: [{ bookNumber: 'asc' }, { storyOrder: 'asc' }] }),
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

  return story;
}

export async function getStoryNeighbors(id: string) {
  const story = await prisma.story.findUnique({
    where: { id },
    select: { bookNumber: true, storyOrder: true },
  });

  if (!story) throw new NotFoundError('Story');

  const [prev, next] = await Promise.all([
    prisma.story.findFirst({
      where: { bookNumber: story.bookNumber, storyOrder: { lt: story.storyOrder } },
      orderBy: { storyOrder: 'desc' },
      select: { id: true, title: true },
    }),
    prisma.story.findFirst({
      where: { bookNumber: story.bookNumber, storyOrder: { gt: story.storyOrder } },
      orderBy: { storyOrder: 'asc' },
      select: { id: true, title: true },
    }),
  ]);

  return { prev: prev ?? null, next: next ?? null };
}
