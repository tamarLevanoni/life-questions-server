import { Request, Response, NextFunction } from 'express';
import { sendSuccess, sendError } from '../../utils/response';
import { SearchStoriesSchema, StoryIdParamSchema } from './stories.validators';
import * as StoriesService from './stories.service';

export async function searchStories(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = SearchStoriesSchema.safeParse(req.query);
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

export async function getStoryById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = StoryIdParamSchema.safeParse(req.params.id);
    if (!parsed.success) {
      sendError(res, 'Invalid story ID format: must be a UUID', 400);
      return;
    }
    const story = await StoriesService.getStoryById(parsed.data);
    sendSuccess(res, story);
  } catch (err) {
    next(err);
  }
}

