import { Request, Response, NextFunction } from 'express';
import { sendSuccess, sendError } from '../../utils/response';
import {
  CreateUserSchema,
  GoogleIdParamSchema,
  UpdateProfileSchema,
  UuidParamSchema,
} from './users.validators';
import * as UsersService from './users.service';

export async function createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = CreateUserSchema.safeParse(req.body);

    if (!parsed.success) {
      sendError(res, parsed.error.format(), 422);
      return;
    }

    const user = await UsersService.createUser(parsed.data);
    sendSuccess(res, user, 201);
  } catch (err) {
    next(err);
  }
}

export async function getUserByGoogleId(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = GoogleIdParamSchema.safeParse(req.params.googleId);

    if (!parsed.success) {
      sendError(res, 'Invalid googleId', 400);
      return;
    }

    const user = await UsersService.getUserByGoogleId(parsed.data);
    sendSuccess(res, user, 200);
  } catch (err) {
    next(err);
  }
}


export async function updateUserProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const idParsed = UuidParamSchema.safeParse(req.params.id);

    if (!idParsed.success) {
      sendError(res, 'Invalid user ID format: must be a UUID', 400);
      return;
    }

    const bodyParsed = UpdateProfileSchema.safeParse(req.body);

    if (!bodyParsed.success) {
      sendError(res, bodyParsed.error.format(), 422);
      return;
    }

    const updated = await UsersService.updateUserProfile(idParsed.data, bodyParsed.data);
    sendSuccess(res, updated, 200);
  } catch (err) {
    next(err);
  }
}
