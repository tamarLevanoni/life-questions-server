import { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../utils/response';
import * as RecommendationsService from './recommendations.service';

export async function getRecommendations(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await RecommendationsService.getRecommendations();
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}
