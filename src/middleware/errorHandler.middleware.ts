import { Request, Response, NextFunction } from 'express';
import { Sentry } from '../lib/sentry';
import { sendError } from '../utils/response';

interface AppError extends Error {
  statusCode?: number;
  status?: number;
}

export function errorHandlerMiddleware(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode ?? err.status ?? 500;

  if (statusCode >= 500) {
    Sentry.captureException(err);
  }

  const message =
    process.env.NODE_ENV === 'production' && statusCode >= 500
      ? 'Internal server error'
      : err.message ?? 'An unexpected error occurred';

  sendError(res, message, statusCode);
}
