import { Request, Response, NextFunction } from 'express';
import { sendSuccess, sendError } from '../../utils/response';
import { ContactSchema } from './contact.validators';
import * as ContactService from './contact.service';

export async function createContact(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = ContactSchema.safeParse(req.body);

    if (!parsed.success) {
      sendError(res, parsed.error.format(), 422);
      return;
    }

    const contact = await ContactService.createContact(parsed.data);
    sendSuccess(res, contact, 201);
  } catch (err) {
    next(err);
  }
}
