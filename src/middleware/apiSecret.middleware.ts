import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response';

export function apiSecretMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingSecret = req.headers['x-api-secret'];

  if (
    !incomingSecret ||
    typeof incomingSecret !== 'string' ||
    incomingSecret !== process.env.API_SECRET
  ) {
    sendError(res, 'Unauthorized: invalid or missing API secret', 401);
    return;
  }

  next();
}
