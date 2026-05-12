import { Router } from 'express';
import * as ReferenceController from './reference.controller';

const router = Router();

router.get('/masechtot', ReferenceController.getMasechtot);
router.get('/masechtot/:id/pages', ReferenceController.getMasechetPages);
router.get('/shu-sections', ReferenceController.getShuSections);
router.get('/shu-sections/:sectionId/simanim', ReferenceController.getShuSimanim);
router.get('/topics', ReferenceController.getTopics);
router.get('/concepts', ReferenceController.getConcepts);

export { router as referenceRouter };
