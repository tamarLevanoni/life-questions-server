import { Router } from 'express';
import * as StoriesController from './stories.controller';

const router = Router();

router.post('/search', StoriesController.searchStories);
router.get('/featured', StoriesController.getFeaturedFullStories);
router.get('/weekly', StoriesController.getWeeklyStory);
router.get('/:id', StoriesController.getStoryById);

export { router as storiesRouter };
