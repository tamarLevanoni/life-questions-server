import {
  buildStorySearchDocuments, countSearchWords, SEARCH_WORD_LIMITS, type StorySearchContent,
} from '../../src/modules/stories/search-index';

const story: StorySearchContent = {
  title: 'שומר שמסר לשומר',
  storyBody: 'השומר מסר את החפץ לחבר',
  legalQuestion: 'מי אחראי אם החפץ נגנב?',
  shortAnswer: 'יש לבדוק את תנאי השמירה.',
  summaryAi: null,
  conceptsFromIndex: ['שמירה'],
  conceptsAi: [],
  expansion: 'פסקה קצרה.',
};

it('keeps a short expansion in one lexical document and embeds only the two story views', () => {
  const documents = buildStorySearchDocuments(story, 'split');
  expect(documents.map(({ kind, part, embed }) => [kind, part, embed])).toEqual([
    ['scenario', 0, true], ['principle', 0, true], ['expansion', 0, false],
  ]);
  const edited = buildStorySearchDocuments({ ...story, expansion: 'פסקה חדשה.' }, 'split');
  expect(edited[0].contentHash).toBe(documents[0].contentHash);
  expect(edited[1].contentHash).toBe(documents[1].contentHash);
  expect(edited[2].contentHash).not.toBe(documents[2].contentHash);
});

it('retains all words in long expansions with capped chunks', () => {
  const words = Array.from({ length: 700 }, (_, index) => `מילה${index}`);
  const documents = buildStorySearchDocuments({ ...story, expansion: words.join(' ') }, 'split-expansion');
  const expansion = documents.filter(({ kind }) => kind === 'expansion');
  expect(expansion.length).toBeGreaterThan(1);
  expect(expansion.every(({ content, embed }) => embed && countSearchWords(content) <= SEARCH_WORD_LIMITS.expansion))
    .toBe(true);
  expect(new Set(expansion.flatMap(({ content }) => content.split(' ')))).toEqual(new Set(words));
});

it('uses the same lexical views in the single-vector experiment and prioritizes the question and answer', () => {
  const documents = buildStorySearchDocuments({
    ...story, conceptsAi: [Array.from({ length: 260 }, (_, index) => `מושג${index}`).join(' ')],
  }, 'combined');
  expect(documents.filter(({ embed }) => embed).map(({ kind }) => kind)).toEqual(['combined']);
  const principle = documents.find(({ kind }) => kind === 'principle')!;
  expect(countSearchWords(principle.content)).toBe(SEARCH_WORD_LIMITS.principle);
  expect(principle.content.startsWith(`${story.legalQuestion}\n${story.shortAnswer}`)).toBe(true);
});
