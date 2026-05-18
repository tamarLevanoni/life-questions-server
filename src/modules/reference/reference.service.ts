import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { cache } from '../../lib/cache';

export async function getMasechtot() {
  const key = 'ref:masechtot';
  const cached = cache.get<Awaited<ReturnType<typeof fetchMasechtot>>>(key);
  if (cached) return cached;
  const data = await fetchMasechtot();
  cache.set(key, data);
  return data;
}

function fetchMasechtot() {
  return prisma.masechet.findMany({
    orderBy: { orderIndex: 'asc' },
    include: {
      pages: {
        orderBy: [{ daf: 'asc' }, { amud: 'asc' }],
        select: { id: true, daf: true, amud: true },
      },
    },
  });
}

export async function getShuSections() {
  const key = 'ref:shu-sections';
  const cached = cache.get<Awaited<ReturnType<typeof fetchShuSections>>>(key);
  if (cached) return cached;
  const data = await fetchShuSections();
  cache.set(key, data);
  return data;
}

function fetchShuSections() {
  return prisma.shuSection.findMany({
    include: {
      simanim: {
        orderBy: { siman: 'asc' },
        select: { id: true, siman: true, title: true },
      },
    },
    orderBy: { name: 'asc' },
  });
}

export async function getTopics() {
  const key = 'ref:topics';
  const cached = cache.get<Awaited<ReturnType<typeof fetchTopics>>>(key);
  if (cached) return cached;
  const data = await fetchTopics();
  cache.set(key, data);
  return data;
}

function fetchTopics() {
  return prisma.topic.findMany({
    orderBy: [{ bookNumber: 'asc' }, { orderIndex: 'asc' }],
  });
}

export async function getConcepts() {
  const key = 'ref:concepts';
  const cached = cache.get<string[]>(key);
  if (cached) return cached;
  const data = await fetchConcepts();
  cache.set(key, data);
  return data;
}

async function fetchConcepts(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ concept: string }[]>(
    Prisma.sql`
      SELECT DISTINCT unnest("conceptsAi" || "conceptsFromIndex") AS concept
      FROM stories
      ORDER BY concept
    `
  );
  return rows.map((r) => r.concept);
}
