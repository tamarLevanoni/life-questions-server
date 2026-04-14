import { Response } from 'express';
import { StandardResponse } from '../types';

export function sendSuccess<T>(res: Response, data: T, statusCode = 200): void {
  const body: StandardResponse<T> = { success: true, data };
  res.status(statusCode).json(body);
}

export function sendError(res: Response, error: unknown, statusCode = 400): void {
  const body: StandardResponse = {
    success: false,
    error: typeof error === 'string' ? error : JSON.stringify(error),
  };
  res.status(statusCode).json(body);
}
