import { Prisma } from '@prisma/client';

export const storyInclude = {
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
  centralShuSiman: {
    include: { section: true },
  },
} satisfies Prisma.StoryInclude;

export const storyCardInclude = {
  shuRefs: {
    include: {
      shuSiman: {
        include: { section: true },
      },
    },
  },
  centralShuSiman: {
    include: { section: true },
  },
} satisfies Prisma.StoryInclude;

export const storyCardOmit = {
  storyBody: true,
  shortAnswer: true,
  expansion: true,
  conceptsAi: true,
  conceptsFromIndex: true,
  imageUrl: true,
  legalQuestionSource: true,
  sourceReferencesText: true,
  summaryAi: true,
  keywordsAi: true,
  keywordsFromIndex: true,
  searchText: true,
  embeddingModel: true,
  centralShuSimanId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StoryOmit;
