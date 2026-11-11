export type GradedStory = { id: string; grade: 0 | 1 | 2 };

export function scoreSearch(
  judgments: readonly GradedStory[],
  candidateIds: readonly string[],
  rankedIds: readonly string[],
) {
  const grades = new Map(judgments.map(({ id, grade }) => [id, grade]));
  const relevant = judgments.filter(({ grade }) => grade > 0);
  const candidates = new Set(candidateIds.slice(0, 50));
  const finalRanking = [...new Set(rankedIds)];
  const finalGrades = finalRanking.slice(0, 10).map(id => grades.get(id) ?? 0);
  const idealGrades = judgments.map(({ grade }) => grade).sort((a, b) => b - a).slice(0, 10);
  const discountedGain = (ranking: readonly number[]) => ranking.reduce(
    (sum, grade, rank) => sum + (2 ** grade - 1) / Math.log2(rank + 2),
    0,
  );

  return {
    recallAt50: relevant.length ? relevant.filter(({ id }) => candidates.has(id)).length / relevant.length : null,
    precisionAt3: relevant.length ? finalGrades.slice(0, 3).filter(grade => grade > 0).length / 3 : null,
    ndcgAt10: relevant.length ? discountedGain(finalGrades) / discountedGain(idealGrades) : null,
    noMatchFalsePositive: relevant.length ? null : Number(finalRanking.length > 0),
    judgedInTop10: finalRanking.slice(0, 10).filter(id => grades.has(id)).length,
    returnedInTop10: finalGrades.length,
  };
}
