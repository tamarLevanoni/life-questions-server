import { randomUUID } from 'node:crypto';
import { createClient } from '@redis/client';
import { Sentry } from '../../lib/sentry';
import type { CursorStoriesPage } from './stories.validators';

const TTL_MS = 30 * 60 * 1000;
const MAX_LOCAL_SETS = 512;
type Metadata = CursorStoriesPage['searchMeta'];

/** שומר עוגן לעימוד עבור חשבון אחד, עם סדר התוצאות, נתוני התאמה ומועד תפוגה קבוע. */
export interface SearchResultSet {
  account: string;
  ids: string[];
  metadata: Metadata;
  expiresAt: number;
}

/** מייצג כשל עימוד עם קוד שהבקר יכול לתרגם לתגובת HTTP. */
export class SearchPageError extends Error {
  constructor(public statusCode: 404 | 410 | 422 | 503, message: string) {
    super(message);
  }
}

const local = new Map<string, SearchResultSet>();
let redis: ReturnType<typeof createClient> | undefined;
let connecting: Promise<unknown> | undefined;

/** מחזיר חיבור משותף ל־Redis ומאחד ניסיונות חיבור מקבילים. מחוץ לייצור אפשר להשתמש בזיכרון המקומי. */
async function sharedStore() {
  const url = process.env.SEARCH_REDIS_URL;
  if (!url) {
    if (process.env.NODE_ENV === 'production') throw new Error('Search storage is not configured');
    return undefined;
  }
  if (!redis) {
    redis = createClient({ url, disableOfflineQueue: true, socket: { connectTimeout: 1000, reconnectStrategy: false } });
    redis.on('error', () => {
      Sentry.captureMessage('Story search storage unavailable', { level: 'warning' });
    });
  }
  if (!redis.isReady) {
    connecting ??= redis.connect().finally(() => { connecting = undefined; });
    await connecting;
  }
  return redis.withCommandOptions({ timeout: 1000 });
}

/** מוסיף מרחב שמות ייעודי למזהי תוצאות של החיפוש בגרסה הזו. */
function storageKey(id: string) {
  return `story-search:v2:${id}`;
}

/** יוצר מזהה אקראי ושומר את כל סדר המזהים למשך שלושים דקות. */
export async function saveResultSet(input: Omit<SearchResultSet, 'expiresAt'>) {
  const id = randomUUID();
  const result = { ...input, expiresAt: Date.now() + TTL_MS };
  try {
    const client = await sharedStore();
    if (client) {
      await client.set(storageKey(id), JSON.stringify(result), { expiration: { type: 'PX', value: TTL_MS } });
    } else {
      if (local.size >= MAX_LOCAL_SETS) local.delete(local.keys().next().value!);
      local.set(id, result);
    }
    return id;
  } catch {
    throw new SearchPageError(503, 'search_storage_unavailable');
  }
}

/** מאחזר תוצאות שמורות ומוודא שהן עדיין בתוקף ושייכות לחשבון המבקש. */
export async function readResultSet(id: string, account: string) {
  let result: SearchResultSet | undefined;
  try {
    const client = await sharedStore();
    if (client) {
      const raw = await client.get(storageKey(id));
      if (raw !== null) result = JSON.parse(raw) as SearchResultSet;
    } else {
      result = local.get(id);
    }
  } catch {
    throw new SearchPageError(503, 'search_storage_unavailable');
  }
  if (result && result.account !== account) throw new SearchPageError(404, 'search_not_found');
  if (!result || Date.now() >= result.expiresAt) {
    local.delete(id);
    throw new SearchPageError(410, 'search_expired');
  }
  return result;
}
