import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../src/lib/prisma';

export async function cleanDb() {
  await prisma.story.deleteMany();
  await prisma.topic.deleteMany();
  await prisma.masechet.deleteMany();
  await prisma.shuSection.deleteMany();
}

export async function seedTopic(overrides: Partial<{ bookNumber: number; name: string; orderIndex: number }> = {}) {
  return prisma.topic.create({
    data: {
      bookNumber: overrides.bookNumber ?? 1,
      name: overrides.name ?? `topic-${uuidv4()}`,
      orderIndex: overrides.orderIndex ?? 1,
    },
  });
}

export function storyData(topicId: string, overrides: Record<string, unknown> = {}) {
  return {
    bookNumber: 1,
    storyOrder: Math.floor(Math.random() * 100000),
    topicId,
    title: `test-title-${uuidv4()}`,
    storyBody: `test-body-${uuidv4()}`,
    legalQuestion: 'האם חייב?',
    legalQuestionSource: 'בבא קמא ז.',
    shortAnswer: 'חייב',
    ...overrides,
  };
}

export async function seedStory(topicId: string, overrides: Record<string, unknown> = {}) {
  return prisma.story.create({ data: storyData(topicId, overrides) });
}

export async function seedMasechet(overrides: Partial<{ name: string; orderIndex: number }> = {}) {
  return prisma.masechet.create({
    data: {
      name: overrides.name ?? `masechet-${uuidv4()}`,
      orderIndex: overrides.orderIndex ?? 1,
    },
  });
}

export async function seedShasPage(masechetId: string, daf = 5, amud = 'a') {
  return prisma.shasPage.create({ data: { masechetId, daf, amud } });
}

export async function seedShuSection(name?: string) {
  return prisma.shuSection.create({ data: { name: name ?? `section-${uuidv4()}` } });
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
