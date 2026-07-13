import { Router } from 'express';
import * as RecommendationsController from './recommendations.controller';

const router = Router();

router.get('/', RecommendationsController.getRecommendations);

export { router as recommendationsRouter };
