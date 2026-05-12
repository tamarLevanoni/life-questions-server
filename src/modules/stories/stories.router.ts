import { Router } from 'express';
import * as StoriesController from './stories.controller';

const router = Router();

router.get('/', StoriesController.searchStories);
router.get('/:id/neighbors', StoriesController.getStoryNeighbors);
router.get('/:id', StoriesController.getStoryById);

export { router as storiesRouter };
