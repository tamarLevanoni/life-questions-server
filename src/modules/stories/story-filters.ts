import type { Prisma } from '@prisma/client';
import type { StoryFilters } from './stories.validators';

/** מקבץ תנאים לפי סוג מסנן. מקרה צריך להתאים לכל הקבוצות ולפחות לאפשרות אחת בתוך כל קבוצה. */
export function storyFilterGroups({ bookIds, topicIds, shasRefs, shuRefs, concepts }: StoryFilters) {
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
            shuSiman: { sectionId: ref.shuSectionId },
            ...(ref.simanId ? { shuSimanId: ref.simanId } : {}),
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

  return structuralGroups;
}
