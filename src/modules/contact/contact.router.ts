import { Router } from 'express';
import * as ContactController from './contact.controller';

const router = Router();

router.post('/', ContactController.createContact);

export { router as contactRouter };
