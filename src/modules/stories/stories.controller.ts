import { Request, Response, NextFunction } from 'express';
import { sendSuccess, sendError } from '../../utils/response';
import { SearchStoriesSchema, StoryIdParamSchema, StoryReaderHeadersSchema } from './stories.validators';
import * as StoriesService from './stories.service';

export async function searchStories(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = SearchStoriesSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, parsed.error.format(), 422);
      return;
    }
    const result = await StoriesService.searchStories(parsed.data);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getFeaturedFullStories(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stories = await StoriesService.getFeaturedFullStories(3);
    sendSuccess(res, stories);
  } catch (err) {
    next(err);
  }
}

export async function getWeeklyStory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const story = await StoriesService.getWeeklyStory();
    sendSuccess(res, story);
  } catch (err) {
    next(err);
  }
}

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

