import { Router } from 'express';
import * as UsersController from './users.controller';

const router = Router();

router.post('/', UsersController.createUser);
router.get('/google/:googleId', UsersController.getUserByGoogleId);
router.patch('/profile/:id', UsersController.updateUserProfile);

export { router as usersRouter };
