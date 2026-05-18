import { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../utils/response';
import { cache } from '../../lib/cache';
import * as ReferenceService from './reference.service';

export async function getMasechtot(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await ReferenceService.getMasechtot();
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}

export async function getShuSections(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await ReferenceService.getShuSections();
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}

export async function getTopics(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await ReferenceService.getTopics();
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}

export async function getConcepts(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await ReferenceService.getConcepts();
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}

export function invalidateCache(_req: Request, res: Response): void {
  cache.clear();
  sendSuccess(res, { message: 'Reference cache cleared' });
}
