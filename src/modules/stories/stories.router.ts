import { Router } from 'express';
import * as StoriesController from './stories.controller';

const router = Router();

// נקודת הכניסה לפתיחת חיפוש ולהמשך עימוד לפי סמן.
router.post('/search', StoriesController.searchStories);
router.get('/featured', StoriesController.getFeaturedFullStories);
router.get('/weekly', StoriesController.getWeeklyStory);
router.get('/sitemap', StoriesController.listSitemapStories);
// נתיב הסיפור לפי מזהה מופיע בסוף כדי שהנתיבים הקבועים ייבדקו לפניו.
router.get('/:id', StoriesController.getStoryById);

export { router as storiesRouter };
