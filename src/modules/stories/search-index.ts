import { createHash } from 'node:crypto';

export const SEARCH_RECIPE_VERSION = 1;
export const SEARCH_INDEX_LAYOUTS = ['split', 'combined', 'split-expansion'] as const;
export type SearchIndexLayout = (typeof SEARCH_INDEX_LAYOUTS)[number];
export type SearchDocumentKind = 'scenario' | 'principle' | 'expansion' | 'combined';

export const SEARCH_WORD_LIMITS = { scenario: 360, principle: 240, expansion: 300 } as const;
const EXPANSION_OVERLAP = 20;
const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:[׳״'"`־-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu;

export interface StorySearchContent {
  title: string;
  storyBody: string;
  legalQuestion: string;
  shortAnswer: string;
  summaryAi: string | null;
  conceptsFromIndex: string[];
  conceptsAi: string[];
  expansion: string | null;
}

export interface SearchDocument {
  kind: SearchDocumentKind;
  part: number;
  content: string;
  contentHash: string;
  embed: boolean;
}

export function countSearchWords(text: string): number {
  return [...text.matchAll(WORD)].length;
}

function textLines(parts: readonly (string | null)[]): string {
  return parts.map((part) => part?.trim()).filter(Boolean).join('\n');
}

function preferredBoundary(text: string, words: RegExpMatchArray[], start: number, limit: number): number {
  let paragraphBoundary = 0;
  let sentenceBoundary = 0;
  for (let end = start + Math.floor(limit / 2); end <= start + limit; end++) {
    const previous = words[end - 1];
    const gap = text.slice(previous.index! + previous[0].length, words[end].index);
    if (/\r?\n/.test(gap)) paragraphBoundary = end;
    if (/[.!?…](?:["׳״”’)]*)\s/.test(gap)) sentenceBoundary = end;
  }
  return paragraphBoundary || sentenceBoundary || start + limit;
}

function splitText(text: string, limit: number, overlap = 0): string[] {
  const words = [...text.matchAll(WORD)];
  if (words.length <= limit) return text ? [text] : [];

  const chunks: string[] = [];
  let start = 0;
  while (start + limit < words.length) {
    const end = preferredBoundary(text, words, start, limit);
    const startOffset = start === 0 ? 0 : words[start].index!;
    chunks.push(text.slice(startOffset, words[end].index).trim());
    start = end - overlap;
  }
  chunks.push(text.slice(words[start].index).trim());
  return chunks;
}

function limitWords(text: string, limit: number): string {
  const next = [...text.matchAll(WORD)][limit];
  return next ? text.slice(0, next.index).trim() : text;
}

function makeDocument(kind: SearchDocumentKind, part: number, content: string, embed: boolean): SearchDocument {
  return {
    kind,
    part,
    content,
    embed,
    contentHash: createHash('sha256').update(content).digest('hex'),
  };
}

export function storySearchTexts(story: StorySearchContent) {
  const concepts = [...new Set([...story.conceptsFromIndex, ...story.conceptsAi].map((tag) => tag.trim()))];
  return {
    scenario: textLines([story.title, story.storyBody]),
    principle: textLines([story.legalQuestion, story.shortAnswer, story.summaryAi, ...concepts]) || story.title.trim(),
    expansion: story.expansion?.trim() ?? '',
  };
}

export function buildStorySearchDocuments(story: StorySearchContent, layout: SearchIndexLayout): SearchDocument[] {
  const texts = storySearchTexts(story);
  const scenario = splitText(texts.scenario, SEARCH_WORD_LIMITS.scenario);
  const principle = limitWords(texts.principle, SEARCH_WORD_LIMITS.principle);
  const expansion = splitText(texts.expansion, SEARCH_WORD_LIMITS.expansion, EXPANSION_OVERLAP);
  const documents: SearchDocument[] = [];

  const splitVectors = layout !== 'combined';
  documents.push(...scenario.map((content, part) => makeDocument('scenario', part, content, splitVectors)));
  if (principle) documents.push(makeDocument('principle', 0, principle, splitVectors));

  if (layout === 'combined') {
    const content = textLines([scenario[0] ?? null, principle ?? null]);
    if (content) documents.push(makeDocument('combined', 0, content, true));
  }

  documents.push(...expansion.map((content, part) => makeDocument('expansion', part, content, layout === 'split-expansion')));
  return documents;
}
