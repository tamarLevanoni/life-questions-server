import { Request, Response, NextFunction } from 'express';
import { sendSuccess, sendError } from '../../utils/response';
import {
  CursorSearchSchema, SearchAccountHeadersSchema, SitemapPageQuerySchema, StoryIdParamSchema, StoryReaderHeadersSchema,
} from './stories.validators';
import * as StoriesService from './stories.service';
import { searchStoryCards } from './search-stories';

/** מאמת את הבקשה ואת מזהה החשבון ומבטל את החיפוש אם הלקוח מתנתק. */
export async function searchStories(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = CursorSearchSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, parsed.error.format(), 422);
    return;
  }
  const account = SearchAccountHeadersSchema.safeParse(req.headers);
  if (!account.success) {
    sendError(res, 'Missing or invalid search account', 401);
    return;
  }
  const abort = new AbortController();
  // מעביר לספקי האחזור אות ביטול כשהחיבור נסגר לפני החזרת התוצאות.
  const disconnect = () => abort.abort();
  res.once('close', disconnect);
  try {
    const result = await searchStoryCards(parsed.data, account.data['x-search-account'], abort.signal);
    if (!res.destroyed) {
      res.set('Cache-Control', 'private, no-store');
      sendSuccess(res, result);
    }
  } catch (err) {
    if (!res.destroyed) next(err);
  } finally {
    res.off('close', disconnect);
  }
}

/** מאמת את מספר העמוד ואת הגודל ומחזיר למפת האתר עמוד של מזהי סיפורים. */
export async function listSitemapStories(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = SitemapPageQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, parsed.error.format(), 422);
    return;
  }
  try {
    sendSuccess(res, await StoriesService.listSitemapStories(parsed.data.page, parsed.data.limit));
  } catch (err) {
    next(err);
  }
}

/** מחזיר לדף הבית שלושה סיפורים נבחרים בתשובה ציבורית. */
export async function getFeaturedFullStories(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stories = await StoriesService.getFeaturedFullStories(3);
    sendSuccess(res, stories);
  } catch (err) {
    next(err);
  }
}

/** מחזיר לדף הבית את סיפור השבוע, או תשובה עם ערך ריק כשאין סיפור מתאים. */
export async function getWeeklyStory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const story = await StoriesService.getWeeklyStory();
    sendSuccess(res, story);
  } catch (err) {
    next(err);
  }
}

/** מאמת את מזהי הסיפור והקורא ומחזיר תשובה פרטית, שיכולה לכלול הרחבה לפי הרשאת הקורא. */
export async function getStoryById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = StoryIdParamSchema.safeParse(req.params.id);
    if (!parsed.success) {
      sendError(res, 'Invalid story ID format: must be a UUID', 400);
      return;
    }
    const viewer = StoryReaderHeadersSchema.safeParse(req.headers);
    if (!viewer.success) {
      sendError(res, 'Invalid UUID format for story reader ID', 400);
      return;
    }
    res.set('Cache-Control', 'private, no-store');
    const story = await StoriesService.getStoryById(parsed.data, viewer.data['x-story-reader-id']);
    sendSuccess(res, story);
  } catch (err) {
    next(err);
  }
}

