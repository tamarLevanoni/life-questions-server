import { scoreSearch } from '../../scripts/search-eval-metrics';
import fixture from '../fixtures/story-search-eval.json';

describe('Search evaluation', () => {
  it('scores candidate recall separately from final precision and graded ranking', () => {
    const judgments = [
      { id: 'direct', grade: 2 },
      { id: 'secondary', grade: 1 },
      { id: 'distractor', grade: 0 },
    ] as const;
    const candidates = ['distractor', 'direct', 'secondary'];

    const imperfect = scoreSearch(judgments, candidates, ['secondary', 'distractor', 'unjudged']);
    expect(imperfect.recallAt50).toBe(1);
    expect(imperfect.precisionAt3).toBeCloseTo(1 / 3);
    expect(imperfect.ndcgAt10).toBeLessThan(1);
    expect(imperfect.judgedInTop10).toBe(2);

    const ideal = scoreSearch(judgments, candidates, ['direct', 'secondary', 'distractor']);
    expect(ideal.precisionAt3).toBeCloseTo(2 / 3);
    expect(ideal.ndcgAt10).toBe(1);
  });

  it('does not count candidates after rank 50 or duplicate final results', () => {
    const judgments = [{ id: 'direct', grade: 2 }] as const;
    const candidates = [...Array.from({ length: 50 }, (_, index) => String(index)), 'direct'];
    const scores = scoreSearch(judgments, candidates, ['direct', 'direct']);
    expect(scores.recallAt50).toBe(0);
    expect(scores.precisionAt3).toBeCloseTo(1 / 3);
    expect(scores.returnedInTop10).toBe(1);
  });

  it('reports false positives separately on queries without a relevant story', () => {
    expect(scoreSearch([], ['unrelated'], ['unrelated'])).toMatchObject({
      recallAt50: null,
      precisionAt3: null,
      ndcgAt10: null,
      noMatchFalsePositive: 1,
    });
    expect(scoreSearch([], ['unrelated'], []).noMatchFalsePositive).toBe(0);
  });

  it('includes a disjoint set of 60 tuning and 40 holdout queries', () => {
    const tune = fixture.queries.filter(query => query.split === 'tune');
    const holdout = fixture.queries.filter(query => query.split === 'holdout');
    expect(tune).toHaveLength(60);
    expect(holdout).toHaveLength(40);
    const positiveStories = (queries: typeof tune) => queries.flatMap(query => query.judgments
      .filter(story => story.grade > 0)
      .map(story => `${story.book}:${story.order}`));
    const tuneStories = new Set(positiveStories(tune));
    expect(positiveStories(holdout).some(story => tuneStories.has(story))).toBe(false);
    for (const split of [tune, holdout]) {
      expect(new Set(split.map(query => query.intent))).toEqual(
        new Set(['case', 'principle', 'source', 'title', 'topic', 'expansion', 'no-match']),
      );
    }
  });
});
