import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { sendSuccess, sendError } from '../../utils/response';
import * as ReferenceService from './reference.service';

const UuidParam = z.uuid({ error: 'id must be a valid UUID' });

export async function getMasechtot(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await ReferenceService.getMasechtot();
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}

export async function getMasechetPages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = UuidParam.safeParse(req.params.id);
    if (!parsed.success) {
      sendError(res, 'Invalid masechet ID format: must be a UUID', 400);
      return;
    }
    const data = await ReferenceService.getMasechetPages(parsed.data);
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

export async function getShuSimanim(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = UuidParam.safeParse(req.params.sectionId);
    if (!parsed.success) {
      sendError(res, 'Invalid sectionId format: must be a UUID', 400);
      return;
    }
    const data = await ReferenceService.getShuSimanim(parsed.data);
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
