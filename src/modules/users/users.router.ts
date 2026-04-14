import { Router } from 'express';
import * as UsersController from './users.controller';

const router = Router();

router.post('/sync', UsersController.syncUser);
router.get('/profile/:id', UsersController.getUserById);
router.patch('/profile/:id', UsersController.updateUserProfile);

export { router as usersRouter };
