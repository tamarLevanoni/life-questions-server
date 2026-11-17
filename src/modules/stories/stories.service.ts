import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { NotFoundError } from '../../types';
import { storyInclude, storyDetailOmit } from './stories.queries';

/** טוען מזהים בסדר קבוע ומבקש רשומה נוספת כדי לקבוע אם יש עוד עמוד. */
export async function listSitemapStories(page: number, limit: number) {
  const rows = await prisma.story.findMany({
    select: { id: true },
    skip: (page - 1) * limit,
    take: limit + 1,
    orderBy: [{ bookId: 'asc' }, { storyOrder: 'asc' }, { id: 'asc' }],
  });
  return { stories: rows.slice(0, limit), hasMore: rows.length > limit };
}

/** בוחר דוגמאות אקראיות תוך העדפת סיפורים עם תמונה, ומחזיר את התוכן הציבורי שלהן. */
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

/** מפריד בין סימון שקיימת הרחבה לבין שליחת הטקסט שלה לקורא מורשה. */
function withExpansionAccess<T extends { expansion: string | null }>(story: T, canReadExpansion: boolean) {
  return {
    ...story,
    expansion: canReadExpansion ? story.expansion : null,
    hasExpansion: Boolean(story.expansion?.trim()),
  };
}

/** טוען סיפור ומקורות, מוצא את שני שכניו באותו ספר ובודק אם הקורא יכול לקבל את ההרחבה. */
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
