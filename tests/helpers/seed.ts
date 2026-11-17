import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../src/lib/prisma';

// Single atomic TRUNCATE avoids FK violations when test files run in parallel.
// CASCADE handles: story_to_shu, story_to_shas, shu_simanim, shas_pages.
export async function cleanDb() {
  await prisma.$executeRaw`TRUNCATE TABLE stories, topics, books, masechtot, shu_sections CASCADE`;
}

export async function seedBook(
  name?: string,
  overrides: Partial<{ orderIndex: number; coverUrl: string | null }> = {}
) {
  return prisma.book.create({
    data: {
      name: name ?? `book-${randomUUID()}`,
      orderIndex: overrides.orderIndex ?? 1,
      coverUrl: overrides.coverUrl,
    },
  });
}

export async function seedTopic(overrides: Partial<{ bookId: string; name: string; orderIndex: number }> = {}) {
  const bookId = overrides.bookId ?? (await seedBook()).id;
  return prisma.topic.create({
    data: {
      bookId,
      name: overrides.name ?? `topic-${randomUUID()}`,
      orderIndex: overrides.orderIndex ?? 1,
    },
  });
}

export async function seedStory(topicId: string, overrides: Partial<Prisma.StoryUncheckedCreateInput> = {}) {
  const bookId = overrides.bookId ?? (await prisma.topic.findUniqueOrThrow({ where: { id: topicId } })).bookId;
  return prisma.story.create({
    data: {
      storyOrder: Math.floor(Math.random() * 100000),
      topicId,
      title: `test-title-${randomUUID()}`,
      storyBody: `test-body-${randomUUID()}`,
      legalQuestion: 'האם חייב?',
      legalQuestionSource: 'בבא קמא ז.',
      shortAnswer: 'חייב',
      ...overrides,
      bookId,
    },
  });
}

export async function seedMasechet(overrides: Partial<{ name: string; orderIndex: number }> = {}) {
  return prisma.masechet.create({
    data: {
      name: overrides.name ?? `masechet-${randomUUID()}`,
      orderIndex: overrides.orderIndex ?? 1,
    },
  });
}

export async function seedShasPage(masechetId: string, daf = 5, amud = 'a') {
  return prisma.shasPage.create({ data: { masechetId, daf, amud } });
}

export async function seedShuSection(name?: string) {
  return prisma.shuSection.create({ data: { name: name ?? `section-${randomUUID()}` } });
}

export async function seedShuSiman(sectionId: string, siman = 1, title?: string) {
  return prisma.shuSiman.create({ data: { sectionId, siman, title: title ?? null } });
}

export async function linkStoryToShas(storyId: string, shasPageId: string) {
  return prisma.storyToShas.create({ data: { storyId, shasPageId } });
}

export async function linkStoryToShu(storyId: string, shuSimanId: string, seif = 1) {
  return prisma.storyToShu.create({ data: { storyId, shuSimanId, seif } });
}
