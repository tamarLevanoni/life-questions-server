import type { Prisma } from '@prisma/client';

export const storyOrder = [
  { book: { orderIndex: 'asc' } }, { storyOrder: 'asc' }, { id: 'asc' },
] satisfies Prisma.StoryOrderByWithRelationInput[];

/** טוען לעמוד הסיפור את הנושא, המקור המרכזי וההפניות המלאות הנדרשות להצגה. */
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

/** טוען לכרטיס את נתוני הקטלוג והמקורות המוצגים ברשימת התוצאות. */
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

/** משאיר מחוץ לכרטיס את ההרחבה ואת השדות הפנימיים שמשמשים לחיפוש. */
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

/** מסיר מפרטי הסיפור שדות שנוצרו לאחזור. שליחת ההרחבה נקבעת בשירות לפי הקורא. */
export const storyDetailOmit = {
  searchText: true,
  embeddingModel: true,
  summaryAi: true,
} satisfies Prisma.StoryOmit;
